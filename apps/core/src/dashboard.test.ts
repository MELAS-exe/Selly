import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Imported the way another package would: through the testing entry point.
import {
  assertContract,
  createShop,
  createTestApp,
  createVendorSession,
  idemKey,
  orderPayload,
  reconcileOnce,
  SERVICE_TOKEN,
  type TestApp,
} from './testing';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

const ORIGIN = 'http://localhost:3000';
let ipSeq = 0;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  template: string,
  url: string,
  opts: {
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = `selly_session=${opts.cookie}`;
  const res = await t.app.inject({
    method,
    url,
    headers,
    remoteAddress: `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  const body = res.body ? res.json() : undefined;
  if (res.statusCode !== 204 && res.statusCode !== 202)
    assertContract(method, template, res.statusCode, body);
  return { status: res.statusCode, body };
}

async function shopWithSession(slug: string, opts: Parameters<typeof createShop>[2] = {}) {
  const s = await createShop(t.db, slug, opts);
  const { cookie } = await createVendorSession(t, s.vendorId);
  return { ...s, cookie };
}

const placeOrder = async (slug: string, variantId: string, phone = '+221771234567') => {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    payload: orderPayload(slug, variantId, {
      customer: { display_name: 'Fatou', phone_e164: phone },
    }),
    headers: { 'idempotency-key': idemKey() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as {
    order: { id: string; number: string; public_token: string };
    invoice: { payment_hash: string };
  };
};

const variant = (id: string) =>
  t.db
    .select()
    .from(core.productVariants)
    .where(eq(core.productVariants.id, id))
    .then((r) => r[0]);

describe('testing entry point', () => {
  it('opens a vendor session that core introspection accepts', async () => {
    const s = await createShop(t.db, 'dash-session');
    const { cookie, pubkey } = await createVendorSession(t, s.vendorId);
    const r = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/sessions/introspect',
      payload: { session_cookie: cookie },
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    expect(r.json()).toEqual({
      valid: true,
      vendor_id: s.vendorId,
      pubkey,
      step_up_expires_at: null,
    });
  });
});

describe('catalog in the dashboard', () => {
  const create = (cookie: string, body: unknown, key = idemKey()) =>
    call('POST', '/api/v1/inventory', '/api/v1/inventory', {
      body,
      cookie,
      headers: { 'idempotency-key': key },
    });
  const product = {
    title: 'Robe wax noire',
    description: 'Deuxième modèle',
    price: { amount: 18000, currency: 'XOF' },
    variants: [
      { options: { size: '40' }, on_hand: 2 },
      { options: { size: '42' }, on_hand: 0 },
    ],
  };

  it('creates a product with its stock, a unique slug, and replays idempotently', async () => {
    const shop = await shopWithSession('dash-cat');
    const key = idemKey();
    const r = await create(shop.cookie, product, key);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      title: 'Robe wax noire',
      status: 'active',
      price: { amount: 18000 },
      variants: [{ on_hand: 2 }, { on_hand: 0 }],
    });
    const [row] = await t.db.select().from(core.products).where(eq(core.products.id, r.body.id));
    expect(row?.slug).toBe('robe-wax-noire-2'); // the shop already has robe-wax-noire
    const moves = await t.db
      .select()
      .from(core.inventoryMovements)
      .where(eq(core.inventoryMovements.variantId, r.body.variants[0].id));
    expect(moves).toEqual([
      expect.objectContaining({
        reason: 'restock',
        deltaOnHand: 2,
        actor: `vendor:${shop.vendorId}`,
      }),
    ]);

    expect((await create(shop.cookie, product, key)).body.id).toBe(r.body.id);
    // The public storefront shows it.
    expect(
      (await t.app.inject({ url: '/api/v1/stores/dash-cat/products/robe-wax-noire-2' })).statusCode,
    ).toBe(200);
  });

  it('refuses images, another currency, duplicate options, and a missing Origin', async () => {
    const shop = await shopWithSession('dash-cat-bad');
    expect(
      (await create(shop.cookie, { ...product, image_keys: ['vendors/x/a.jpg'] })).status,
    ).toBe(422);
    expect(
      (await create(shop.cookie, { ...product, price: { amount: 5000, currency: 'SAT' } })).status,
    ).toBe(422);
    expect(
      (
        await create(shop.cookie, {
          ...product,
          variants: [
            { options: { size: '40' }, on_hand: 1 },
            { options: { size: '40' }, on_hand: 1 },
          ],
        })
      ).status,
    ).toBe(422);
    const noOrigin = await call('POST', '/api/v1/inventory', '/api/v1/inventory', {
      body: product,
      cookie: shop.cookie,
      origin: null,
      headers: { 'idempotency-key': idemKey() },
    });
    expect(noOrigin.body).toMatchObject({ code: 'FORBIDDEN' });
    expect((await call('GET', '/api/v1/inventory', '/api/v1/inventory')).status).toBe(401);
  });

  it('enforces the plan product limit', async () => {
    const shop = await shopWithSession('dash-limit', { plan: 'starter' });
    await t.db.insert(core.products).values(
      Array.from({ length: 29 }, (_, i) => ({
        vendorId: shop.vendorId,
        title: `Article ${i}`,
        slug: `article-${i}`,
        priceAmount: 1000,
      })),
    );
    const r = await create(shop.cookie, product);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      errors: [{ limit: 'products', used: 30, max: 30, upgrade_to: 'pro' }],
    });

    const none = await shopWithSession('dash-noplan', { plan: null });
    expect((await create(none.cookie, product)).body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      detail: 'Choose a plan to add products.',
    });
  });

  it('lists products by page, filters, edits and changes stock', async () => {
    const shop = await shopWithSession('dash-list');
    await create(shop.cookie, { ...product, title: 'Sac en cuir' });
    const page1 = await call('GET', '/api/v1/inventory', '/api/v1/inventory?limit=1', {
      cookie: shop.cookie,
    });
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.data[0].title).toBe('Sac en cuir');
    const page2 = await call(
      'GET',
      '/api/v1/inventory',
      `/api/v1/inventory?limit=1&cursor=${page1.body.next_cursor}`,
      { cookie: shop.cookie },
    );
    expect(page2.body.data[0].title).toBe('Robe wax noire');
    expect(page2.body.next_cursor).toBeNull();
    expect(
      (await call('GET', '/api/v1/inventory', '/api/v1/inventory?q=cuir', { cookie: shop.cookie }))
        .body.data,
    ).toHaveLength(1);
    expect(
      (
        await call('GET', '/api/v1/inventory', '/api/v1/inventory?cursor=bad', {
          cookie: shop.cookie,
        })
      ).status,
    ).toBe(422);

    const hidden = await call(
      'PATCH',
      '/api/v1/inventory/{product_id}',
      `/api/v1/inventory/${shop.productId}`,
      { body: { status: 'hidden' }, cookie: shop.cookie },
    );
    expect(hidden.body.status).toBe('hidden');
    expect(
      (
        await call('GET', '/api/v1/inventory', '/api/v1/inventory?status=hidden', {
          cookie: shop.cookie,
        })
      ).body.data,
    ).toHaveLength(1);

    const adj = await call(
      'POST',
      '/api/v1/inventory/variants/{variant_id}/adjustments',
      `/api/v1/inventory/variants/${shop.variantId}/adjustments`,
      { body: { delta: 4, reason: 'restock' }, cookie: shop.cookie },
    );
    expect(adj.status).toBe(201);
    expect(adj.body.variant).toMatchObject({ on_hand: 7, available: 7 });

    const other = await shopWithSession('dash-list-other');
    expect(
      (
        await call(
          'PATCH',
          '/api/v1/inventory/{product_id}',
          `/api/v1/inventory/${shop.productId}`,
          { body: { status: 'active' }, cookie: other.cookie },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          'POST',
          '/api/v1/inventory/variants/{variant_id}/adjustments',
          `/api/v1/inventory/variants/${shop.variantId}/adjustments`,
          { body: { delta: 1, reason: 'restock' }, cookie: other.cookie },
        )
      ).status,
    ).toBe(404);
  });
});

describe('orders in the dashboard', () => {
  it('lists, shows, fulfils and cancels orders, within the shop', async () => {
    const shop = await shopWithSession('dash-orders', { stock: 10 });
    const a = await placeOrder('dash-orders', shop.variantId, '+221770000001');
    const b = await placeOrder('dash-orders', shop.variantId, '+221770000002');
    const c = await placeOrder('dash-orders', shop.variantId, '+221770000003');

    const list = await call('GET', '/api/v1/orders', '/api/v1/orders?limit=2', {
      cookie: shop.cookie,
    });
    expect(list.body.data.map((o: { number: string }) => o.number)).toEqual([
      c.order.number,
      b.order.number,
    ]);
    const rest = await call(
      'GET',
      '/api/v1/orders',
      `/api/v1/orders?limit=2&cursor=${list.body.next_cursor}`,
      { cookie: shop.cookie },
    );
    expect(rest.body.data.map((o: { number: string }) => o.number)).toEqual([a.order.number]);

    const detail = await call('GET', '/api/v1/orders/{id}', `/api/v1/orders/${a.order.id}`, {
      cookie: shop.cookie,
    });
    expect(detail.body).toMatchObject({
      customer: { display_name: 'Fatou', phone_e164: '+221770000001' },
      delivery: { method: 'delivery', zone_id: 'plateau', address_text: 'Rue 10' },
      total: { amount: 16000 },
    });

    // Cancel an unpaid order: its stock comes back and its invoice is cancelled.
    expect((await variant(shop.variantId))?.reserved).toBe(3);
    const cancel = await call(
      'POST',
      '/api/v1/orders/{id}/cancel',
      `/api/v1/orders/${b.order.id}/cancel`,
      { body: { reason: 'Le client a annulé' }, cookie: shop.cookie },
    );
    expect(cancel.body).toMatchObject({ status: 'cancelled', cancel_reason: 'Le client a annulé' });
    expect((await variant(shop.variantId))?.reserved).toBe(2);
    const [inv] = await t.db
      .select()
      .from(core.invoices)
      .where(eq(core.invoices.orderId, b.order.id));
    expect(inv?.status).toBe('cancelled');
    expect(
      (
        await call('POST', '/api/v1/orders/{id}/cancel', `/api/v1/orders/${b.order.id}/cancel`, {
          body: { reason: 'Encore' },
          cookie: shop.cookie,
        })
      ).body.cancel_reason,
    ).toBe('Le client a annulé');

    // Pay a, fulfil it; then it cannot be cancelled.
    t.provider.pay(a.invoice.payment_hash);
    await reconcileOnce(t.ctx);
    const done = await call(
      'PATCH',
      '/api/v1/orders/{id}/fulfill',
      `/api/v1/orders/${a.order.id}/fulfill`,
      { body: { note: 'Livré' }, cookie: shop.cookie },
    );
    expect(done.body).toMatchObject({ status: 'fulfilled' });
    expect(
      (
        await call('POST', '/api/v1/orders/{id}/cancel', `/api/v1/orders/${a.order.id}/cancel`, {
          body: { reason: 'Trop tard' },
          cookie: shop.cookie,
        })
      ).status,
    ).toBe(422);

    // Pay c, cancel it: stock is not touched (the vendor refunds and adjusts by hand).
    t.provider.pay(c.invoice.payment_hash);
    await reconcileOnce(t.ctx);
    const before = await variant(shop.variantId);
    await call('POST', '/api/v1/orders/{id}/cancel', `/api/v1/orders/${c.order.id}/cancel`, {
      body: { reason: 'Rupture' },
      cookie: shop.cookie,
    });
    expect(await variant(shop.variantId)).toEqual(before);

    const events = (
      await t.db.select().from(core.outbox).where(eq(core.outbox.topic, 'order.cancelled'))
    ).filter((e) => [b.order.id, c.order.id].includes(e.key));
    expect(events).toHaveLength(2);

    const other = await shopWithSession('dash-orders-other');
    expect(
      (
        await call('GET', '/api/v1/orders/{id}', `/api/v1/orders/${a.order.id}`, {
          cookie: other.cookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('GET', '/api/v1/orders', '/api/v1/orders', { cookie: other.cookie })).body.data,
    ).toEqual([]);

    const m = await call(
      'GET',
      '/api/v1/vendors/dashboard/metrics',
      '/api/v1/vendors/dashboard/metrics?period=today',
      { cookie: shop.cookie },
    );
    expect(m.body).toMatchObject({
      orders: { created: 3, paid: 2, fulfilled: 1, pending: 0 },
      revenue: { xof: 16000 },
    });
  });
});

describe('web push registration', () => {
  it('stores a browser, moves a re-registered endpoint, and refuses http', async () => {
    const shop = await shopWithSession('dash-push');
    const other = await shopWithSession('dash-push-other');
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQt',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    };
    const r = await call(
      'POST',
      '/api/v1/vendors/me/push-subscriptions',
      '/api/v1/vendors/me/push-subscriptions',
      { body: sub, cookie: shop.cookie },
    );
    expect(r.status).toBe(201);
    await call(
      'POST',
      '/api/v1/vendors/me/push-subscriptions',
      '/api/v1/vendors/me/push-subscriptions',
      { body: sub, cookie: other.cookie },
    );
    const rows = await t.db
      .select()
      .from(core.pushSubscriptions)
      .where(eq(core.pushSubscriptions.endpoint, sub.endpoint));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vendorId).toBe(other.vendorId);
    expect(
      (
        await call(
          'POST',
          '/api/v1/vendors/me/push-subscriptions',
          '/api/v1/vendors/me/push-subscriptions',
          { body: { ...sub, endpoint: 'http://push.example/x' }, cookie: shop.cookie },
        )
      ).status,
    ).toBe(422);
  });
});

describe('live stream', () => {
  let base = '';
  beforeAll(async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  });

  function open(cookie: string, lastEventId?: string) {
    const ctrl = new AbortController();
    let text = '';
    let ended = false;
    const ready = fetch(`${base}/api/v1/vendors/me/events`, {
      headers: {
        cookie: `selly_session=${cookie}`,
        ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
      },
      signal: ctrl.signal,
    }).then(async (res) => {
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += dec.decode(value);
          }
        } catch {
          /* aborted */
        }
        ended = true;
      })();
    });
    const events = () =>
      [...text.matchAll(/event: (\S+)\nid: (\S+)\ndata: (.+)\n/g)].map((m) => ({
        type: m[1] as string,
        id: m[2] as string,
        data: JSON.parse(m[3] as string),
      }));
    return { ready, events, ended: () => ended, close: () => ctrl.abort() };
  }

  const notify = (vendorId: string, body: unknown) =>
    t.app.inject({
      method: 'POST',
      url: `/internal/v1/vendors/${vendorId}/notifications`,
      payload: body as object,
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

  it('streams order events, handoffs (once per 5 minutes) and resumes from Last-Event-ID', async () => {
    const shop = await shopWithSession('dash-stream');
    // An older notification is not replayed to a new stream.
    await notify(shop.vendorId, { type: 'conversation.new', title: 'Ancien' });
    const s = open(shop.cookie);
    await s.ready;

    const o = await placeOrder('dash-stream', shop.variantId);
    t.provider.pay(o.invoice.payment_hash);
    await reconcileOnce(t.ctx);
    const conv = '0193a8f4-6f7a-7b8c-9d0e-1f2a3b4c5d99';
    expect(
      (
        await notify(shop.vendorId, {
          type: 'conversation.handoff',
          conversation_id: conv,
          title: 'Fatou veut vous parler',
          url: `/app/chats/${conv}`,
        })
      ).statusCode,
    ).toBe(202);
    await notify(shop.vendorId, {
      type: 'conversation.handoff',
      conversation_id: conv,
      title: 'Encore',
    });

    await expect
      .poll(() => s.events().map((e) => e.type), { timeout: 3000 })
      .toEqual(['order.created', 'order.paid', 'conversation.handoff']);
    expect(s.events()[1]?.data).toMatchObject({
      number: o.order.number,
      total: { amount: 16000, currency: 'XOF' },
      total_sat: 27103,
    });
    expect(s.events()[2]?.data).toMatchObject({
      title: 'Fatou veut vous parler',
      conversation_id: conv,
      url: `/app/chats/${conv}`,
    });
    s.close();

    // Reconnect after the first event: the next two come again, nothing else.
    const resumed = open(shop.cookie, s.events()[0]?.id);
    await resumed.ready;
    await expect
      .poll(() => resumed.events().map((e) => e.type), { timeout: 3000 })
      .toEqual(['order.paid', 'conversation.handoff']);
    resumed.close();
  });

  it('stops streaming to a signed-out device', async () => {
    const shop = await shopWithSession('dash-stream-out');
    const s = open(shop.cookie);
    await s.ready;
    await t.db
      .update(core.vendorSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(core.vendorSessions.vendorId, shop.vendorId)));
    await expect.poll(() => s.ended(), { timeout: 3000 }).toBe(true);
  });

  it('warns the vendor once when the agent quota passes 80 % and 100 %', async () => {
    const shop = await shopWithSession('dash-quota', { plan: 'starter' });
    await t.db
      .insert(core.usageCounters)
      .values({ vendorId: shop.vendorId, metric: 'agent_turns', month: '2026-11-01', used: 238 });
    const report = (reference: string) =>
      t.app.inject({
        method: 'POST',
        url: `/internal/v1/vendors/${shop.vendorId}/usage`,
        payload: { metric: 'agent_turns', quantity: 1, reference },
        headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
      });
    for (const r of ['u1', 'u2', 'u3']) await report(r); // 239, 240 (80 %), 241
    await t.db
      .update(core.usageCounters)
      .set({ used: 299 })
      .where(eq(core.usageCounters.vendorId, shop.vendorId));
    await report('u4'); // 300 (100 %)
    await report('u5'); // 301, no new warning
    const warnings = await t.db
      .select()
      .from(core.vendorNotifications)
      .where(
        and(
          eq(core.vendorNotifications.vendorId, shop.vendorId),
          eq(core.vendorNotifications.type, 'usage.warning'),
        ),
      );
    expect(warnings.map((w) => (w.data as { percent: number }).percent).sort()).toEqual([100, 80]);
  });
});
