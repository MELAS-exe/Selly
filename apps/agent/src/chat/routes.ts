// Customer chat on the vendor's storefront (architecture.md sections 3.8, 5.3.7 and 7.2; docs/api.json tag "Chat").

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../app';
import { assistantLabel, toChatMessage } from '../conversations';
import { AppError, CoreError } from '../errors';
import { newChatToken, sha256, uuidv7, visitorLabel } from '../ids';
import { authenticateChat, CHAT_SESSION_DAYS } from './auth';
import { streamEvents } from './hub';
import { parseBody, parseQuery } from './validate';

const SessionBody = z.strictObject({
  store_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  product_id: z.uuid().optional(),
  locale: z.string().max(10).optional(),
});

const MessageBody = z
  .strictObject({
    client_message_id: z.string().min(8).max(64),
    kind: z.enum(['text', 'audio']),
    text: z.string().max(1000).optional(),
    media_key: z.string().max(200).optional(),
    quick_reply_id: z.string().max(64).optional(),
    context: z.strictObject({ product_id: z.uuid().optional() }).optional(),
  })
  .refine(
    (b) =>
      b.kind === 'audio' ? Boolean(b.media_key) : Boolean(b.text?.trim() || b.quick_reply_id),
    {
      message: 'text (or quick_reply_id) is required for kind text, media_key for kind audio',
    },
  );

const ListQuery = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const UploadBody = z.strictObject({
  content_type: z.enum(['audio/webm', 'audio/ogg', 'audio/mp4']),
  size_bytes: z.number().int().min(1).max(2_097_152),
});

