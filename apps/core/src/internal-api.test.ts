import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertContract } from './contract';
import { BACKOFF_MS, dispatchOnce, MAX_ATTEMPTS } from './modules/events/dispatcher';
import { publishEvent } from './modules/events/outbox';
import { reconcileOnce } from './modules/payments/service';
import {
  createShop,
  createTestApp,
  idemKey,
  orderPayload,
  SERVICE_TOKEN,
  type TestApp,
} from './test-helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

const auth = { authorization: `Bearer ${SERVICE_TOKEN}` };

/** Calls core and checks the answer against docs/api.json for that path template. */
async function call(
  method: 'GET' | 'POST' | 'PATCH',
  template: string,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: { ...auth, ...headers },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
  const body = res.json();
  assertContract(method, template, res.statusCode, body);
  return { status: res.statusCode, body };
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
    checkout_url: string;
  };
};

const setSubscription = (
  vendorId: string,
  values: Partial<typeof core.subscriptions.$inferInsert>,
) => t.db.update(core.subscriptions).set(values).where(eq(core.subscriptions.vendorId, vendorId));

describe('vendor lookup and profile', () => {
  it('finds the vendor behind a slug and says whether the chat may answer', async () => {
    const s = await createShop(t.db, 'ia-lookup');
    const r = await call(
      'GET',
      '/internal/v1/stores/{slug}/vendor',
      '/internal/v1/stores/ia-lookup/vendor',
    );
    expect(r.body).toEqual({
      vendor_id: s.vendorId,
      slug: 'ia-lookup',
      display_name: 'Shop ia-lookup',
      store_status: 'active',
      chat_enabled: true,
      locale: 'fr-SN',
    });
    expect(
      (await call('GET', '/internal/v1/stores/{slug}/vendor', '/internal/v1/stores/nobody/vendor'))
        .status,
    ).toBe(404);
  });

  it('gives the shop facts for the system prompt', async () => {
    const s = await createShop(t.db, 'ia-profile', { negotiate: true });
    const r = await call(
      'GET',
      '/internal/v1/vendors/{id}/agent-profile',
      `/internal/v1/vendors/${s.vendorId}/agent-profile`,
    );
    expect(r.body).toMatchObject({
      vendor_id: s.vendorId,
      pricing_currency: 'XOF',
      tone: 'friendly',
      negotiation: { mode: 'allow', max_discount_pct: 10 },
      delivery: { zones: [{ id: 'plateau', fee: { amount: 1000, currency: 'XOF' } }] },
      store_url: 'http://localhost:3000/s/ia-profile',
      languages: ['fr'],
      whatsapp_link: null,
    });
  });

  it('answers 404, not 500, for a malformed vendor id', async () => {
    expect(
      (
        await call(
          'GET',
          '/internal/v1/vendors/{id}/agent-profile',
          '/internal/v1/vendors/not-a-uuid/agent-profile',
        )
      ).status,
    ).toBe(404);
  });
});

describe('subscription gate', () => {
  it('closes a shop without a plan', async () => {
    const s = await createShop(t.db, 'ia-noplan', { plan: null });
    const r = await call(
      'GET',
      '/internal/v1/stores/{slug}/vendor',
      '/internal/v1/stores/ia-noplan/vendor',
    );
    expect(r.body).toMatchObject({ store_status: 'paused', chat_enabled: false });
    const order = await t.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: orderPayload('ia-noplan', s.variantId),
      headers: { 'idempotency-key': idemKey() },
    });
    expect(order.json()).toMatchObject({ code: 'STORE_PAUSED' });
  });

  it('keeps a lapsed plan open for 7 days of grace, then suspends it', async () => {
    const s = await createShop(t.db, 'ia-grace');
    const url = `/internal/v1/vendors/${s.vendorId}/entitlements`;
    await setSubscription(s.vendorId, { currentPeriodEnd: new Date('2026-11-15T10:00:00Z') }); // ended 2 days ago
    expect((await call('GET', '/internal/v1/vendors/{id}/entitlements', url)).body).toMatchObject({
      store_status: 'active',
      subscription_status: 'grace',
      agent_enabled: true,
    });
    await setSubscription(s.vendorId, { currentPeriodEnd: new Date('2026-11-09T10:00:00Z') }); // ended 8 days ago
    expect((await call('GET', '/internal/v1/vendors/{id}/entitlements', url)).body).toMatchObject({
      store_status: 'paused',
      subscription_status: 'suspended',
      agent_enabled: false,
    });
  });
});

