// The agent against the real core, in one process: the agent's HTTP client calls core's Fastify app,
// and core's outbox dispatcher delivers signed events to the agent's Fastify app (both through inject).
// Core runs on PGlite with every migration, a simulated Lightning wallet and fixed price feeds.
import { core } from '@selly/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../../../core/src/modules/auth/service';
import { dispatchOnce } from '../../../core/src/modules/events/dispatcher';
import { reconcileOnce } from '../../../core/src/modules/payments/service';
import {
  createShop,
  createTestApp,
  SERVICE_TOKEN,
  type TestApp,
} from '../../../core/src/test-helpers';
import { buildApp } from '../app';
import { HttpCoreClient } from '../core/client';
import { ScriptedProvider, say, toolCall } from '../engine/scripted';
import { MemoryStore } from '../store/memory';

const EVENTS_SECRET = 'e2e-events-secret-0123456789';

/** A fetch that goes to a Fastify app through inject, so no port is opened. */
function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string | undefined,
    });
    return new Response(res.statusCode === 204 ? null : res.body, {
      status: res.statusCode,
      headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') },
    });
  }) as typeof fetch;
}

let t: TestApp;
let shop: Awaited<ReturnType<typeof createShop>>;
let agentApp: ReturnType<typeof buildApp>;
let llm: ScriptedProvider;

beforeAll(async () => {
  t = await createTestApp();
  shop = await createShop(t.db, 'awa-style', { negotiate: true, stock: 3 });
  llm = new ScriptedProvider();
  agentApp = buildApp({
    store: new MemoryStore(),
    core: new HttpCoreClient('http://core.internal', SERVICE_TOKEN, injectFetch(t.app)),
    llm,
    config: {
      appBaseUrl: t.ctx.config.APP_BASE_URL,
      mergeWindowMs: 0,
      turnDeadlineMs: 10_000,
      eventsHmacSecret: EVENTS_SECRET,
      testEndpoint: false,
    },
  });
  await agentApp.ready();
}, 60_000);

afterAll(async () => {
  await agentApp?.close();
  await t?.close();
});

async function send(token: string, text: string, n: number) {
  const res = await agentApp.inject({
    method: 'POST',
    url: '/api/v1/chat/messages',
    headers: { authorization: `Bearer ${token}` },
    payload: { client_message_id: `e2e-message-${n}`, kind: 'text', text },
  });
  expect(res.statusCode).toBe(202);
  await agentApp.services.turns.idle();
}

async function history(token: string) {
  const res = await agentApp.inject({
    method: 'GET',
    url: '/api/v1/chat/messages?limit=100',
    headers: { authorization: `Bearer ${token}` },
  });
  return res.json().data as {
    author: string;
    text: string | null;
    cards: Record<string, unknown>[];
  }[];
}

const toolResult = (i: number) =>
  JSON.parse((llm.requests[i]?.messages.at(-1)?.content[0] as { content: string }).content);

