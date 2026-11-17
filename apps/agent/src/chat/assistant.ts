// The vendor assistant in the dashboard (architecture.md sections 6.5 and 8.1; docs/api.json tag "Assistant").
// Same engine in vendor mode; the reply comes back in the same response (20 s budget, section 7.1).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../app';
import { toChatMessage } from '../conversations';
import { AppError } from '../errors';
import type { StoredMessage } from '../store/types';
import { parseBody, parseQuery } from './validate';

const AssistantBody = z
  .strictObject({
    client_message_id: z.string().min(8).max(64),
    text: z.string().max(1000).optional(),
    image_keys: z.array(z.string().min(1).max(300)).max(6).optional(),
    quick_reply_id: z.string().max(64).optional(),
  })
  .refine((b) => Boolean(b.text?.trim() || b.image_keys?.length || b.quick_reply_id), {
    message: 'text, image_keys or quick_reply_id is required',
  });
const ListQuery = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ASSISTANT_BUDGET_MS = 20_000;

export function registerAssistantRoutes(app: FastifyInstance, s: AgentServices) {
  const conversationFor = (vendorId: string) =>
    s.store.upsertConversation({
      vendorId,
      channel: 'web',
      role: 'vendor',
      externalUserId: vendorId,
    });

  /** The agent's reply that follows a vendor message, if any. */
  async function replyAfter(conversationId: string, message: StoredMessage) {
    const after = await s.store.listMessages(conversationId, { after: message.id, limit: 20 });
    return after.find((m) => m.direction === 'out' && m.author === 'agent') ?? null;
  }

  app.get('/api/v1/assistant/messages', async (req) => {
    const vendorId = await s.vendorAuth.authenticate(req);
    const q = parseQuery(ListQuery, req.query);
    const conv = await conversationFor(vendorId);
    const data = await s.store.listMessages(conv.id, { after: q.after, limit: q.limit });
    const last = data.at(-1);
    return {
      data: data.map(toChatMessage),
      next_cursor: data.length === q.limit && last ? last.id : null,
    };
  });

  app.post('/api/v1/assistant/messages', async (req) => {
    const vendorId = await s.vendorAuth.authenticate(req);
    const body = parseBody(AssistantBody, req.body);
    const conv = await conversationFor(vendorId);
    const { message, created } = await s.store.insertMessage({
      conversationId: conv.id,
      direction: 'in',
      author: 'vendor',
      kind: body.image_keys?.length ? 'image' : 'text',
      text: body.text?.trim() || null,
      imageKeys: body.image_keys ?? [],
      quickReplyId: body.quick_reply_id ?? null,
      clientMessageId: body.client_message_id,
      status: 'accepted',
    });

    if (!created) {
      // A retry: answer with what the first request produced.
      const existing = await replyAfter(conv.id, message);
      if (existing) return { message: toChatMessage(message), reply: toChatMessage(existing) };
    }

    const turn = s.turns.runNow(conv.id);
    const timeout = new Promise<'timeout'>((r) =>
      setTimeout(() => r('timeout'), ASSISTANT_BUDGET_MS).unref(),
    );
    const outcome = await Promise.race([turn, timeout]);
    if (outcome === 'timeout')
      throw new AppError('PROVIDER_TIMEOUT', 'The assistant took too long. Try again.');
    const reply = outcome?.reply ?? (await replyAfter(conv.id, message));
    if (!reply) throw new AppError('PROVIDER_TIMEOUT', 'No reply was produced. Try again.');
    return {
      message: { ...toChatMessage(message), status: 'processed' },
      reply: toChatMessage(reply),
    };
  });
}
