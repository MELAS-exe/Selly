import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import { createTestDb } from '@selly/db/testing';
import { FakeNwcWallet, TestRelay } from '@selly/nwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { type Context, type Database, silentLogger } from './context';
import { NwcGateway } from './modules/payments/nwc-gateway';
import { confirmPayment, reconcileOnce } from './modules/payments/service';
import { RateService } from './modules/rates/service';
import { linkWallet, liveWallet, unlinkWallet } from './modules/wallet/service';
import { Keyring, walletAad } from './secrets';
import { createShop, feed, idemKey, orderPayload } from './test-helpers';

let relay: TestRelay;
let ctx: Context;
let gateway: NwcGateway;
let app: ReturnType<typeof buildApp>;
let closeDb: () => Promise<void>;
const wallets: FakeNwcWallet[] = [];
const confirmed: Promise<unknown>[] = [];

const newWallet = async (opts: Partial<Parameters<typeof FakeNwcWallet.start>[0]> = {}) => {
  const w = await FakeNwcWallet.start({ relayUrl: relay.url, ...opts });
  wallets.push(w);
  return w;
};

beforeAll(async () => {
  relay = await TestRelay.start();
  const t = await createTestDb();
  closeDb = t.close;
  const db = t.db as unknown as Database;
  const now = () => new Date(); // real time: the fake wallet stamps invoices with the real clock
  ctx = {
    config: loadConfig({
      NODE_ENV: 'test',
      SERVICE_TOKEN_AGENT: 'test-service-token',
      NWC_ALLOW_INSECURE_RELAYS: 'true',
      NWC_MIN_INTERVAL_MS: '0',
      NWC_MAKE_INVOICE_TIMEOUT_MS: '1500',
      NWC_LOOKUP_TIMEOUT_MS: '1500',
      NWC_GET_INFO_TIMEOUT_MS: '1500',
    } as NodeJS.ProcessEnv),
    db,
    now,
    rates: new RateService(db, [feed('a', 9_000_000n), feed('b', 9_000_000n)], now),
    invoices: {
      forVendor: () => {
        throw new Error('set below');
      },
    },
    keyring: Keyring.forTests(),
    log: silentLogger,
  };
  gateway = new NwcGateway(ctx, (n) => {
    confirmed.push(confirmPayment(ctx, n));
  });
  ctx.invoices = gateway;
  app = buildApp(ctx);
  await app.ready();
}, 60_000);

afterAll(async () => {
  gateway.close();
  for (const w of wallets) w.close();
  await app.close();
  await relay.stop();
  await closeDb();
});

const link = (vendorId: string, uri: string) =>
  linkWallet(ctx, { owner: 'vendor', vendorId, uri, actor: 'test' });
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });
const status = async (token: string) =>
  (await app.inject({ url: `/api/v1/checkout/${token}/status` })).json().status as string;