describe('agent with the real core', () => {
  it('chat, search, product, negotiated quote, order, Lightning payment, confirmation in the chat', async () => {
    // 1. The session resolves the store slug and the plan through core.
    const session = await agentApp.inject({
      method: 'POST',
      url: '/api/v1/chat/sessions',
      payload: { store_slug: 'awa-style' },
    });
    expect(session.statusCode).toBe(201);
    const { session_token: token, conversation_id: conversationId } = session.json();
    expect(session.json().store.display_name).toBe('Shop awa-style');

    // 2. Search and product detail, against core's catalog.
    llm.push(
      () => [toolCall('search_products', { query: 'robe noire', size: '42' })],
      () => [toolCall('get_product', { product_id: shop.productId })],
      () => [say('Oui, la robe wax noire existe en 42 à 15 000 FCFA.')],
    );
    await send(token, 'Robe noire en 42 dispo ?', 1);
    const search = toolResult(1);
    expect(search.results[0]).toMatchObject({
      product_id: shop.productId,
      title: 'Robe wax noire',
    });
    expect(search.results[0].variants[0]).toMatchObject({
      variant_id: shop.variantId,
      available: 3,
    });
    const product = toolResult(2);
    expect(product).toMatchObject({
      id: shop.productId,
      price: { amount: 15000, currency: 'XOF' },
    });
    expect((await history(token)).at(-1)?.text).toContain('15 000 FCFA');

    // 3. Negotiated quote: the shop allows at most 10 %.
    const items = [{ variant_id: shop.variantId, quantity: 1 }];
    const delivery = { method: 'delivery', zone_id: 'plateau', address_text: 'Rue 10' };
    llm.push(
      () => [toolCall('quote_cart', { items, delivery, discount_pct: 20 })],
      () => [say('Au mieux 14 500 FCFA livraison comprise. On valide ?')],
    );
    await send(token, 'Dernier prix avec livraison au Plateau ?', 2);
    const quote = toolResult(4);
    expect(quote).toMatchObject({
      applied_discount_pct: 10,
      total: { amount: 14500, currency: 'XOF' },
    });

    // 4. The order, with the discount sent again; core creates the invoice on the (fake) wallet.
    llm.push(
      () => [
        toolCall('create_order', {
          items,
          delivery,
          customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
        }),
      ],
      (req) => {
        const o = JSON.parse((req.messages.at(-1)?.content[0] as { content: string }).content);
        return [
          say(`Commande ${o.number} créée : 14 500 FCFA (${o.total_sat} sats). Touchez « Payer ».`),
        ];
      },
    );
    await send(token, 'Oui, Fatou, +221771234567', 3);
    const created = toolResult(6);
    expect(created).toMatchObject({ total: { amount: 14500, currency: 'XOF' } });
    expect(created.number).toMatch(/^[A-Z0-9]{4}$/);
    const orderMessage = (await history(token)).at(-1);
    expect(orderMessage?.cards[0]).toMatchObject({
      type: 'order',
      number: created.number,
      status: 'pending_payment',
    });

    // 5. The customer pays; core settles the invoice and writes order.paid to the outbox.
    const [invoice] = await t.db.select().from(core.invoices);
    t.provider.pay(invoice?.paymentHash as string);
    await reconcileOnce(t.ctx);

    // 6. Core's dispatcher signs and delivers the event; the agent posts the confirmation.
    // Events are delivered in order per order id, one per pass (order.created, then order.paid), as
    // core's dispatcher loop does.
    let total = 0;
    for (let pass = 0; pass < 10; pass++) {
      const res = await dispatchOnce(t.ctx, {
        agentUrl: 'http://agent.internal',
        secret: EVENTS_SECRET,
        fetch: injectFetch(agentApp),
      });
      expect(res.failed).toBe(0);
      if (res.sent === 0) break;
      total += res.sent;
    }
    expect(total).toBeGreaterThanOrEqual(2);
    await agentApp.services.turns.idle();
    const system = (await history(token)).filter((m) => m.author === 'system');
    expect(system.at(-1)?.text).toBe(`Paiement reçu. Commande ${created.number} confirmée.`);
    expect(system.at(-1)?.cards[0]).toMatchObject({
      type: 'order',
      status: 'paid',
      number: created.number,
    });

    // 7. Order status from the chat, through core.
    llm.push(
      () => [toolCall('get_order_status', { number: created.number })],
      () => [say('Votre commande est payée.')],
    );
    await send(token, `Où en est ma commande ${created.number} ?`, 4);
    expect(toolResult(8)).toMatchObject({ number: created.number, status: 'paid' });
    expect(conversationId).toBeTruthy();
  });

  it('runs the vendor assistant tools against core: stock, price, orders, fulfilment, metrics', async () => {
    agentApp.services.config.testEndpoint = true;
    const turn = async (text: string) => {
      const res = await agentApp.inject({
        method: 'POST',
        url: '/internal/v1/agent/chat',
        headers: { authorization: `Bearer ${agentApp.services.config.serviceToken}` },
        payload: { vendor_id: shop.vendorId, role: 'vendor', message_text: text },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as { reply: { text: string }; tool_calls: { name: string; ok: boolean }[] };
    };
    const lastResult = () =>
      JSON.parse((llm.requests.at(-1)?.messages.at(-1)?.content[0] as { content: string }).content);

    llm.push(
      () => [
        toolCall('adjust_stock', {
          product_ref: 'Robe wax noire',
          options: { size: '42' },
          delta: 5,
          reason: 'restock',
        }),
      ],
      () => [say('Stock mis à jour.')],
    );
    expect((await turn('+5 robes en 42')).tool_calls).toEqual([
      { name: 'adjust_stock', arguments: expect.anything(), ok: true },
    ]);
    expect(lastResult().variant).toMatchObject({ id: shop.variantId });

    llm.push(
      () => [
        toolCall('update_price', {
          product_ref: shop.productId,
          price: { amount: 17000, currency: 'XOF' },
        }),
      ],
      () => [say('Prix changé : 17 000 FCFA.')],
    );
    await turn('La robe wax passe à 17 000');
    expect(lastResult()).toMatchObject({
      product: { price: { amount: 17000 } },
      previous_price: { amount: 15000 },
    });

    llm.push(
      () => [toolCall('list_orders', { period: 'today' })],
      () => [say('Une commande aujourd’hui.')],
    );
    await turn('Commandes du jour ?');
    const orders = lastResult().data as { number: string; status: string }[];
    const paid = orders.find((o) => o.status === 'paid');
    expect(paid).toBeDefined();

    llm.push(
      () => [toolCall('mark_fulfilled', { number: paid?.number })],
      () => [say('Marquée livrée.')],
    );
    await turn(`${paid?.number} livrée`);
    expect(lastResult()).toMatchObject({ number: paid?.number, status: 'fulfilled' });

    llm.push(
      () => [toolCall('get_metrics', { period: '7d' })],
      () => [say('Voici vos ventes.')],
    );
    await turn('Mes ventes de la semaine');
    expect(lastResult()).toMatchObject({ period: '7d', orders: { fulfilled: 1 } });
    agentApp.services.config.testEndpoint = false;
  });

  it('serves the inbox and the assistant on a real vendor session (introspect)', async () => {
    const { token } = await createSession(t.ctx, {
      pubkey: 'c'.repeat(64),
      vendorId: shop.vendorId,
    });
    const vendor = { cookie: `selly_session=${token}`, origin: t.ctx.config.APP_BASE_URL };

    const inbox = await agentApp.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: vendor,
    });
    expect(inbox.statusCode).toBe(200);
    const chat = inbox.json().data[0];
    expect(chat).toMatchObject({ mode: 'bot', customer_label: expect.stringMatching(/^Visiteur/) });

    const takeover = await agentApp.inject({
      method: 'POST',
      url: `/api/v1/conversations/${chat.id}/messages`,
      headers: vendor,
      payload: { client_message_id: 'vendor-real-001', text: 'Bonjour, c’est la vendeuse.' },
    });
    expect(takeover.statusCode).toBe(201);
    expect(takeover.json()).toMatchObject({
      author: 'vendor',
      author_label: 'Shop awa-style (vendeur)',
    });

    llm.push(
      () => [toolCall('get_metrics', { period: 'today' })],
      () => [say('Une commande payée aujourd’hui.')],
    );
    const assistant = await agentApp.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: vendor,
      payload: { client_message_id: 'assistant-real-001', text: 'Mes ventes du jour ?' },
    });
    expect(assistant.statusCode).toBe(200);
    expect(assistant.json().reply.text).toBe('Une commande payée aujourd’hui.');

    const stranger = await agentApp.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { cookie: 'selly_session=not-a-session', origin: t.ctx.config.APP_BASE_URL },
    });
    expect(stranger.statusCode).toBe(401);
  });

  it('refuses events signed with another secret', async () => {
    const res = await dispatchOnce(t.ctx, {
      agentUrl: 'http://agent.internal',
      secret: 'not-the-agent-secret-0000',
      fetch: injectFetch(agentApp),
    });
    expect(res.sent).toBe(0);
  });
});
