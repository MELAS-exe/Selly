// Uploads (architecture.md sections 5.2 group E and 8.6). The browser sends bytes straight to storage with a
// presigned PUT; core only reads them back when a product or a draft uses them. The agent hands over files it
// already checked (a customer's voice note) through POST /internal/v1/media.
import multipart from '@fastify/multipart';
import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { AppError } from '../../errors';
import { iso } from '../../util';
import { requireVendor } from '../auth/http';
import { findVendorById, isUuid } from '../catalog/store';
import { IMAGE_TYPES, type ImageType, isUploadKeyOf, MAX_IMAGE_BYTES, uploadKey } from './images';

export const UPLOAD_EXPIRY_SECONDS = 15 * 60;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
};

/** Read links for the agent's vision model: long enough for a turn and its retries. */
export const READ_LINK_SECONDS = 60 * 60;
const linksBody = z.strictObject({ keys: z.array(z.string().max(200)).min(1).max(6) });

const uploadBody = z.strictObject({
  content_type: z.enum(Object.keys(IMAGE_TYPES) as [ImageType, ...ImageType[]]),
  size_bytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
});

const tooBig = (limit: number) =>
  new AppError('VALIDATION_FAILED', `The file is larger than ${limit / 1024 / 1024} MB.`, {
    errors: [{ field: 'file', message: 'Too large' }],
  });

export const mediaModule: FastifyPluginAsync = async (app) => {
  // Only for POST /internal/v1/media, in this plugin's scope. One file, never more than the image limit.
  await app.register(multipart, { limits: { files: 1, fileSize: MAX_IMAGE_BYTES, fields: 2 } });

  app.post(
    '/api/v1/media/uploads',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const s = await requireVendor(app.ctx, req);
      const body = uploadBody.parse(req.body);
      const key = uploadKey(s.vendorId, body.content_type);
      const signed = await app.ctx.media.presignPut({
        key,
        contentType: body.content_type,
        sizeBytes: body.size_bytes,
        expiresSeconds: UPLOAD_EXPIRY_SECONDS,
      });
      return reply.code(201).send({
        storage_key: key,
        upload_url: signed.url,
        method: 'PUT',
        headers: signed.headers,
        expires_at: iso(new Date(app.ctx.now().getTime() + UPLOAD_EXPIRY_SECONDS * 1000)),
      });
    },
  );

  // A file the agent holds: a customer's voice note (chat_audio), or a photo the vendor sent the assistant
  // (product_image, with X-Actor: vendor:<id> so it is stored as that vendor's upload).
  app.post('/internal/v1/media', async (req, reply) => {
    if (!req.isMultipart())
      throw new AppError('VALIDATION_FAILED', 'Send the file as multipart/form-data.', {
        errors: [{ field: 'file', message: 'Required' }],
      });
    const file = await req.file();
    if (!file)
      throw new AppError('VALIDATION_FAILED', 'One file is required.', {
        errors: [{ field: 'file', message: 'Required' }],
      });
    const type = file.mimetype.split(';')[0]?.trim().toLowerCase() ?? '';
    const purposeField = file.fields.purpose as { value?: unknown } | undefined;
    const purpose =
      typeof purposeField?.value === 'string'
        ? purposeField.value
        : type.startsWith('audio/')
          ? 'chat_audio'
          : 'product_image';

    let bytes: Buffer;
    try {
      bytes = await file.toBuffer();
    } catch {
      throw tooBig(MAX_IMAGE_BYTES);
    }
    if (file.file.truncated) throw tooBig(MAX_IMAGE_BYTES);

    let key: string;
    if (purpose === 'chat_audio') {
      const ext = AUDIO_TYPES[type];
      if (!ext)
        throw new AppError('VALIDATION_FAILED', 'Audio must be WebM, Ogg, MP4 or MP3.', {
          errors: [{ field: 'file', message: 'Unsupported type' }],
        });
      if (bytes.length > MAX_AUDIO_BYTES) throw tooBig(MAX_AUDIO_BYTES);
      key = `chat-audio/${iso(app.ctx.now())?.slice(0, 7)}/${uuidv7()}.${ext}`;
    } else if (purpose === 'product_image') {
      if (!(type in IMAGE_TYPES))
        throw new AppError('VALIDATION_FAILED', 'Images must be JPEG, PNG or WebP.', {
          errors: [{ field: 'file', message: 'Unsupported type' }],
        });
      const actor = String(req.headers['x-actor'] ?? '');
      const vendorId = /^vendor:(.+)$/.exec(actor)?.[1] ?? '';
      const [vendor] = isUuid(vendorId)
        ? await app.ctx.db
            .select({ id: core.vendors.id })
            .from(core.vendors)
            .where(eq(core.vendors.id, vendorId))
        : [];
      if (!vendor)
        throw new AppError('VALIDATION_FAILED', 'A product image needs X-Actor: vendor:<id>.', {
          errors: [{ field: 'X-Actor', message: 'Missing or unknown vendor' }],
        });
      key = uploadKey(vendor.id, type as ImageType);
    } else {
      throw new AppError('VALIDATION_FAILED', 'purpose must be chat_audio or product_image.', {
        errors: [{ field: 'purpose', message: 'Not allowed' }],
      });
    }
    if (bytes.length === 0)
      throw new AppError('VALIDATION_FAILED', 'The file is empty.', {
        errors: [{ field: 'file', message: 'Empty' }],
      });

    await app.ctx.media.put('private', key, bytes, type);
    return reply.code(201).send({ storage_key: key, content_type: type, size_bytes: bytes.length });
  });
  // Short-lived read links to a vendor's own uploads, for the agent's vision model (photos sent in the assistant
  // chat). The bucket stays private: originals still carry EXIF (location) and it also holds customers' voice notes.
  app.post<{ Params: { id: string } }>('/internal/v1/vendors/:id/media/links', async (req) => {
    const body = linksBody.parse(req.body);
    const vendor = await findVendorById(app.ctx, req.params.id);
    const expiresAt = iso(new Date(app.ctx.now().getTime() + READ_LINK_SECONDS * 1000));
    const links = [];
    for (const key of [...new Set(body.keys)]) {
      if (!isUploadKeyOf(key, vendor.id) || !(await app.ctx.media.head('private', key)))
        throw new AppError('VALIDATION_FAILED', `Image ${key} is not an upload of this shop.`, {
          errors: [{ field: 'keys', key, message: 'Unknown upload' }],
        });
      links.push({
        key,
        url: await app.ctx.media.presignGet(key, READ_LINK_SECONDS),
        expires_at: expiresAt,
      });
    }
    return { links };
  });
};