describe('entitlements and usage', () => {
  it('reports the plan, limits and usage, and counts each reference once', async () => {
    const s = await createShop(t.db, 'ia-usage', { plan: 'starter' });
    const ent = await call(
      'GET',
      '/internal/v1/vendors/{id}/entitlements',
      `/internal/v1/vendors/${s.vendorId}/entitlements`,
    );
    expect(ent.body).toEqual({
      vendor_id: s.vendorId,
      store_status: 'active',
      plan_id: 'starter',
      subscription_status: 'active',
      agent_enabled: true,
      features: { voice_notes: false, nostr_dm_alerts: false },
      limits: { products: 30, agent_turns_per_month: 300, drafts_per_month: 10 },
      usage: { products: 1, agent_turns: 0, drafts: 0, month: '2026-11' },
      valid_for_seconds: 60,
    });

    const url = `/internal/v1/vendors/${s.vendorId}/usage`;
    const first = await call('POST', '/internal/v1/vendors/{id}/usage', url, {
      metric: 'agent_turns',
      quantity: 1,
      reference: 'msg-1',
    });
    expect(first.body).toEqual({
      metric: 'agent_turns',
      used: 1,
      limit: 300,
      remaining: 299,
      exceeded: false,
      warning: false,
    });
    const again = await call('POST', '/internal/v1/vendors/{id}/usage', url, {
      metric: 'agent_turns',
      quantity: 1,
      reference: 'msg-1',
    });
    expect(again.body.used).toBe(1);
  });

  it('turns the agent off when the monthly quota is used up', async () => {
    const s = await createShop(t.db, 'ia-quota', { plan: 'starter' });
    await t.db
      .insert(core.usageCounters)
      .values({ vendorId: s.vendorId, metric: 'agent_turns', month: '2026-11-01', used: 239 });
    const url = `/internal/v1/vendors/${s.vendorId}/usage`;
    const warn = await call('POST', '/internal/v1/vendors/{id}/usage', url, {
      metric: 'agent_turns',
      quantity: 1,
      reference: 'w',
    });
    expect(warn.body).toMatchObject({ used: 240, warning: true, exceeded: false });
    await t.db
      .update(core.usageCounters)
      .set({ used: 299 })
      .where(eq(core.usageCounters.vendorId, s.vendorId));
    const last = await call('POST', '/internal/v1/vendors/{id}/usage', url, {
      metric: 'agent_turns',
      quantity: 1,
      reference: 'x',
    });
    expect(last.body).toMatchObject({ used: 300, remaining: 0, exceeded: true });
    const ent = await call(
      'GET',
      '/internal/v1/vendors/{id}/entitlements',
      `/internal/v1/vendors/${s.vendorId}/entitlements`,
    );
    expect(ent.body.agent_enabled).toBe(false);
  });
});

