// Internal agent API (architecture.md sections 5.2 H and 5.3.8): core events, and one synchronous turn for tests.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../app';
import { toChatMessage } from '../conversations';
import type { CoreEvent, OrderCard, OrderStatus } from '../core/types';
import { AppError } from '../errors';
import { isVendorImageKey, toDraftExtracted } from '../vision';
import { checkServiceToken, verifyEventSignature } from './auth';
import { parseBody } from './validate';

const EventBody = z.object({
  event_id: z.uuid(),
  type: z.enum([
    'order.created',
    'order.paid',
    'order.expired',
    'order.cancelled',
    'order.fulfilled',
    'draft.requested',
    'wallet.degraded',
    'wallet.restored',
    'stock.low',
    'entitlements.changed',
  ]),
  occurred_at: z.string(),
  vendor_id: z.uuid(),
  data: z.record(z.string(), z.unknown()),
});

const ChatBody = z.strictObject({
  vendor_id: z.uuid(),
  conversation_ref: z.uuid().optional(),
  role: z.enum(['customer', 'vendor']).optional(),
  message_text: z.string().min(1).max(1000),
});

const ORDER_MESSAGES: Partial<
  Record<CoreEvent['type'], { status: OrderStatus; text: (n: string) => string }>
> = {
  'order.paid': { status: 'paid', text: (n) => `Paiement reçu. Commande ${n} confirmée.` },
  'order.expired': {
    status: 'expired',
    text: (n) =>
      `Le lien de paiement de la commande ${n} a expiré. Ouvrez la commande pour obtenir un nouveau lien.`,
  },
  'order.cancelled': { status: 'cancelled', text: (n) => `La commande ${n} a été annulée.` },
  'order.fulfilled': {
    status: 'fulfilled',
    text: (n) => `Bonne nouvelle : la commande ${n} est expédiée.`,
  },
};

export function registerInternalRoutes(app: FastifyInstance, s: AgentServices) {
  app.post('/internal/v1/events', async (req) => {
    const sig = req.headers['x-selly-signature'];
    if (
      !verifyEventSignature(
        Array.isArray(sig) ? sig[0] : sig,
        req.rawBody ?? '',
        s.config.eventsHmacSecret,
      )
    )
      throw new AppError('UNAUTHORIZED', 'Invalid event signature.');
    const event = parseBody(EventBody, req.body) as CoreEvent;
    if (await s.store.hasProcessedEvent(event.event_id)) return { received: true, duplicate: true };
    // Handlers are idempotent (messages carry the event id), so a crash before the mark is safe to redeliver.
    await handleEvent(s, event, req.log);
    const first = await s.store.markEventProcessed(event.event_id, event.type);
    return { received: true, duplicate: !first };
  });

  app.post('/internal/v1/agent/chat', async (req) => {
    checkServiceToken(req, s.config.serviceToken);
    if (!s.config.testEndpoint) throw new AppError('FORBIDDEN', 'Disabled in production.');
    const body = parseBody(ChatBody, req.body);
    const role = body.role ?? 'customer';
    let conv = body.conversation_ref ? await s.store.getConversation(body.conversation_ref) : null;
    if (conv && conv.vendorId !== body.vendor_id)
      throw new AppError('FORBIDDEN', 'Conversation of another vendor.');
    conv ??= await s.store.upsertConversation({
      vendorId: body.vendor_id,
      channel: 'web',
      role,
      externalUserId:
        role === 'vendor' ? body.vendor_id : `test:${body.conversation_ref ?? randomUUID()}`,
      customerLabel: role === 'customer' ? 'Test' : null,
    });
    if (conv.mode !== 'bot')
      throw new AppError('VALIDATION_FAILED', `Conversation is in ${conv.mode} mode.`);
    await s.store.insertMessage({
      conversationId: conv.id,
      direction: 'in',
      author: role,
      kind: 'text',
      text: body.message_text,
      clientMessageId: `test-${randomUUID()}`,
      status: 'accepted',
    });
    const outcome = await s.turns.runNow(conv.id);
    if (!outcome) throw new AppError('VALIDATION_FAILED', 'No turn ran.');
    return {
      reply: toChatMessage(outcome.reply),
      tool_calls: outcome.result?.toolCalls ?? [],
      usage: {
        input_tokens: outcome.result?.usage.inputTokens ?? 0,
        output_tokens: outcome.result?.usage.outputTokens ?? 0,
        latency_ms: outcome.result?.usage.latencyMs ?? 0,
      },
    };
  });
}

function ownCheckoutUrl(value: unknown, appBaseUrl: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const app = new URL(appBaseUrl);
    return url.origin === app.origin && url.pathname.startsWith('/c/') ? url.toString() : null;
  } catch {
    return null;
  }
}

async function handleEvent(
  s: AgentServices,
  event: CoreEvent,
  log: { warn: (o: object, m: string) => void },
) {
  const d = event.data;
  const order = ORDER_MESSAGES[event.type];
  if (order) {
    const ref = typeof d.conversation_ref === 'string' ? d.conversation_ref : null;
    const conv = ref ? await s.store.getConversation(ref) : null;
    if (!conv || conv.vendorId !== event.vendor_id) return;
    const number = String(d.number ?? '');
    const total = (d.total as OrderCard['total'] | undefined) ?? {
      amount: 0,
      currency: 'XOF' as const,
    };
    const card: OrderCard = {
      type: 'order',
      number,
      status: order.status,
      total,
      total_sat: Number(d.total_sat ?? 0),
      // Links in cards bypass the text filter: only a checkout URL on our own domain is accepted.
      checkout_url:
        ownCheckoutUrl(d.checkout_url, s.config.appBaseUrl) ??
        conv.state.orders?.[number] ??
        `${s.config.appBaseUrl}/s`,
      expires_at: null,
    };
    await s.conversations.insertAndPublish({
      conversationId: conv.id,
      direction: 'out',
      author: 'system',
      kind: 'system',
      text: order.text(number),
      cards: card.total.amount > 0 || card.status !== 'paid' ? [card] : [],
      clientMessageId: `event:${event.event_id}`,
      status: 'processed',
    });
    return;
  }

  switch (event.type) {
    case 'entitlements.changed':
      s.entitlements.invalidate(event.vendor_id);
      s.profiles.invalidate(event.vendor_id);
      return;
    case 'draft.requested': {
      // A dashboard upload (restock-ai): extract in the background, core gets the draft back (section 5.3.6).
      const draftId = String(d.draft_id ?? '');
      const imageKeys = (Array.isArray(d.image_keys) ? d.image_keys.map(String) : []).filter((k) =>
        isVendorImageKey(k, event.vendor_id),
      );
      const text = typeof d.input_text === 'string' ? d.input_text : undefined;
      s.track(
        s.extractor
          .extract({ imageKeys, text, vendorId: event.vendor_id })
          .then(async (x) => {
            await s.core.upsertDraft(event.vendor_id, {
              draft_id: draftId,
              image_keys: imageKeys,
              input_text: text,
              extracted: toDraftExtracted(x),
              questions: x.questions,
            });
            await s.usage.report(event.vendor_id, {
              metric: 'drafts',
              quantity: 1,
              reference: draftId,
            });
          })
          .catch((err) => log.warn({ err, draftId }, 'draft extraction failed')),
      );
      return;
    }
    default:
      // order.created, wallet.*, stock.low: nothing to do in the agent for now.
      return;
  }
}