export function registerChatRoutes(app: FastifyInstance, s: AgentServices) {
  app.post('/api/v1/chat/sessions', async (req, reply) => {
    const limit = s.limits.sessionsPerIp.take(sha256(req.ip).toString('hex'));
    if (!limit.allowed)
      throw new AppError('RATE_LIMITED', undefined, undefined, limit.retryAfterSeconds);
    const body = parseBody(SessionBody, req.body);

    let vendor: Awaited<ReturnType<typeof s.core.getVendorBySlug>>;
    try {
      vendor = await s.core.getVendorBySlug(body.store_slug);
    } catch (err) {
      if (err instanceof CoreError && err.status === 404)
        throw new AppError('NOT_FOUND', 'Unknown store.');
      throw err;
    }
    if (vendor.store_status !== 'active') throw new AppError('STORE_PAUSED');
    if (!vendor.chat_enabled) throw new AppError('CHAT_UNAVAILABLE');
    const entitlements = await s.entitlements.get(vendor.vendor_id);
    if (entitlements?.subscription_status === 'suspended') throw new AppError('STORE_PAUSED');

    const token = newChatToken();
    const visitorId = uuidv7();
    const conv = await s.store.upsertConversation({
      vendorId: vendor.vendor_id,
      channel: 'web',
      role: 'customer',
      externalUserId: visitorId,
      customerLabel: visitorLabel(visitorId),
    });
    if (body.product_id || body.locale) {
      await s.store.updateConversation(conv.id, {
        state: body.product_id ? { productInView: body.product_id } : {},
        language: body.locale?.slice(0, 2) ?? null,
      });
    }
    const expiresAt = new Date(Date.now() + CHAT_SESSION_DAYS * 86_400_000);
    await s.store.createChatSession({
      vendorId: vendor.vendor_id,
      conversationId: conv.id,
      tokenHash: sha256(token),
      ipHash: sha256(`${req.ip}:${s.config.eventsHmacSecret}`),
      expiresAt,
    });

    // The first message is the disclosure (section 8.4).
    const disclosure = `Assistant automatique de ${vendor.display_name}. Le vendeur peut prendre la main à tout moment.`;
    const greeting = await s.conversations.agentReply(
      conv,
      {
        text: body.product_id
          ? `Bonjour ! Je suis l’assistant automatique de ${vendor.display_name}. Le vendeur peut me remplacer à tout moment. Une question sur cet article ?`
          : `Bonjour ! Je suis l’assistant automatique de ${vendor.display_name}. Le vendeur peut me remplacer à tout moment. Que cherchez-vous ?`,
        cards: [],
        quickReplies: body.product_id
          ? [
              { id: 'sizes', label: 'Tailles disponibles' },
              { id: 'delivery', label: 'Livraison' },
            ]
          : [
              { id: 'browse', label: 'Voir les nouveautés' },
              { id: 'delivery', label: 'Livraison' },
            ],
      },
      assistantLabel(vendor.display_name),
    );

    reply.code(201);
    return {
      session_token: token,
      conversation_id: conv.id,
      expires_at: expiresAt.toISOString(),
      store: { slug: vendor.slug, display_name: vendor.display_name },
      disclosure,
      features: { voice_notes: entitlements?.features.voice_notes ?? false },
      messages: [toChatMessage(greeting)],
    };
  });

  app.get('/api/v1/chat/messages', async (req) => {
    const session = await authenticateChat(s.store, req);
    const q = parseQuery(ListQuery, req.query);
    const data = await s.store.listMessages(session.conversationId, {
      after: q.after,
      limit: q.limit,
    });
    const last = data.at(-1);
    if (last) s.hub.publish(session.conversationId, 'read', { up_to: last.id }, 'vendor');
    return {
      data: data.map(toChatMessage),
      next_cursor: data.length === q.limit && last ? last.id : null,
    };
  });

  app.post('/api/v1/chat/messages', async (req, reply) => {
    const session = await authenticateChat(s.store, req);
    const limit = s.limits.messagesPerToken.take(session.id);
    if (!limit.allowed)
      throw new AppError('RATE_LIMITED', undefined, undefined, limit.retryAfterSeconds);
    const body = parseBody(MessageBody, req.body);

    if (body.kind === 'audio') {
      const ent = await s.entitlements.get(session.vendorId);
      if (!ent?.features.voice_notes)
        throw new AppError('FEATURE_NOT_IN_PLAN', 'Voice notes need the Pro plan.');
      const up = s.uploads.get(body.media_key ?? '');
      if (!up || up.conversationId !== session.conversationId || !up.bytes)
        throw new AppError('VALIDATION_FAILED', 'Unknown or incomplete upload.', [
          { field: 'media_key' },
        ]);
    }

    const { message, created } = await s.store.insertMessage({
      conversationId: session.conversationId,
      direction: 'in',
      author: 'customer',
      kind: body.kind,
      text: body.text?.trim() || null,
      mediaKey: body.media_key ?? null,
      quickReplyId: body.quick_reply_id ?? null,
      clientMessageId: body.client_message_id,
      status: 'accepted',
    });
    if (created) {
      s.hub.publish(session.conversationId, 'message', toChatMessage(message), 'vendor');
      if (body.context?.product_id) {
        const conv = await s.store.getConversation(session.conversationId);
        if (conv)
          await s.store.updateConversation(conv.id, {
            state: { ...conv.state, productInView: body.context.product_id },
            lastInboundAt: message.createdAt,
          });
      }
      s.turns.schedule(session.conversationId);
    }
    reply.code(202);
    return toChatMessage(message);
  });

  app.get('/api/v1/chat/events', async (req, reply) => {
    const session = await authenticateChat(s.store, req);
    streamEvents(s.hub, session.conversationId, 'customer', req, reply);
  });

  app.post('/api/v1/chat/uploads', async (req, reply) => {
    const session = await authenticateChat(s.store, req);
    const body = parseBody(UploadBody, req.body);
    const ent = await s.entitlements.get(session.vendorId);
    if (!ent?.features.voice_notes)
      throw new AppError('FEATURE_NOT_IN_PLAN', 'Voice notes need the Pro plan.');
    const id = uuidv7();
    const key = `chat-audio/${id}`;
    s.uploads.reserve(key, session.conversationId, body.content_type, body.size_bytes);
    reply.code(201);
    return {
      storage_key: key,
      upload_url: `${s.config.appBaseUrl}/api/v1/chat/uploads/${id}`,
      method: 'PUT',
      headers: { 'content-type': body.content_type },
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  });

  // The upload URL handed out above: the bytes go to core's storage, and stay here for transcription.
  app.put<{ Params: { id: string } }>('/api/v1/chat/uploads/:id', async (req, reply) => {
    const key = `chat-audio/${req.params.id}`;
    const up = s.uploads.get(key);
    if (!up) throw new AppError('NOT_FOUND', 'Unknown or expired upload.');
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > up.maxBytes)
      throw new AppError(
        'VALIDATION_FAILED',
        'Body must be the audio bytes, within the announced size.',
      );
    if ((req.headers['content-type'] ?? '').split(';')[0] !== up.contentType)
      throw new AppError('VALIDATION_FAILED', 'Content type differs from the announced one.');
    const stored = await s.core.uploadMedia(bytes, up.contentType, {
      actor: `customer:${up.conversationId}`,
    });
    s.uploads.complete(key, bytes, stored.storage_key);
    reply.code(200);
    return { storage_key: key };
  });
}