describe('catalog for the agent', () => {
  it('searches by text, size, colour and price, within one vendor', async () => {
    const s = await createShop(t.db, 'ia-search');
    const other = await createShop(t.db, 'ia-search-other');
    const url = (q: string) => `/internal/v1/vendors/${s.vendorId}/products/search?${q}`;
    const tpl = '/internal/v1/vendors/{id}/products/search';

    const found = await call('GET', tpl, url('q=robe&size=T42&color=NOIR'));
    expect(found.body.results).toHaveLength(1);
    expect(found.body.results[0]).toMatchObject({
      product_id: s.productId,
      title: 'Robe wax noire',
      url: 'http://localhost:3000/s/ia-search/p/robe-wax-noire',
      variants: [{ variant_id: s.variantId, available: 3 }],
    });
    expect((await call('GET', tpl, url('q=elegant'))).body.results).toHaveLength(1);
    expect((await call('GET', tpl, url('q=robe&size=44'))).body.results).toHaveLength(0);
    expect((await call('GET', tpl, url('max_price_xof=10000'))).body.results).toHaveLength(0);
    expect((await call('GET', tpl, url('limit=6'))).status).toBe(422);
    // The other shop has the same product; it never shows up here.
    expect(
      found.body.results.some((r: { product_id: string }) => r.product_id === other.productId),
    ).toBe(false);
  });

  it('finds sizes and colours whatever the vendor named the option: taille, pointure, couleur', async () => {
    const s = await createShop(t.db, 'ia-search-fr');
    const url = (q: string) => `/internal/v1/vendors/${s.vendorId}/products/search?${q}`;
    const tpl = '/internal/v1/vendors/{id}/products/search';
    const search = async (q: string) => (await call('GET', tpl, url(q))).body.results;
    const named = (options: Record<string, string>) =>
      t.db
        .update(core.productVariants)
        .set({ options })
        .where(eq(core.productVariants.id, s.variantId));

    await named({ Pointure: '42', Couleur: 'Noir' });
    expect(await search('q=robe&size=42&color=noir')).toHaveLength(1);
    expect(await search('q=robe&size=pointure 42')).toHaveLength(1);
    expect(await search('q=robe&size=44')).toHaveLength(0);
    expect(await search('q=robe&color=rouge')).toHaveLength(0);

    await named({ taille: 'M' });
    expect(await search('q=robe&size=m')).toHaveLength(1);
    expect(await search('q=robe&size=L')).toHaveLength(0);

    // An option that is not a size never answers for one.
    await named({ format: '42' });
    expect(await search('q=robe&size=42')).toHaveLength(0);
  });

  it('gives exact stock for a product of this vendor only', async () => {
    const s = await createShop(t.db, 'ia-detail');
    const other = await createShop(t.db, 'ia-detail-other');
    const tpl = '/internal/v1/vendors/{id}/products/{product_id}';
    const own = await call(
      'GET',
      tpl,
      `/internal/v1/vendors/${s.vendorId}/products/${s.productId}`,
    );
    expect(own.body.variants[0]).toMatchObject({ id: s.variantId, available: 3 });
    expect(
      (await call('GET', tpl, `/internal/v1/vendors/${s.vendorId}/products/${other.productId}`))
        .status,
    ).toBe(404);
    expect(
      (await call('GET', tpl, `/internal/v1/vendors/${s.vendorId}/products/..%2Fvendors`)).status,
    ).toBe(404);
  });

  it('changes a price and records the old one', async () => {
    const s = await createShop(t.db, 'ia-price');
    const other = await createShop(t.db, 'ia-price-other');
    const tpl = '/internal/v1/vendors/{id}/products/{product_id}';
    const url = `/internal/v1/vendors/${s.vendorId}/products/${s.productId}`;
    const r = await call(
      'PATCH',
      tpl,
      url,
      { price: { amount: 17000, currency: 'XOF' } },
      { 'x-actor': `vendor:${s.vendorId}` },
    );
    expect(r.body).toMatchObject({
      price: { amount: 17000, currency: 'XOF' },
      variants: [{ on_hand: 3, reserved: 0, available: 3 }],
    });
    const [log] = await t.db
      .select()
      .from(core.auditLog)
      .where(and(eq(core.auditLog.action, 'price.changed'), eq(core.auditLog.target, s.productId)));
    expect(log).toMatchObject({
      actor: `vendor:${s.vendorId}`,
      details: { from: 15000, to: 17000, change_pct: 13 },
    });

    expect(
      (await call('PATCH', tpl, url, { price: { amount: 17000, currency: 'SAT' } })).status,
    ).toBe(422);
    expect((await call('PATCH', tpl, url, { image_keys: ['uploads/x.jpg'] })).status).toBe(422);
    expect(
      (
        await call('PATCH', tpl, `/internal/v1/vendors/${s.vendorId}/products/${other.productId}`, {
          status: 'hidden',
        })
      ).status,
    ).toBe(404);
  });
});

