// Vendor inbox and takeover (architecture.md sections 5.2 F and 6.6; docs/api.json tag "Inbox").

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../app';
import { toChatMessage, vendorLabel } from '../conversations';
import type { Card } from '../core/types';
import { AppError } from '../errors';
import { streamEvents } from './hub';
import { parseBody, parseQuery } from './validate';

const InboxQuery = z.object({
  mode: z.enum(['bot', 'human', 'paused']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const MessagesQuery = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const VendorMessage = z
  .strictObject({
    client_message_id: z.string().min(8).max(64),
    text: z.string().trim().min(1).max(1000).optional(),
    // Products the vendor shows the customer, as cards in the chat (the same cards the agent sends).
    product_ids: z.array(z.uuid()).min(1).max(3).optional(),
  })
  .refine((b) => Boolean(b.text || b.product_ids?.length), {
    message: 'text or product_ids is required',
  });
const cartItems = z
  .array(z.strictObject({ variant_id: z.uuid(), quantity: z.number().int().min(1).max(50) }))
  .min(1)
  .max(20);
const deliveryInput = z.strictObject({
  method: z.enum(['delivery', 'pickup']),
  zone_id: z.string().max(60).optional(),
  address_text: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});
const QuoteBody = z.strictObject({ items: cartItems, delivery: deliveryInput });
const VendorOrderBody = z.strictObject({
  client_message_id: z.string().min(8).max(64),
  customer: z.strictObject({
    display_name: z.string().trim().min(2).max(60),
    phone_e164: z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'Use the international format'),
  }),
  items: cartItems,
  delivery: deliveryInput,
  // The total the vendor saw (POST .../quotes): core refuses the order if its own total differs (PRICE_CHANGED).
  expected_total: z.strictObject({
    amount: z.number().int().min(0),
    currency: z.enum(['XOF', 'SAT']),
  }),
  text: z.string().trim().min(1).max(1000).optional(),
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
    const cards: Card[] = [];
    for (const id of body.product_ids ?? []) {
      const d = await s.core.getProduct(conv.vendorId, id);
      cards.push({
        type: 'product',
        product_id: d.id,
        title: d.title,
        price: d.price,
        image_url: d.images[0]?.url ?? null,
        url: d.url,
      });
    }
    const pending = await s.store.pendingInbound(conv.id);
    const { message } = await s.conversations.insertAndPublish({
      conversationId: conv.id,
      direction: 'out',
      author: 'vendor',
      authorLabel: label,
      kind: 'text',
      text: body.text ?? null,
      cards,
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

  // The vendor sells in the chat (section 6.6): the exact total for what they agreed with the customer...
  app.post<IdParams>('/api/v1/conversations/:id/quotes', async (req) => {
    const { conv } = await ownConversation(req);
    const body = parseBody(QuoteBody, req.body);
    return s.core.createCartQuote(conv.vendorId, body);
  });

  // ...then the order, tied to this conversation, sent as an order card: the customer pays from its « Payer »
  // button on the payment page, as with an order the agent made.
  app.post<IdParams>('/api/v1/conversations/:id/orders', async (req, reply) => {
    let { conv } = await ownConversation(req);
    const body = parseBody(VendorOrderBody, req.body);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 16 || key.length > 64)
      throw new AppError(
        'VALIDATION_FAILED',
        'An Idempotency-Key header (16 to 64 characters) is required.',
      );
    const order = await s.core.createOrder(
      conv.vendorId,
      {
        conversation_ref: conv.id,
        customer: body.customer,
        items: body.items,
        delivery: body.delivery,
        expected_total: body.expected_total,
      },
      key,
    );
    const profile = await s.profiles.get(conv.vendorId);
    const label = vendorLabel(profile.display_name);
    conv = await s.conversations.setMode(
      conv,
      'human',
      s.conversations.humanUntilFromNow(),
      'vendor',
      label,
    );
    const total = new Intl.NumberFormat('fr-FR').format(order.total.amount);
    const { message } = await s.conversations.insertAndPublish({
      conversationId: conv.id,
      direction: 'out',
      author: 'vendor',
      authorLabel: label,
      kind: 'order_link',
      text:
        body.text ??
        `Voici votre commande ${order.number} : ${total} ${order.total.currency === 'XOF' ? 'FCFA' : 'sats'}. Touchez « Payer » pour la régler.`,
      cards: [
        {
          type: 'order',
          number: order.number,
          status: 'pending_payment',
          total: order.total,
          total_sat: order.total_sat,
          checkout_url: order.checkout_url,
          expires_at: order.expires_at,
        },
      ],
      clientMessageId: body.client_message_id,
      status: 'processed',
    });
    // The agent knows the order if it answers later (« c'est payé ? »).
    await s.store.updateConversation(conv.id, {
      vendorReadAt: new Date(),
      state: {
        ...conv.state,
        lastOrderNumber: order.number,
        orders: { ...(conv.state.orders ?? {}), [order.number]: order.checkout_url },
        customer: body.customer,
        cart: undefined,
        lastQuote: undefined,
      },
    });
    reply.code(201);
    return { order, message: toChatMessage(message) };
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