describe('linking a wallet', () => {
  it('links a receive-only wallet after the five checks, and stores the URI encrypted', async () => {
    const s = await createShop(ctx.db, 'nwc-link-a');
    const w = await newWallet();
    const view = await link(s.vendorId, w.uri);
    expect(view).toMatchObject({
      kind: 'nwc',
      status: 'active',
      methods: ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice'],
      notifications: true,
      receive_only: true,
      relays: [relay.url],
      balance_sat: 184200,
    });
    expect(w.calls).toEqual(expect.arrayContaining(['get_info', 'make_invoice', 'lookup_invoice']));

    const row = await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId });
    expect(row?.uriCiphertext?.toString('latin1')).not.toContain(w.clientSecret);
    expect(
      ctx.keyring?.decrypt(
        row?.uriCiphertext as Buffer,
        1,
        walletAad({ owner: 'vendor', vendorId: s.vendorId }),
      ),
    ).toBe(w.uri);
    // Bound to its vendor: the same ciphertext does not open for another one.
    expect(() =>
      ctx.keyring?.decrypt(
        row?.uriCiphertext as Buffer,
        1,
        walletAad({ owner: 'vendor', vendorId: '0193a000-0000-7000-8000-000000000999' }),
      ),
    ).toThrow();

    const log = await ctx.db
      .select()
      .from(core.auditLog)
      .where(and(eq(core.auditLog.action, 'wallet.linked'), eq(core.auditLog.target, s.vendorId)));
    expect(JSON.stringify(log)).not.toContain(w.clientSecret);
  });

  it('replaces the previous wallet', async () => {
    const s = await createShop(ctx.db, 'nwc-link-b');
    await link(s.vendorId, (await newWallet()).uri);
    const second = await newWallet();
    await link(s.vendorId, second.uri);
    const rows = await ctx.db
      .select()
      .from(core.walletConnections)
      .where(eq(core.walletConnections.vendorId, s.vendorId));
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'revoked']);
    expect(rows.find((r) => r.status === 'revoked')?.uriCiphertext).toBeNull();
    expect(
      (await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId }))?.walletPubkey,
    ).toBe(second.walletPubkey);
  });

  it('refuses a connection that can spend, or cannot look invoices up', async () => {
    const s = await createShop(ctx.db, 'nwc-link-c');
    const spender = await newWallet({
      methods: ['get_info', 'make_invoice', 'lookup_invoice', 'pay_invoice'],
    });
    await expect(link(s.vendorId, spender.uri)).rejects.toMatchObject({
      code: 'NWC_PERMISSIONS_TOO_BROAD',
      extra: { errors: [{ method: 'pay_invoice' }] },
    });
    const blind = await newWallet({ methods: ['get_info', 'make_invoice'] });
    await expect(link(s.vendorId, blind.uri)).rejects.toMatchObject({
      code: 'NWC_METHODS_MISSING',
    });
    expect(await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId })).toBeNull();
  });

  it('refuses a bad URI, a wallet that lies, and a wallet that does not answer', async () => {
    const s = await createShop(ctx.db, 'nwc-link-d');
    await expect(link(s.vendorId, 'nostr+walletconnect://nope')).rejects.toMatchObject({
      code: 'NWC_URI_INVALID',
    });
    const liar = await newWallet();
    liar.tamperNext = 'amount';
    await expect(link(s.vendorId, liar.uri)).rejects.toMatchObject({ code: 'NWC_WALLET_ERROR' });
    const asleep = await newWallet();
    asleep.goOffline();
    await expect(link(s.vendorId, asleep.uri)).rejects.toMatchObject({ code: 'NWC_TIMEOUT' });
  }, 20_000);

  it('needs an encryption key', async () => {
    const s = await createShop(ctx.db, 'nwc-link-e');
    await expect(
      linkWallet(
        { ...ctx, keyring: null },
        { owner: 'vendor', vendorId: s.vendorId, uri: (await newWallet()).uri, actor: 't' },
      ),
    ).rejects.toThrow(/SECRETS_KEK_V1/);
  });
});

