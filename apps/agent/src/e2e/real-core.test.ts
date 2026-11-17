// The agent against the real core, in one process: the agent's HTTP client calls core's Fastify app,
// and core's outbox dispatcher delivers signed events to the agent's Fastify app (both through inject).
// Core runs on PGlite with every migration, a simulated Lightning wallet and fixed price feeds.
// Every test creates its own shop, so the tests pass alone and in any order.
import { randomUUID } from 'node:crypto';
import {
  createShop,
  createTestApp,
  createVendorSession,
  dispatchOnce,
  reconcileOnce,
  SERVICE_TOKEN,
  type TestApp,
} from '@selly/core/testing';
import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../app';
import { ScriptedAsr } from '../asr';
import { HttpCoreClient } from '../core/client';
import { ScriptedProvider, say, toolCall } from '../engine/scripted';
import { MemoryStore } from '../store/memory';
import type { Extraction } from '../vision';

const EVENTS_SECRET = 'e2e-events-secret-0123456789';
// A valid 1×1 PNG, for product photos.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A fetch that goes to a Fastify app through inject, so no port is opened. */
function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    let payload: string | Buffer | undefined;
    const headers = { ...(init?.headers as Record<string, string>) };
    if (init?.body instanceof FormData) {
      // Multipart (POST /internal/v1/media): let Response build the body and its boundary.
      const encoded = new Response(init.body);
      headers['content-type'] = encoded.headers.get('content-type') ?? '';
      payload = Buffer.from(await encoded.arrayBuffer());
    } else payload = init?.body as string | undefined;
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers,
      payload,
    });
    return new Response(res.statusCode === 204 ? null : res.body, {
      status: res.statusCode,
      headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') },
    });
  }) as typeof fetch;
}

let t: TestApp;
let agentApp: ReturnType<typeof buildApp>;
let llm: ScriptedProvider;
let coreClient: HttpCoreClient;

