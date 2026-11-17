// Product images (architecture.md section 8.6). An upload is a private original under vendors/<id>/uploads/. When a
// product uses it, core re-encodes it with sharp: rotated upright, every metadata block dropped (EXIF can hold the
// shop's location), 320, 640 and 960 px wide in WebP and AVIF, into the public bucket under vendors/<id>/images/.
// The original stays private; a bucket lifecycle rule deletes it after 30 days.
import { core } from '@selly/db';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../../context';
import { AppError } from '../../errors';
import type { ObjectStore } from './storage';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const WIDTHS = [320, 640, 960] as const;
/** The width the API shows as `url`; the others sit next to it (same name, other width or extension). */
export const DISPLAY_WIDTH = 640;
const IMMUTABLE = 'public, max-age=31536000, immutable';

export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
export type ImageType = keyof typeof IMAGE_TYPES;

const UPLOAD_RE = /^vendors\/([0-9a-f-]{36})\/uploads\/([0-9a-f-]{36})\.(jpg|png|webp)$/;

export const uploadKey = (vendorId: string, type: ImageType) =>
  `vendors/${vendorId}/uploads/${uuidv7()}.${IMAGE_TYPES[type]}`;

/** An upload key of this vendor: never another vendor's file, never a path of our choosing. */
export function isUploadKeyOf(key: string, vendorId: string): boolean {
  const m = UPLOAD_RE.exec(key);
  return !!m && m[1] === vendorId.toLowerCase();
}

export interface PreparedImage {
  storageKey: string;
  width: number;
  height: number;
  dominant: string;
}

const hex = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');

const badImage = (key: string, message: string) =>
  new AppError('VALIDATION_FAILED', `Image ${key}: ${message}`, {
    errors: [{ field: 'image_keys', key, message }],
  });

/**
 * Reads an upload and writes its public variants. Returns the row to store in core.product_images. Throws 422 when
 * the key is not this vendor's upload, the file is missing or too large, or it is not a readable image.
 */
export async function processUpload(
  store: ObjectStore,
  vendorId: string,
  key: string,
): Promise<PreparedImage> {
  if (!isUploadKeyOf(key, vendorId)) throw badImage(key, 'not an upload of this shop');
  const obj = await store.get('private', key);
  if (!obj) throw badImage(key, 'not uploaded yet, or expired');
  if (obj.bytes.length > MAX_IMAGE_BYTES) throw badImage(key, 'larger than 8 MB');

  let base: Sharp;
  let meta: Metadata;
  try {
    // limitInputPixels guards against decompression bombs; autoOrient applies the EXIF rotation before it is dropped.
    base = sharp(obj.bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).autoOrient();
    meta = await base.metadata();
  } catch {
    throw badImage(key, 'not a JPEG, PNG or WebP image');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format))
    throw badImage(key, 'not a JPEG, PNG or WebP image');

  const id = uuidv7();
  const prefix = `vendors/${vendorId}/images/${id}`;
  let display = { width: 0, height: 0 };
  try {
    for (const w of WIDTHS) {
      const resized = base.clone().resize({ width: w, withoutEnlargement: true });
      const webp = await resized
        .clone()
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      const avif = await resized.clone().avif({ quality: 50, effort: 2 }).toBuffer();
      await store.put('public', `${prefix}/${w}.webp`, webp.data, 'image/webp', IMMUTABLE);
      await store.put('public', `${prefix}/${w}.avif`, avif, 'image/avif', IMMUTABLE);
      if (w === DISPLAY_WIDTH) display = { width: webp.info.width, height: webp.info.height };
    }
  } catch {
    throw badImage(key, 'could not be processed');
  }
  const { dominant } = await base.clone().stats();
  return {
    storageKey: `${prefix}/${DISPLAY_WIDTH}.webp`,
    width: display.width,
    height: display.height,
    dominant: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
  };
}

/** Processes several uploads; the first bad one fails them all, before anything reaches the database. */
export async function processUploads(store: ObjectStore, vendorId: string, keys: string[]) {
  const out: PreparedImage[] = [];
  for (const k of keys) out.push(await processUpload(store, vendorId, k));
  return out;
}

/** Image rows in display order. */
export async function insertImages(tx: Database, productId: string, images: PreparedImage[]) {
  if (images.length === 0) return;
  await tx.insert(core.productImages).values(
    images.map((img, position) => ({
      productId,
      storageKey: img.storageKey,
      width: img.width,
      height: img.height,
      dominant: img.dominant,
      position,
    })),
  );
}