describe('orders paid on the vendor wallet', () => {
  it('creates the invoice on the vendor wallet and settles it from a notification', async () => {
    const s = await createShop(ctx.db, 'nwc-order-a');
    const w = await newWallet();
    await link(s.vendorId, w.uri);
    await gateway.refresh(); // subscribe to this wallet's notifications

    const res = await post('/api/v1/orders', orderPayload('nwc-order-a', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(res.statusCode, res.body).toBe(201);
    const o = res.json();
    expect(o.invoice).toMatchObject({ amount_msat: 27_103_000, status: 'pending' });
    expect(o.invoice.bolt11.startsWith('lnbc271030n1')).toBe(true);
    expect(w.invoiceCount()).toBe(2); // the link test invoice and this one

    await w.pay(o.invoice.payment_hash);
    await expect.poll(() => status(o.order.public_token), { timeout: 5000 }).toBe('paid');
    await Promise.all(confirmed);
  });

  it('settles from the reconciler when the wallet sends no notifications', async () => {
    const s = await createShop(ctx.db, 'nwc-order-b');
    const w = await newWallet({ notifications: false });
    await link(s.vendorId, w.uri);
    const o = (
      await post('/api/v1/orders', orderPayload('nwc-order-b', s.variantId), {
        'idempotency-key': idemKey(),
      })
    ).json();
    await reconcileOnce(ctx);
    expect(await status(o.order.public_token)).toBe('pending_payment');
    await w.pay(o.invoice.payment_hash);
    await reconcileOnce(ctx);
    expect(await status(o.order.public_token)).toBe('paid');
  });

  it('ignores a notification that the wallet lookup does not confirm', async () => {
    const s = await createShop(ctx.db, 'nwc-order-c');
    const w = await newWallet({ notifications: false });
    await link(s.vendorId, w.uri);
    const o = (
      await post('/api/v1/orders', orderPayload('nwc-order-c', s.variantId), {
        'idempotency-key': idemKey(),
      })
    ).json();
    const row = await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId });
    expect(
      await confirmPayment(ctx, {
        vendorId: s.vendorId,
        walletConnectionId: row?.id as string,
        paymentHash: o.invoice.payment_hash,
      }),
    ).toBe('pending');
    expect(await status(o.order.public_token)).toBe('pending_payment');
  });

  it('creates no order when the vendor has no wallet, or the wallet returns a wrong invoice', async () => {
    const s = await createShop(ctx.db, 'nwc-order-d');
    const none = await post('/api/v1/orders', orderPayload('nwc-order-d', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(none.json()).toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });

    const w = await newWallet();
    await link(s.vendorId, w.uri);
    w.tamperNext = 'hash';
    const lie = await post('/api/v1/orders', orderPayload('nwc-order-d', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(lie.json()).toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
    const [v] = await ctx.db
      .select()
      .from(core.productVariants)
      .where(eq(core.productVariants.id, s.variantId));
    expect(v?.reserved).toBe(0);
    expect(
      await ctx.db.select().from(core.orders).where(eq(core.orders.vendorId, s.vendorId)),
    ).toHaveLength(0);
  });

  it('marks a failing wallet degraded after 5 failures, then active again', async () => {
    const s = await createShop(ctx.db, 'nwc-order-e', { stock: 20 });
    const w = await newWallet();
    await link(s.vendorId, w.uri);
    w.goOffline();
    for (let i = 0; i < 5; i++) {
      const r = await post(
        '/api/v1/orders',
        orderPayload('nwc-order-e', s.variantId, {
          customer: { display_name: 'Fatou', phone_e164: `+22177000010${i}` },
        }),
        { 'idempotency-key': idemKey() },
      );
      expect(r.json().code).toBe('PAYMENT_UNAVAILABLE');
    }
    const degraded = await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId });
    expect(degraded).toMatchObject({ status: 'degraded' });
    expect(degraded?.lastError).toContain('NWC_TIMEOUT');
    const events = await ctx.db
      .select()
      .from(core.outbox)
      .where(eq(core.outbox.topic, 'wallet.degraded'));
    expect(events.some((e) => e.key === s.vendorId)).toBe(true);

    // The breaker is open: no request reaches the wallet for 60 seconds.
    await w.goOnline();
    const calls = w.calls.length;
    const blocked = await post('/api/v1/orders', orderPayload('nwc-order-e', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(blocked.json().code).toBe('PAYMENT_UNAVAILABLE');
    expect(w.calls.length).toBe(calls);

    // A fresh gateway (as after the breaker closes) succeeds and restores the wallet.
    const fresh = new NwcGateway(ctx);
    try {
      await fresh.forVendor(s.vendorId).makeInvoice({
        vendorId: s.vendorId,
        amountMsat: 1000,
        description: 't',
        expirySeconds: 60,
      });
    } finally {
      fresh.close();
    }
    expect(await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId })).toMatchObject({
      status: 'active',
      lastError: null,
    });
    const restored = await ctx.db
      .select()
      .from(core.outbox)
      .where(eq(core.outbox.topic, 'wallet.restored'));
    expect(restored.some((e) => e.key === s.vendorId)).toBe(true);
  }, 30_000);

  it('stops using an unlinked wallet', async () => {
    const s = await createShop(ctx.db, 'nwc-order-f');
    const w = await newWallet();
    await link(s.vendorId, w.uri);
    await unlinkWallet(ctx, { owner: 'vendor', vendorId: s.vendorId, actor: 'test' });
    const r = await post('/api/v1/orders', orderPayload('nwc-order-f', s.variantId), {
      'idempotency-key': idemKey(),
    });
    expect(r.json().code).toBe('PAYMENT_UNAVAILABLE');
  });
});