beforeAll(async () => {
  t = await createTestApp();
  llm = new ScriptedProvider();
  coreClient = new HttpCoreClient('http://core.internal', SERVICE_TOKEN, injectFetch(t.app));
  agentApp = buildApp({
    store: new MemoryStore(),
    core: coreClient,
    llm,
    asr: new ScriptedAsr({
      text: 'vous avez la robe noire en 42',
      confidence: 0.9,
      language: 'fr',
    }),
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

let shopSeq = 0;
/** A shop of its own for each test: one robe in size 42, a Plateau zone, a Pro plan. */
async function newShop(opts: { stock?: number } = {}) {
  const slug = `shop-e2e-${++shopSeq}`;
  const shop = await createShop(t.db, slug, { negotiate: true, stock: opts.stock ?? 3 });
  return { ...shop, slug };
}
type Shop = Awaited<ReturnType<typeof newShop>>;

async function openChat(slug: string) {
  const res = await agentApp.inject({
    method: 'POST',
    url: '/api/v1/chat/sessions',
    payload: { store_slug: slug },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as {
    session_token: string;
    conversation_id: string;
    store: { display_name: string };
  };
}

let messageSeq = 0;
async function send(token: string, text: string, extra: Record<string, unknown> = {}) {
  const res = await agentApp.inject({
    method: 'POST',
    url: '/api/v1/chat/messages',
    headers: { authorization: `Bearer ${token}` },
    payload: { client_message_id: `e2e-message-${++messageSeq}`, kind: 'text', text, ...extra },
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

/** The tool result the model received in its n-th call since `from` (llm.requests.length before). */
const toolResultAt = (from: number, n: number) =>
  JSON.parse((llm.requests[from + n]?.messages.at(-1)?.content[0] as { content: string }).content);
const lastToolResult = () =>
  JSON.parse((llm.requests.at(-1)?.messages.at(-1)?.content[0] as { content: string }).content);

/** Runs core's dispatcher until the outbox is empty (one event per key and pass). */
async function deliverEvents(secret = EVENTS_SECRET) {
  let sent = 0;
  let failed = 0;
  for (let pass = 0; pass < 10; pass++) {
    const res = await dispatchOnce(t.ctx, {
      agentUrl: 'http://agent.internal',
      secret,
      fetch: injectFetch(agentApp),
    });
    sent += res.sent;
    failed += res.failed;
    if (res.sent === 0) break;
  }
  await agentApp.services.turns.idle();
  return { sent, failed };
}

let orderSeq = 0;
/** An order created through core's internal API and paid on the simulated wallet. */
async function paidOrder(shop: Shop) {
  const created = await coreClient.createOrder(
    shop.vendorId,
    {
      conversation_ref: randomUUID(),
      customer: { display_name: 'Awa', phone_e164: '+221770000099' },
      items: [{ variant_id: shop.variantId, quantity: 1 }],
      delivery: { method: 'pickup' },
      expected_total: { amount: 15000, currency: 'XOF' },
    },
    `e2e-paid-order-${++orderSeq}-0123456789`,
  );
  await payOrder(shop, created.number);
  return created;
}

async function payOrder(shop: Shop, number: string) {
  const [order] = await t.db
    .select()
    .from(core.orders)
    .where(and(eq(core.orders.vendorId, shop.vendorId), eq(core.orders.number, number)));
  const [invoice] = await t.db
    .select()
    .from(core.invoices)
    .where(eq(core.invoices.orderId, order?.id as string));
  t.provider.pay(invoice?.paymentHash as string);
  await reconcileOnce(t.ctx);
}

/** Opens the internal test route for this test only, closed again even when an assertion fails. */
function openTestEndpoint() {
  agentApp.services.config.testEndpoint = true;
  onTestFinished(() => {
    agentApp.services.config.testEndpoint = false;
  });
}

const extraction: Extraction = {
  title: { value: 'Baskets montantes', confidence: 0.9, from: 'image' },
  description: { value: 'Baskets montantes en toile.', confidence: 0.8, from: 'image' },
  category: { value: 'chaussures', confidence: 0.8, from: 'inferred' },
  price: { value: { amount: 20000, currency: 'XOF' }, confidence: 0.95, from: 'text' },
  variants: {
    value: ['40', '41'].map((size) => ({ options: { size, color: null }, stock: 5 })),
    confidence: 0.9,
    from: 'text',
  },
  questions: [],
};

describe('agent with the real core', () => {
  it('chat, search, product, negotiated quote, order, Lightning payment, confirmation in the chat', async () => {
    const shop = await newShop();
    // 1. The session resolves the store slug and the plan through core.
    const { session_token: token, store } = await openChat(shop.slug);
    expect(store.display_name).toBe(`Shop ${shop.slug}`);

    // 2. Search and product detail, against core's catalog.
    let from = llm.requests.length;
    llm.push(
      () => [toolCall('search_products', { query: 'robe noire', size: '42' })],
      () => [toolCall('get_product', { product_id: shop.productId })],
      () => [say('Oui, la robe wax noire existe en 42 à 15 000 FCFA.')],
    );
    await send(token, 'Robe noire en 42 dispo ?');
    expect(toolResultAt(from, 1).results[0]).toMatchObject({
      product_id: shop.productId,
      title: 'Robe wax noire',
    });
    expect(toolResultAt(from, 1).results[0].variants[0]).toMatchObject({
      variant_id: shop.variantId,
      available: 3,
    });
    expect(toolResultAt(from, 2)).toMatchObject({
      id: shop.productId,
      price: { amount: 15000, currency: 'XOF' },
    });
    expect((await history(token)).at(-1)?.text).toContain('15 000 FCFA');

    // 3. Negotiated quote: the shop allows at most 10 %.
    const items = [{ variant_id: shop.variantId, quantity: 1 }];
    const delivery = { method: 'delivery', zone_id: 'plateau', address_text: 'Rue 10' };
    from = llm.requests.length;
    llm.push(
      () => [toolCall('quote_cart', { items, delivery, discount_pct: 20 })],
      () => [say('Au mieux 14 500 FCFA livraison comprise. On valide ?')],
    );
    await send(token, 'Dernier prix avec livraison au Plateau ?');
    expect(toolResultAt(from, 1)).toMatchObject({
      applied_discount_pct: 10,
      total: { amount: 14500, currency: 'XOF' },
    });

    // 4. The order, with the discount sent again; core creates the invoice on the (fake) wallet.
    from = llm.requests.length;
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
    await send(token, 'Oui, Fatou, +221771234567');
    const created = toolResultAt(from, 1);
    expect(created).toMatchObject({ total: { amount: 14500, currency: 'XOF' } });
    expect(created.number).toMatch(/^[A-Z0-9]{4}$/);
    expect((await history(token)).at(-1)?.cards[0]).toMatchObject({
      type: 'order',
      number: created.number,
      status: 'pending_payment',
    });

    // 5. The customer pays; core settles the invoice and writes order.paid to the outbox.
    await payOrder(shop, created.number);

    // 6. Core's dispatcher signs and delivers the events; the agent posts the confirmation.
    const delivered = await deliverEvents();
    expect(delivered.failed).toBe(0);
    expect(delivered.sent).toBeGreaterThanOrEqual(2);
    const system = (await history(token)).filter((m) => m.author === 'system');
    expect(system.at(-1)?.text).toBe(`Paiement reçu. Commande ${created.number} confirmée.`);
    expect(system.at(-1)?.cards[0]).toMatchObject({
      type: 'order',
      status: 'paid',
      number: created.number,
    });

    // 7. Order status from the chat, through core.
    from = llm.requests.length;
    llm.push(
      () => [toolCall('get_order_status', { number: created.number })],
      () => [say('Votre commande est payée.')],
    );
    await send(token, `Où en est ma commande ${created.number} ?`);
    expect(toolResultAt(from, 1)).toMatchObject({ number: created.number, status: 'paid' });
  });

  it('runs the vendor assistant tools against core: stock, price, orders, fulfilment, metrics', async () => {
    const shop = await newShop();
    const paid = await paidOrder(shop);
    openTestEndpoint();
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
    expect(lastToolResult().variant).toMatchObject({ id: shop.variantId });

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
    expect(lastToolResult()).toMatchObject({
      product: { price: { amount: 17000 } },
      previous_price: { amount: 15000 },
    });

    llm.push(
      () => [toolCall('list_orders', { period: 'today' })],
      () => [say('Une commande aujourd’hui.')],
    );
    await turn('Commandes du jour ?');
    expect(lastToolResult().data).toEqual([
      expect.objectContaining({ number: paid.number, status: 'paid' }),
    ]);

    llm.push(
      () => [toolCall('mark_fulfilled', { number: paid.number })],
      () => [say('Marquée livrée.')],
    );
    await turn(`${paid.number} livrée`);
    expect(lastToolResult()).toMatchObject({ number: paid.number, status: 'fulfilled' });

    llm.push(
      () => [toolCall('get_metrics', { period: '7d' })],
      () => [say('Voici vos ventes.')],
    );
    await turn('Mes ventes de la semaine');
    expect(lastToolResult()).toMatchObject({ period: '7d', orders: { fulfilled: 1 } });
  });

  it('serves the inbox and the assistant on a real vendor session (introspect)', async () => {
    const shop = await newShop();
    const chat = await openChat(shop.slug);
    const { cookie } = await createVendorSession(t, shop.vendorId);
    const vendor = { cookie: `selly_session=${cookie}`, origin: t.ctx.config.APP_BASE_URL };

    const inbox = await agentApp.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: vendor,
    });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().data).toEqual([
      expect.objectContaining({
        id: chat.conversation_id,
        mode: 'bot',
        customer_label: expect.stringMatching(/^Visiteur/),
      }),
    ]);

    const takeover = await agentApp.inject({
      method: 'POST',
      url: `/api/v1/conversations/${chat.conversation_id}/messages`,
      headers: vendor,
      payload: {
        client_message_id: `vendor-real-${shop.slug}`,
        text: 'Bonjour, c’est la vendeuse.',
      },
    });
    expect(takeover.statusCode).toBe(201);
    expect(takeover.json()).toMatchObject({
      author: 'vendor',
      author_label: `Shop ${shop.slug} (vendeur)`,
    });

    llm.push(
      () => [toolCall('get_metrics', { period: 'today' })],
      () => [say('Pas encore de vente aujourd’hui.')],
    );
    const assistant = await agentApp.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: vendor,
      payload: { client_message_id: `assistant-real-${shop.slug}`, text: 'Mes ventes du jour ?' },
    });
    expect(assistant.statusCode).toBe(200);
    expect(assistant.json().reply.text).toBe('Pas encore de vente aujourd’hui.');

    // Another vendor's session never sees this shop's chats.
    const other = await newShop();
    const { cookie: otherCookie } = await createVendorSession(t, other.vendorId);
    const otherThread = await agentApp.inject({
      method: 'GET',
      url: `/api/v1/conversations/${chat.conversation_id}/messages`,
      headers: { cookie: `selly_session=${otherCookie}`, origin: t.ctx.config.APP_BASE_URL },
    });
    expect(otherThread.statusCode).toBe(404);

    const stranger = await agentApp.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { cookie: 'selly_session=not-a-session', origin: t.ctx.config.APP_BASE_URL },
    });
    expect(stranger.statusCode).toBe(401);
  });

  it("never reads another shop's product, and refuses an invalid vendor id", async () => {
    const shop = await newShop();
    const other = await newShop();
    const { session_token: token } = await openChat(shop.slug);

    // The model names the other shop's product: core answers 404 for this vendor, the tool says not found.
    const from = llm.requests.length;
    llm.push(
      () => [toolCall('get_product', { product_id: other.productId })],
      () => [say('Je ne trouve pas ce produit.')],
    );
    await send(token, 'Et ce produit-là ?');
    expect(toolResultAt(from, 1)).toMatchObject({ error: 'NOT_FOUND' });
    await expect(coreClient.getProduct(shop.vendorId, other.productId)).rejects.toHaveProperty(
      'status',
      404,
    );

    // An invalid id never leaves the agent; an unknown one gets core's 404.
    await expect(coreClient.getAgentProfile('not-a-vendor-id')).rejects.toHaveProperty(
      'code',
      'NOT_FOUND',
    );
    await expect(coreClient.getAgentProfile(randomUUID())).rejects.toHaveProperty('status', 404);
  });

  it('turns a photo into a product in the assistant: media upload, draft, confirmation', async () => {
    const shop = await newShop();
    const upload = await coreClient.uploadMedia(PNG, 'image/png', {
      actor: `vendor:${shop.vendorId}`,
    });
    expect(upload.storage_key).toMatch(new RegExp(`^vendors/${shop.vendorId}/uploads/`));
    const { cookie } = await createVendorSession(t, shop.vendorId);
    const vendor = { cookie: `selly_session=${cookie}`, origin: t.ctx.config.APP_BASE_URL };

    llm.push(
      () => [
        toolCall('create_product_draft', {
          text: 'Baskets montantes à 20 000, 5 en 40 et 5 en 41',
        }),
      ],
      () => [say(JSON.stringify(extraction))], // the extraction call
      () => [say('Baskets montantes, 20 000 FCFA, 5 en 40 et 5 en 41. Je valide ?')],
    );
    const first = await agentApp.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: vendor,
      payload: {
        client_message_id: `draft-1-${shop.slug}`,
        text: 'Baskets montantes à 20 000, 5 en 40 et 5 en 41',
        image_keys: [upload.storage_key],
      },
    });
    expect(first.statusCode).toBe(200);
    const [draft] = await t.db
      .select()
      .from(core.productDrafts)
      .where(eq(core.productDrafts.vendorId, shop.vendorId));
    expect(draft).toMatchObject({
      status: 'needs_review',
      source: 'assistant',
      imageKeys: [upload.storage_key],
    });

    llm.push(
      () => [toolCall('confirm_product_draft', { draft_id: draft?.id, mode: 'new' })],
      () => [say('Ajouté au catalogue.')],
    );
    const confirmed = await agentApp.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: vendor,
      payload: { client_message_id: `draft-2-${shop.slug}`, text: 'Valider' },
    });
    expect(confirmed.json().reply.text).toBe('Ajouté au catalogue.');
    const products = await t.db
      .select()
      .from(core.products)
      .where(eq(core.products.vendorId, shop.vendorId));
    expect(products.map((p) => p.title).sort()).toEqual(['Baskets montantes', 'Robe wax noire']);
  });

  it('extracts a dashboard draft from draft.requested, with core’s private image links', async () => {
    const shop = await newShop();
    const upload = await coreClient.uploadMedia(PNG, 'image/png', {
      actor: `vendor:${shop.vendorId}`,
    });
    const { cookie } = await createVendorSession(t, shop.vendorId);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/inventory/restock-ai',
      headers: {
        cookie: `selly_session=${cookie}`,
        origin: t.ctx.config.APP_BASE_URL,
        'idempotency-key': `restock-ai-${shop.slug}-0123456789`,
      },
      payload: { image_keys: [upload.storage_key], text: 'Baskets à 20 000' },
    });
    expect(res.statusCode).toBe(202);

    let imageUrl: string | undefined;
    llm.push((req) => {
      imageUrl = (req.messages[0]?.content[0] as { url?: string }).url;
      return [say(JSON.stringify(extraction))];
    });
    await deliverEvents();
    expect(imageUrl).toMatch(/^https?:\/\//);
    const [draft] = await t.db
      .select()
      .from(core.productDrafts)
      .where(eq(core.productDrafts.vendorId, shop.vendorId));
    expect(draft).toMatchObject({ status: 'needs_review', source: 'dashboard' });
  });

  it('stores a customer voice note in core, transcribes it, and alerts the vendor on a handoff', async () => {
    const shop = await newShop();
    const { session_token: token } = await openChat(shop.slug);
    const upload = await agentApp.inject({
      method: 'POST',
      url: '/api/v1/chat/uploads',
      headers: { authorization: `Bearer ${token}` },
      payload: { content_type: 'audio/ogg', size_bytes: 4 },
    });
    expect(upload.statusCode).toBe(201);
    const put = await agentApp.inject({
      method: 'PUT',
      url: new URL(upload.json().upload_url).pathname,
      headers: { 'content-type': 'audio/ogg' },
      payload: Buffer.from([1, 2, 3, 4]),
    });
    expect(put.statusCode).toBe(200);

    const from = llm.requests.length;
    llm.push(
      () => [
        toolCall('handoff_to_vendor', {
          reason: 'customer_request',
          summary: 'Question sur la robe en 42, par vocal',
        }),
      ],
      () => [say('Je préviens la vendeuse, elle vous répond ici.')],
    );
    await send(token, '', { kind: 'audio', media_key: upload.json().storage_key, text: undefined });
    expect(JSON.stringify(llm.requests[from]?.messages)).toContain('vous avez la robe noire en 42');

    const alerts = await t.db
      .select()
      .from(core.vendorNotifications)
      .where(eq(core.vendorNotifications.vendorId, shop.vendorId));
    expect(alerts).toEqual([
      expect.objectContaining({
        type: 'conversation.handoff',
        data: expect.objectContaining({ title: 'Un client attend votre réponse' }),
      }),
    ]);
  });

  it('refuses events signed with another secret', async () => {
    const shop = await newShop();
    await deliverEvents(); // anything left by other tests
    await paidOrder(shop);
    const wrong = await deliverEvents('not-the-agent-secret-0000');
    expect(wrong.sent).toBe(0);
    expect(wrong.failed).toBeGreaterThanOrEqual(1);
    const rows = await t.db
      .select()
      .from(core.outbox)
      .where(eq(core.outbox.lastError, 'agent answered 401'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
