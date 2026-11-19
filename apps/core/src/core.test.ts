import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { reconcileOnce, settleInvoice } from './modules/payments/service';
import { RateService } from './modules/rates/service';
import {
  createShop,
  createTestApp,
  feed,
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

const available = async (variantId: string) => {
  const [v] = await t.db
    .select()
    .from(core.productVariants)
    .where(eq(core.productVariants.id, variantId));
  return { onHand: v!.onHand, reserved: v!.reserved };
};
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url, payload: payload as object, headers });

describe('platform', () => {
  it('answers health and renders problem+json for unknown routes', async () => {
    expect((await t.app.inject({ url: '/healthz' })).json()).toEqual({
      status: 'ok',
      service: 'core',
    });
    const res = await t.app.inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('lists the three plans with indicative FCFA prices', async () => {
    const res = await t.app.inject({ url: '/api/v1/plans' });
    const body = res.json();
    expect(body.data.map((p: { id: string }) => p.id)).toEqual(['starter', 'pro', 'business']);
    const pro = body.data[1];
    expect(
      pro.periods.map((p: { months: number; price_sat: number; discount_pct: number }) => [
        p.months,
        p.price_sat,
        p.discount_pct,
      ]),
    ).toEqual([
      [1, 15000, 0],
      [3, 42750, 5],
      [12, 150000, 17],
    ]);
    expect(pro.periods[0].indicative_xof).toBe(8855);
    expect(body.trial).toEqual({ plan_id: 'pro', days: 14 });
  });

  it('serves the BTC/XOF rate', async () => {
    const res = await t.app.inject({ url: '/api/v1/rates/btc-xof' });
    expect(res.json()).toMatchObject({ xof_per_btc: 59036130, source: 'index' });
  });
});

describe('rates', () => {
  it('takes the median, reuses a stale quote, and fails when nothing is fresh', async () => {
    const down = new Error('down');
    let now = new Date('2026-11-17T10:00:00Z');
    const rates = new RateService(
      t.db,
      [feed('a', 8_000_000n), feed('b', 9_000_000n), feed('c', 10_000_000n)],
      () => now,
    );
    expect((await rates.current()).xofPerBtcCents).toBe(5_903_613_000); // median is 90,000 EUR

    now = new Date(now.getTime() + 5 * 60_000);
    const stale = new RateService(t.db, [feed('a', down), feed('b', down)], () => now);
    expect((await stale.current()).xofPerBtcCents).toBe(5_903_613_000); // under 10 minutes old

    now = new Date(now.getTime() + 20 * 60_000);
    await expect(stale.current()).rejects.toMatchObject({ code: 'RATE_UNAVAILABLE' });
  });
});

describe('storefront', () => {
  it('shows the store, searches without accents, and hides stock counts', async () => {
    const s = await createShop(t.db, 'boutique-a');
    const store = (await t.app.inject({ url: '/api/v1/stores/boutique-a' })).json();
    expect(store.store).toMatchObject({
      slug: 'boutique-a',
      status: 'active',
      chat: { enabled: true, reason: null },
      payment_options: ['lightning'],
    });
    expect(store.products[0]).toMatchObject({
      slug: 'robe-wax-noire',
      availability: 'low',
      options: { size: ['42'], color: ['noir'] },
    });

    const found = (
      await t.app.inject({ url: '/api/v1/stores/boutique-a/products?q=elegant' })
    ).json();
    expect(found.data).toHaveLength(1);
    const none = (
      await t.app.inject({ url: '/api/v1/stores/boutique-a/products?q=chaussure' })
    ).json();
    expect(none.data).toHaveLength(0);

    const detail = (
      await t.app.inject({ url: '/api/v1/stores/boutique-a/products/robe-wax-noire' })
    ).json();
    expect(detail.variants[0].available).toBeNull();
    const exact = (
      await t.app.inject({
        url: `/api/v1/stores/boutique-a/products/${s.productId}?variant_id=${s.variantId}`,
      })
    ).json();
    expect(exact.variants[0].available).toBe(3);

    expect((await t.app.inject({ url: '/api/v1/stores/unknown-shop' })).statusCode).toBe(404);
  });

  it('closes the shop when the operator suspends it', async () => {
    const s = await createShop(t.db, 'boutique-b');
    await t.db
      .update(core.vendors)
      .set({ status: 'suspended' })
      .where(eq(core.vendors.id, s.vendorId));
    const store = (await t.app.inject({ url: '/api/v1/stores/boutique-b' })).json();
    expect(store.store.status).toBe('paused');
    expect(store.products).toEqual([]);
    const res = await post('/api/v1/orders', orderPayload('boutique-b', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(res.json()).toMatchObject({ code: 'STORE_PAUSED' });
  });
});

describe('orders', () => {
  it('quotes a cart: 15,000 plus 1,000 delivery is 16,000 FCFA and 27,103 sats', async () => {
    const s = await createShop(t.db, 'boutique-c');
    const res = await post('/api/v1/stores/boutique-c/cart-quotes', {
      items: [{ variant_id: s.variantId, quantity: 1 }],
      delivery: { method: 'delivery', zone_id: 'plateau' },
    });
    expect(res.json()).toMatchObject({
      subtotal: { amount: 15000 },
      delivery_fee: { amount: 1000 },
      total: { amount: 16000, currency: 'XOF' },
      total_sat: 27103,
    });
  });

  it('creates an order, reserves stock and replays idempotently', async () => {
    const s = await createShop(t.db, 'boutique-d');
    const key = idemKey();
    const res = await post('/api/v1/orders', orderPayload('boutique-d', s.variantId), {
      'idempotency-key': key,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.order).toMatchObject({
      status: 'pending_payment',
      total: { amount: 16000 },
      total_sat: 27103,
    });
    expect(body.order.number).toMatch(/^[A-Z0-9]{4}$/);
    expect(body.order.public_token).toHaveLength(22);
    expect(body.invoice).toMatchObject({ amount_msat: 27103000, status: 'pending' });
    expect(body.checkout_url).toContain(`/c/${body.order.public_token}`);
    expect(await available(s.variantId)).toEqual({ onHand: 3, reserved: 1 });

    const replay = await post('/api/v1/orders', orderPayload('boutique-d', s.variantId), {
      'idempotency-key': key,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(body);
    expect(await available(s.variantId)).toEqual({ onHand: 3, reserved: 1 });

    const other = await post(
      '/api/v1/orders',
      orderPayload('boutique-d', s.variantId, { expected_total: { amount: 1, currency: 'XOF' } }),
      { 'idempotency-key': key },
    );
    expect(other.json()).toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });

    const outbox = await t.db
      .select()
      .from(core.outbox)
      .where(eq(core.outbox.topic, 'order.created'));
    expect(
      outbox.some(
        (o) => (o.payload as { data: { number: string } }).data.number === body.order.number,
      ),
    ).toBe(true);
  });

  it('rejects a stale price, missing key, and unknown zone', async () => {
    const s = await createShop(t.db, 'boutique-e');
    const stale = await post(
      '/api/v1/orders',
      orderPayload('boutique-e', s.variantId, {
        expected_total: { amount: 15000, currency: 'XOF' },
      }),
      { 'idempotency-key': idemKey() },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'PRICE_CHANGED' });

    const noKey = await post('/api/v1/orders', orderPayload('boutique-e', s.variantId));
    expect(noKey.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    const zone = await post(
      '/api/v1/orders',
      orderPayload('boutique-e', s.variantId, {
        delivery: { method: 'delivery', zone_id: 'kaolack' },
      }),
      { 'idempotency-key': idemKey() },
    );
    expect(zone.statusCode).toBe(422);
    expect(await available(s.variantId)).toEqual({ onHand: 3, reserved: 0 });
  });

  it('refuses to oversell the last unit', async () => {
    const s = await createShop(t.db, 'boutique-f', { stock: 1 });
    const first = await post('/api/v1/orders', orderPayload('boutique-f', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(first.statusCode).toBe(201);
    const second = await post(
      '/api/v1/orders',
      orderPayload('boutique-f', s.variantId, {
        customer: { display_name: 'Moussa', phone_e164: '+221770000099' },
      }),
      { 'idempotency-key': idemKey() },
    );
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      code: 'OUT_OF_STOCK',
      errors: [{ variant_id: s.variantId, available: 0 }],
    });
  });

  it('creates no order and holds no stock when the wallet is down', async () => {
    const s = await createShop(t.db, 'boutique-g');
    t.provider.failNext = true;
    const res = await post('/api/v1/orders', orderPayload('boutique-g', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
    expect(await available(s.variantId)).toEqual({ onHand: 3, reserved: 0 });
    const rows = await t.db.select().from(core.orders).where(eq(core.orders.vendorId, s.vendorId));
    expect(rows).toHaveLength(0);
  });

  it('limits unpaid orders per customer to three', async () => {
    const s = await createShop(t.db, 'boutique-h', { stock: 10 });
    for (let i = 0; i < 3; i++) {
      const ok = await post('/api/v1/orders', orderPayload('boutique-h', s.variantId), {
        'idempotency-key': idemKey(),
      });
      expect(ok.statusCode).toBe(201);
    }
    const fourth = await post('/api/v1/orders', orderPayload('boutique-h', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toMatchObject({ code: 'TOO_MANY_PENDING_ORDERS' });
  });
});

describe('payment and expiry', () => {
  const place = async (slug: string, variantId: string) => {
    const res = await post('/api/v1/orders', orderPayload(slug, variantId), {
      'idempotency-key': idemKey(),
    });
    return res.json() as {
      order: { id: string; public_token: string };
      invoice: { payment_hash: string; bolt11: string };
    };
  };

  it('settles a paid invoice once: order paid, stock sold, event written', async () => {
    const s = await createShop(t.db, 'boutique-i');
    const o = await place('boutique-i', s.variantId);
    const token = o.order.public_token;

    const view = (await t.app.inject({ url: `/api/v1/checkout/${token}` })).json();
    expect(view.invoice.qr_svg).toContain('<svg');
    expect(view.store).toMatchObject({ slug: 'boutique-i' });

    await reconcileOnce(t.ctx);
    expect((await t.app.inject({ url: `/api/v1/checkout/${token}/status` })).json().status).toBe(
      'pending_payment',
    );

    t.provider.pay(o.invoice.payment_hash);
    await reconcileOnce(t.ctx);
    await reconcileOnce(t.ctx); // idempotent
    const status = (await t.app.inject({ url: `/api/v1/checkout/${token}/status` })).json();
    expect(status).toMatchObject({ status: 'paid', invoice_status: 'settled' });
    expect(await available(s.variantId)).toEqual({ onHand: 2, reserved: 0 });

    const paid = (
      await t.db.select().from(core.outbox).where(eq(core.outbox.topic, 'order.paid'))
    ).filter((e) => (e.payload as { data: { order_id: string } }).data.order_id === o.order.id);
    expect(paid).toHaveLength(1);
    expect(paid[0]!.payload).toMatchObject({
      type: 'order.paid',
      vendor_id: s.vendorId,
      data: { total: { amount: 16000, currency: 'XOF' }, total_sat: 27103 },
    });
  });

  it('never settles with a wrong preimage or another vendor', async () => {
    const a = await createShop(t.db, 'boutique-j');
    const b = await createShop(t.db, 'boutique-k');
    const o = await place('boutique-j', a.variantId);
    await expect(
      settleInvoice(t.ctx, {
        vendorId: a.vendorId,
        paymentHash: o.invoice.payment_hash,
        preimage: '00'.repeat(32),
      }),
    ).rejects.toThrow();
    expect(
      await settleInvoice(t.ctx, { vendorId: b.vendorId, paymentHash: o.invoice.payment_hash }),
    ).toBe('unknown');
  });

  it('expires an unpaid order, frees the stock, and accepts a late payment', async () => {
    const s = await createShop(t.db, 'boutique-l', { stock: 1 });
    const o = await place('boutique-l', s.variantId);
    expect(await available(s.variantId)).toEqual({ onHand: 1, reserved: 1 });

    t.clock.advance(23 * 60_000); // 20 minute invoice plus 2 minutes of grace
    const res = await reconcileOnce(t.ctx);
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect(await available(s.variantId)).toEqual({ onHand: 1, reserved: 0 });
    expect(
      (await t.app.inject({ url: `/api/v1/checkout/${o.order.public_token}/status` })).json()
        .status,
    ).toBe('expired');

    // The customer pays the old invoice anyway: recorded, and the order is taken because the stock is free.
    t.provider.pay(o.invoice.payment_hash);
    const preimage = await t.provider.lookupInvoice({
      vendorId: s.vendorId,
      paymentHash: o.invoice.payment_hash,
    });
    expect(
      await settleInvoice(t.ctx, {
        vendorId: s.vendorId,
        paymentHash: o.invoice.payment_hash,
        ...(preimage.preimage ? { preimage: preimage.preimage } : {}),
      }),
    ).toBe('settled');
    expect(
      (await t.app.inject({ url: `/api/v1/checkout/${o.order.public_token}/status` })).json()
        .status,
    ).toBe('paid');
    expect(await available(s.variantId)).toEqual({ onHand: 0, reserved: 0 });
  });

  it('flags a late payment when the stock is gone', async () => {
    const s = await createShop(t.db, 'boutique-m', { stock: 1 });
    const o = await place('boutique-m', s.variantId);
    t.clock.advance(23 * 60_000);
    await reconcileOnce(t.ctx);
    // Someone else takes the unit.
    const other = await post(
      '/api/v1/orders',
      orderPayload('boutique-m', s.variantId, {
        customer: { display_name: 'Moussa', phone_e164: '+221770000077' },
      }),
      { 'idempotency-key': idemKey() },
    );
    expect(other.statusCode).toBe(201);

    expect(
      await settleInvoice(t.ctx, { vendorId: s.vendorId, paymentHash: o.invoice.payment_hash }),
    ).toBe('settled');
    const [row] = await t.db.select().from(core.orders).where(eq(core.orders.id, o.order.id));
    expect(row).toMatchObject({ status: 'expired', attention: 'paid_without_stock' });
  });

  it('renews an expired invoice and reserves the stock again', async () => {
    const s = await createShop(t.db, 'boutique-n');
    const o = await place('boutique-n', s.variantId);
    t.clock.advance(23 * 60_000);
    await reconcileOnce(t.ctx);

    const res = await post(
      `/api/v1/checkout/${o.order.public_token}/invoice`,
      {},
      { 'idempotency-key': idemKey() },
    );
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.order.status).toBe('pending_payment');
    expect(body.invoice.payment_hash).not.toBe(o.invoice.payment_hash);
    expect(await available(s.variantId)).toEqual({ onHand: 3, reserved: 1 });
  });

  it('streams status changes over SSE', async () => {
    const s = await createShop(t.db, 'boutique-o');
    const o = await place('boutique-o', s.variantId);
    await t.app.listen({ port: 0 });
    const addr = t.app.server.address() as { port: number };
    const ctrl = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${addr.port}/api/v1/checkout/${o.order.public_token}/events`,
      { signal: ctrl.signal },
    );
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let seen = '';
    const read = async (until: string) => {
      while (!seen.includes(until)) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += dec.decode(value);
      }
    };
    await read('pending_payment');
    t.provider.pay(o.invoice.payment_hash);
    await reconcileOnce(t.ctx);
    await read('"status":"paid"');
    ctrl.abort();
    expect(seen).toContain('event: status');
    expect(seen).toContain('"status":"paid"');
  });
});

describe('internal API (agent)', () => {
  it('needs the service token', async () => {
    const s = await createShop(t.db, 'boutique-p', { negotiate: true });
    const url = `/internal/v1/vendors/${s.vendorId}/cart-quotes`;
    const body = {
      items: [{ variant_id: s.variantId, quantity: 1 }],
      delivery: { method: 'pickup' },
      discount_pct: 15,
    };
    expect((await post(url, body)).statusCode).toBe(401);
    expect((await post(url, body, { authorization: 'Bearer wrong-token-value' })).statusCode).toBe(
      401,
    );
    const ok = await post(url, body, { authorization: `Bearer ${SERVICE_TOKEN}` });
    expect(ok.statusCode).toBe(200);
    // Core enforces the vendor's 10 % limit whatever the model asks for.
    expect(ok.json()).toMatchObject({
      max_discount_pct: 10,
      applied_discount_pct: 10,
      discount: { amount: 1500 },
      total: { amount: 13500 },
      delivery_included: true,
    });

    // While bargaining the delivery is not chosen yet: items and discount only, and it says so. Orders still
    // need a delivery (the agent quotes again with it before create_order).
    const { delivery: _, ...noDelivery } = body;
    const early = await post(url, noDelivery, { authorization: `Bearer ${SERVICE_TOKEN}` });
    expect(early.statusCode, early.body).toBe(200);
    expect(early.json()).toMatchObject({
      delivery_fee: { amount: 0 },
      total: { amount: 13500 },
      delivery_included: false,
    });
  });

  it('creates an order for a chat customer and ties it to the conversation', async () => {
    const s = await createShop(t.db, 'boutique-q');
    const conv = '0193a8f4-6f7a-7b8c-9d0e-1f2a3b4c5d6e';
    const res = await post(
      `/internal/v1/vendors/${s.vendorId}/orders`,
      {
        conversation_ref: conv,
        customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
        items: [{ variant_id: s.variantId, quantity: 1 }],
        delivery: { method: 'delivery', zone_id: 'plateau' },
        expected_total: { amount: 16000, currency: 'XOF' },
      },
      { authorization: `Bearer ${SERVICE_TOKEN}`, 'idempotency-key': idemKey() },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ total: { amount: 16000 }, total_sat: 27103 });
    const [row] = await t.db.select().from(core.orders).where(eq(core.orders.vendorId, s.vendorId));
    expect(row?.conversationRef).toBe(conv);
  });

  it('keeps a negotiated discount when the agent creates the order', async () => {
    const s = await createShop(t.db, 'boutique-r', { negotiate: true });
    const headers = { authorization: `Bearer ${SERVICE_TOKEN}` };
    const base = {
      conversation_ref: '0193a8f4-6f7a-7b8c-9d0e-1f2a3b4c5d70',
      customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
      items: [{ variant_id: s.variantId, quantity: 1 }],
      delivery: { method: 'pickup' },
    };
    const url = `/internal/v1/vendors/${s.vendorId}/orders`;

    // The customer asked for 15 %; the vendor allows 10 %: 15,000 - 1,500 = 13,500, pickup is free.
    const quote = (
      await post(
        `/internal/v1/vendors/${s.vendorId}/cart-quotes`,
        { items: base.items, delivery: base.delivery, discount_pct: 15 },
        headers,
      )
    ).json();
    expect(quote.total).toEqual({ amount: 13500, currency: 'XOF' });

    const res = await post(
      url,
      { ...base, discount_pct: 15, expected_total: quote.total },
      { ...headers, 'idempotency-key': idemKey() },
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().total).toEqual({ amount: 13500, currency: 'XOF' });
    const [row] = await t.db.select().from(core.orders).where(eq(core.orders.vendorId, s.vendorId));
    expect(row).toMatchObject({ subtotalXof: 15000, discountXof: 1500, totalXof: 13500 });

    // Without discount_pct the discounted total is refused: core never takes a price from the agent.
    const noDiscount = await post(
      url,
      { ...base, expected_total: quote.total },
      { ...headers, 'idempotency-key': idemKey() },
    );
    expect(noDiscount.json()).toMatchObject({ code: 'PRICE_CHANGED' });
  });

  it('gives no discount in a fixed-price shop, whatever the agent sends', async () => {
    const s = await createShop(t.db, 'boutique-s');
    const res = await post(
      `/internal/v1/vendors/${s.vendorId}/orders`,
      {
        conversation_ref: '0193a8f4-6f7a-7b8c-9d0e-1f2a3b4c5d71',
        customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
        items: [{ variant_id: s.variantId, quantity: 1 }],
        delivery: { method: 'pickup' },
        discount_pct: 50,
        expected_total: { amount: 7500, currency: 'XOF' },
      },
      { authorization: `Bearer ${SERVICE_TOKEN}`, 'idempotency-key': idemKey() },
    );
    expect(res.json()).toMatchObject({
      code: 'PRICE_CHANGED',
      errors: [{ actual: { amount: 15000 } }],
    });
  });

  it('puts the checkout URL in order events', async () => {
    const s = await createShop(t.db, 'boutique-t');
    const o = (
      await post('/api/v1/orders', orderPayload('boutique-t', s.variantId), {
        'idempotency-key': idemKey(),
      })
    ).json();
    t.clock.advance(23 * 60_000);
    await reconcileOnce(t.ctx);
    const events = (await t.db.select().from(core.outbox)).filter(
      (e) => (e.payload as { data: { order_id?: string } }).data.order_id === o.order.id,
    );
    expect(events.map((e) => e.topic).sort()).toEqual(['order.created', 'order.expired']);
    for (const e of events)
      expect((e.payload as { data: { checkout_url: string } }).data.checkout_url).toBe(
        o.checkout_url,
      );
  });
});

describe('config', () => {
  it('refuses dev secrets in production, unless the local stack says so', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /SERVICE_TOKEN_AGENT/,
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        SERVICE_TOKEN_AGENT: 'dev-agent-token',
      } as NodeJS.ProcessEnv),
    ).toThrow(/SERVICE_TOKEN_AGENT/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        SERVICE_TOKEN_AGENT: 'short-token-123',
      } as NodeJS.ProcessEnv),
    ).toThrow(/32 characters/);
    expect(
      loadConfig({ NODE_ENV: 'production', ALLOW_DEV_SECRETS: 'true' } as NodeJS.ProcessEnv)
        .SERVICE_TOKEN_AGENT,
    ).toBe('dev-agent-token');
    // Both secrets are required in production, the events secret too.
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        SERVICE_TOKEN_AGENT: 'x'.repeat(40),
      } as NodeJS.ProcessEnv),
    ).toThrow(/EVENTS_HMAC_SECRET/);
    expect(
      loadConfig({
        NODE_ENV: 'production',
        SERVICE_TOKEN_AGENT: 'x'.repeat(40),
        EVENTS_HMAC_SECRET: 'y'.repeat(40),
      } as NodeJS.ProcessEnv).NODE_ENV,
    ).toBe('production');
    expect(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).SERVICE_TOKEN_AGENT).toBe(
      'dev-agent-token',
    );
  });
});