describe('stock commands', () => {
  it('restocks and sets stock, never below what pending orders hold', async () => {
    const s = await createShop(t.db, 'ia-stock');
    const other = await createShop(t.db, 'ia-stock-other');
    const tpl = '/internal/v1/vendors/{id}/variants/{variant_id}/adjustments';
    const url = `/internal/v1/vendors/${s.vendorId}/variants/${s.variantId}/adjustments`;

    const up = await call(
      'POST',
      tpl,
      url,
      { delta: 2, reason: 'restock' },
      { 'x-actor': `vendor:${s.vendorId}` },
    );
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      variant: { on_hand: 5, available: 5 },
      movement: { delta_on_hand: 2, reason: 'restock' },
    });
    const [mv] = await t.db
      .select()
      .from(core.inventoryMovements)
      .where(eq(core.inventoryMovements.variantId, s.variantId));
    expect(mv?.actor).toBe(`vendor:${s.vendorId}`);

    await placeOrder('ia-stock', s.variantId);
    const tooLow = await call('POST', tpl, url, { set_to: 0, reason: 'adjustment' });
    expect(tooLow.status).toBe(422);
    const set = await call('POST', tpl, url, { set_to: 1, reason: 'adjustment' });
    expect(set.body.variant).toMatchObject({ on_hand: 1, reserved: 1, available: 0 });

    expect((await call('POST', tpl, url, { delta: 1, set_to: 1, reason: 'restock' })).status).toBe(
      422,
    );
    expect(
      (
        await call(
          'POST',
          tpl,
          `/internal/v1/vendors/${s.vendorId}/variants/${other.variantId}/adjustments`,
          { delta: 1, reason: 'restock' },
        )
      ).status,
    ).toBe(404);
  });
});

describe('orders for the agent', () => {
  it('finds an order by number or id, lists, fulfils and counts', async () => {
    const s = await createShop(t.db, 'ia-orders', { stock: 10 });
    const other = await createShop(t.db, 'ia-orders-other');
    const a = await placeOrder('ia-orders', s.variantId, '+221770000001');
    await placeOrder('ia-orders', s.variantId, '+221770000002');

    const byNumber = await call(
      'GET',
      '/internal/v1/vendors/{id}/orders/{order_ref}',
      `/internal/v1/vendors/${s.vendorId}/orders/${a.order.number.toLowerCase()}`,
    );
    expect(byNumber.body).toEqual({
      number: a.order.number,
      status: 'pending_payment',
      paid_at: null,
      fulfilled_at: null,
      total: { amount: 16000, currency: 'XOF' },
    });
    expect(
      (
        await call(
          'GET',
          '/internal/v1/vendors/{id}/orders/{order_ref}',
          `/internal/v1/vendors/${s.vendorId}/orders/${a.order.id}`,
        )
      ).body.number,
    ).toBe(a.order.number);
    expect(
      (
        await call(
          'GET',
          '/internal/v1/vendors/{id}/orders/{order_ref}',
          `/internal/v1/vendors/${other.vendorId}/orders/${a.order.number}`,
        )
      ).status,
    ).toBe(404);

    const fulfil = `/internal/v1/vendors/${s.vendorId}/orders/${a.order.number}/fulfill`;
    const tplF = '/internal/v1/vendors/{id}/orders/{order_ref}/fulfill';
    expect((await call('POST', tplF, fulfil, {})).status).toBe(422); // not paid yet

    t.provider.pay(a.invoice.payment_hash);
    await reconcileOnce(t.ctx);
    const done = await call(
      'POST',
      tplF,
      fulfil,
      { note: 'Livré par Moussa' },
      { 'x-actor': `vendor:${s.vendorId}` },
    );
    expect(done.body).toMatchObject({ status: 'fulfilled', fulfilled_at: '2026-11-17T10:00:00Z' });
    expect((await call('POST', tplF, fulfil, {})).body.status).toBe('fulfilled'); // idempotent
    const events = (
      await t.db.select().from(core.outbox).where(eq(core.outbox.topic, 'order.fulfilled'))
    ).filter((e) => e.key === a.order.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      data: { number: a.order.number, checkout_url: a.checkout_url },
    });

    const list = await call(
      'GET',
      '/internal/v1/vendors/{id}/orders',
      `/internal/v1/vendors/${s.vendorId}/orders?period=today`,
    );
    expect(list.body.data).toHaveLength(2);
    const paid = await call(
      'GET',
      '/internal/v1/vendors/{id}/orders',
      `/internal/v1/vendors/${s.vendorId}/orders?status=pending_payment`,
    );
    expect(paid.body.data).toHaveLength(1);

    const m = await call(
      'GET',
      '/internal/v1/vendors/{id}/metrics',
      `/internal/v1/vendors/${s.vendorId}/metrics?period=7d`,
    );
    expect(m.body).toMatchObject({
      period: '7d',
      orders: { created: 2, paid: 1, fulfilled: 1, pending: 1, expired: 0 },
      revenue: { xof: 16000, sat: 27103 },
      chats_waiting: 0,
    });
  });
});

