// Vendor inbox and takeover (architecture.md sections 5.2 F and 6.6; docs/api.json tag "Inbox").

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../app';
import { toChatMessage, vendorLabel } from '../conversations';
import { AppError } from '../errors';
import { streamEvents } from './hub';
import { parseBody, parseQuery } from './validate';

const InboxQuery = z.object({
  mode: z.enum(['bot', 'human', 'paused']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const MessagesQuery = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const VendorMessage = z.strictObject({
  client_message_id: z.string().min(8).max(64),
  text: z.string().trim().min(1).max(1000),
});
const ModeBody = z.strictObject({
  mode: z.enum(['bot', 'human', 'paused']),
  minutes: z.number().int().min(1).max(1440).optional(),
});

type IdParams = { Params: { id: string } };

export function registerInboxRoutes(app: FastifyInstance, s: AgentServices) {
  /** The vendor's own customer conversation, or 404 (never another vendor's). */
  async function ownConversation(req: FastifyRequest<IdParams>) {
    const vendorId = await s.vendorAuth.authenticate(req);
    const conv = /^[0-9a-f-]{36}$/i.test(req.params.id)
      ? await s.store.getConversation(req.params.id)
      : null;
    if (!conv || conv.vendorId !== vendorId || conv.role !== 'customer')
      throw new AppError('NOT_FOUND');
    return { vendorId, conv: await s.conversations.refreshMode(conv) };
  }

  app.get('/api/v1/conversations', async (req) => {
    const vendorId = await s.vendorAuth.authenticate(req);
    const q = parseQuery(InboxQuery, req.query);
    const { rows, nextCursor } = await s.store.listInbox({
      vendorId,
      mode: q.mode,
      cursor: q.cursor,
      limit: q.limit,
    });
    const data = [];
    for (const r of rows) {
      const conv = await s.conversations.refreshMode(r.conversation);
      const last = r.lastMessage;
      if (!last) continue;
      data.push({
        id: conv.id,
        channel: conv.channel,
        customer_label: conv.customerLabel ?? 'Visiteur',
        mode: conv.mode,
        human_until: conv.humanUntil?.toISOString() ?? null,
        unread_count: r.unreadCount,
        order_number: conv.state.lastOrderNumber ?? null,
        last_message: {
          author: last.author,
          text: last.text,
          created_at: last.createdAt.toISOString(),
        },
        created_at: conv.createdAt.toISOString(),
      });
    }
    return { data, next_cursor: nextCursor };
  });

  app.get<IdParams>('/api/v1/conversations/:id/messages', async (req) => {
    const { conv } = await ownConversation(req);
    const q = parseQuery(MessagesQuery, req.query);
    const data = await s.store.listMessages(conv.id, { after: q.after, limit: q.limit });
    await s.store.updateConversation(conv.id, { vendorReadAt: new Date() });
    const last = data.at(-1);
    return {
      data: data.map(toChatMessage),
      next_cursor: data.length === q.limit && last ? last.id : null,
    };
  });

  app.get<IdParams>('/api/v1/conversations/:id/events', async (req, reply) => {
    const { conv } = await ownConversation(req);
    streamEvents(s.hub, conv.id, 'vendor', req, reply);
  });

  app.post<IdParams>('/api/v1/conversations/:id/messages', async (req, reply) => {
    let { conv } = await ownConversation(req);
    const body = parseBody(VendorMessage, req.body);
    const profile = await s.profiles.get(conv.vendorId);
    const label = vendorLabel(profile.display_name);
    // Every vendor message keeps the chat in `human` for 30 more minutes (section 6.6).
    conv = await s.conversations.setMode(
      conv,
      'human',
      s.conversations.humanUntilFromNow(),
      'vendor',
      label,
    );
    const pending = await s.store.pendingInbound(conv.id);
    const { message } = await s.conversations.insertAndPublish({
      conversationId: conv.id,
      direction: 'out',
      author: 'vendor',
      authorLabel: label,
      kind: 'text',
      text: body.text,
      clientMessageId: body.client_message_id,
      status: 'processed',
    });
    // The vendor answered what was waiting: the bot will not answer it again when it resumes.
    await s.store.setMessageStatus(
      pending.map((m) => m.id),
      'processed',
    );
    await s.store.updateConversation(conv.id, { vendorReadAt: new Date() });
    reply.code(201);
    return toChatMessage(message);
  });

  app.post<IdParams>('/api/v1/conversations/:id/mode', async (req) => {
    let { conv } = await ownConversation(req);
    const body = parseBody(ModeBody, req.body);
    const profile = await s.profiles.get(conv.vendorId);
    const until =
      body.mode === 'bot'
        ? null
        : body.mode === 'human'
          ? s.conversations.humanUntilFromNow(body.minutes)
          : body.minutes
            ? s.conversations.humanUntilFromNow(body.minutes)
            : null;
    conv = await s.conversations.setMode(
      conv,
      body.mode,
      until,
      'vendor',
      vendorLabel(profile.display_name),
    );
    // Back to bot with a customer message unanswered: the bot answers it (section 4.4).
    if (body.mode === 'bot') s.turns.schedule(conv.id);
    return { id: conv.id, mode: conv.mode, human_until: conv.humanUntil?.toISOString() ?? null };
  });
}