describe('event dispatcher', () => {
  const SECRET = 'test-events-secret';
  let server: Server;
  let agentUrl: string;
  const received: { body: string; signature: string; type: string }[] = [];
  let failNext = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (failNext > 0) {
          failNext--;
          res.statusCode = 503;
          return res.end();
        }
        received.push({
          body,
          signature: String(req.headers['x-selly-signature']),
          type: JSON.parse(body).type,
        });
        res.setHeader('content-type', 'application/json');
        res.end('{"received":true,"duplicate":false}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    agentUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Start from an empty outbox: earlier tests wrote events.
    await t.db.update(core.outbox).set({ publishedAt: new Date() });
    // Events belong to a real vendor (the vendor_notifications foreign key checks it).
    eventVendorId = (await createShop(t.db, 'ia-dispatch')).vendorId;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  let eventVendorId = '';
  const deps = () => ({ agentUrl, secret: SECRET });
  const emit = (key: string, type: 'order.paid' | 'order.expired' | 'order.created') =>
    t.db.transaction((tx) =>
      publishEvent(tx, {
        type,
        vendorId: eventVendorId,
        key,
        data: { order_id: key },
        now: t.ctx.now(),
      }),
    );

  it('signs each event the way the agent checks it', async () => {
    await emit('k-sign', 'order.paid');
    expect(await dispatchOnce(t.ctx, deps())).toEqual({ sent: 1, failed: 0 });
    const got = received.at(-1);
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(got?.signature ?? '');
    expect(m).not.toBeNull();
    const expected = createHmac('sha256', SECRET).update(`${m?.[1]}.${got?.body}`).digest('hex');
    expect(m?.[2]).toBe(expected);
    expect(Math.abs(Number(m?.[1]) - Date.now() / 1000)).toBeLessThan(60);
    expect(JSON.parse(got?.body ?? '{}')).toMatchObject({
      type: 'order.paid',
      data: { order_id: 'k-sign' },
    });
  });

  it('keeps the order per key, backs off, and lets other keys through', async () => {
    received.length = 0;
    await emit('k-a', 'order.created');
    await emit('k-a', 'order.paid');
    await emit('k-b', 'order.created');

    failNext = 1; // the first delivery (k-a created) fails
    expect(await dispatchOnce(t.ctx, deps())).toEqual({ sent: 1, failed: 1 });
    expect(received.map((r) => JSON.parse(r.body).data.order_id)).toEqual(['k-b']); // k-a paid waits behind k-a created

    // Not due yet: nothing is sent before the backoff.
    expect(await dispatchOnce(t.ctx, deps())).toEqual({ sent: 0, failed: 0 });
    t.clock.advance(BACKOFF_MS[0] as number);
    // One event per key per pass: the next one goes once the previous one is delivered.
    expect(await dispatchOnce(t.ctx, deps())).toEqual({ sent: 1, failed: 0 });
    expect(await dispatchOnce(t.ctx, deps())).toEqual({ sent: 1, failed: 0 });
    expect(received.map((r) => `${JSON.parse(r.body).data.order_id}:${r.type}`)).toEqual([
      'k-b:order.created',
      'k-a:order.created',
      'k-a:order.paid',
    ]);
  });

  it('dead-letters an event the agent never accepts, then moves on', async () => {
    received.length = 0;
    await emit('k-dead', 'order.created');
    await emit('k-dead', 'order.paid');
    failNext = MAX_ATTEMPTS;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await dispatchOnce(t.ctx, deps());
      t.clock.advance(3_600_000);
    }
    const [dead] = (
      await t.db.select().from(core.outbox).where(eq(core.outbox.key, 'k-dead'))
    ).filter((e) => e.topic === 'order.created');
    expect(dead).toMatchObject({ attempts: MAX_ATTEMPTS, publishedAt: null });
    expect(dead?.lastError).toContain('503');
    // The later event for the same key is no longer held back.
    await dispatchOnce(t.ctx, deps());
    expect(received.map((r) => r.type)).toEqual(['order.paid']);
  });
});
