import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import { createTestDb } from '@selly/db/testing';
import { encodeInvoice, FakeNwcWallet, TestRelay } from '@selly/nwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { type Context, type Database, silentLogger } from './context';
import { MemoryObjectStore } from './modules/media/storage';
import { NwcGateway } from './modules/payments/nwc-gateway';
import { confirmPayment, reconcileOnce } from './modules/payments/service';
import { RateService } from './modules/rates/service';
import {
  confirmSubscriptionPayment,
  createSubscriptionInvoice,
  reconcileSubscriptionInvoices,
  startTrial,
} from './modules/subscriptions/billing';
import { PairingWatcher, startPairing } from './modules/wallet/pairing';
import {
  CANNOT_RECEIVE_TEXT,
  linkLightningAddress,
  linkWallet,
  liveWallet,
  unlinkWallet,
} from './modules/wallet/service';
import { Keyring, walletAad } from './secrets';
import { Signals } from './signals';
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
      LNURL_ALLOW_INSECURE: 'true',
      NWC_PAIRING_RELAYS: relay.url,
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
      forPlatform: () => {
        throw new Error('set below');
      },
    },
    media: new MemoryObjectStore(),
    signals: new Signals(),
    keyring: Keyring.forTests(),
    log: silentLogger,
  };
  gateway = new NwcGateway(
    ctx,
    (n) => {
      confirmed.push(confirmPayment(ctx, n));
    },
    (n) => {
      confirmed.push(confirmSubscriptionPayment(ctx, n));
    },
  );
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

  it('says what to do when the wallet cannot receive yet (no channel, no inbound liquidity)', async () => {
    const s = await createShop(ctx.db, 'nwc-link-cannot-receive');
    // A real Alby Hub without a channel (18 November 2026): no invoice under about 2,500 sats. It still takes a
    // normal order, so it links; one that cannot reach an order's size is refused with what to do.
    const fresh = await newWallet();
    fresh.minInvoiceMsat = 2_500_000;
    await expect(link(s.vendorId, fresh.uri)).resolves.toMatchObject({ status: 'active' });
    const s2 = await createShop(ctx.db, 'nwc-link-cannot-receive-2');
    const empty = await newWallet();
    empty.minInvoiceMsat = 100_000_000;
    await expect(link(s2.vendorId, empty.uri)).rejects.toMatchObject({
      code: 'NWC_WALLET_ERROR',
      message: CANNOT_RECEIVE_TEXT,
    });
    const other = await newWallet();
    other.refuseNext = { code: 'OTHER', message: 'Wallet locked' };
    await expect(link(s2.vendorId, other.uri)).rejects.toMatchObject({
      message: expect.stringContaining('Wallet locked'),
    });
  }, 20_000);

  it('reads the balance for the dashboard, and an offline wallet costs nothing', async () => {
    const s = await createShop(ctx.db, 'nwc-link-balance');
    const w = await newWallet();
    await link(s.vendorId, w.uri);
    expect(await gateway.balanceMsat(s.vendorId)).toBe(184_200_000);
    w.goOffline();
    expect(await gateway.balanceMsat(s.vendorId)).toBeNull();
    // Display only: no failure counted, the wallet stays active for payments.
    const row = await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId });
    expect(row?.status).toBe('active');
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

describe('subscription invoices on the platform wallet', () => {
  it('are made on the platform wallet, never the vendor one, and settle from its notification', async () => {
    const s = await createShop(ctx.db, 'nwc-sub-a');
    const vendorWallet = await newWallet();
    await link(s.vendorId, vendorWallet.uri);
    const platform = await newWallet();
    await linkWallet(ctx, { owner: 'platform', uri: platform.uri, actor: 'test' });
    await gateway.refresh();
    const before = vendorWallet.invoiceCount();

    const inv = await createSubscriptionInvoice(ctx, s.vendorId, { plan_id: 'pro', months: 1 });
    expect(inv).toMatchObject({ status: 'pending', amount_msat: 15_000_000 });
    expect(inv.bolt11.startsWith('lnbc150u1')).toBe(true);
    expect(vendorWallet.invoiceCount()).toBe(before);
    const [row] = await ctx.db
      .select()
      .from(core.subscriptionInvoices)
      .where(eq(core.subscriptionInvoices.id, inv.id));
    expect(row?.walletConnectionId).toBe((await liveWallet(ctx.db, { owner: 'platform' }))?.id);

    await platform.pay(inv.payment_hash);
    await expect
      .poll(
        async () =>
          (
            await ctx.db
              .select({ status: core.subscriptionInvoices.status })
              .from(core.subscriptionInvoices)
              .where(eq(core.subscriptionInvoices.id, inv.id))
          )[0]?.status,
        { timeout: 5000 },
      )
      .toBe('settled');
    await Promise.all(confirmed);
  });

  it('settles from the reconciler, and answers 503 when no platform wallet is linked', async () => {
    const s = await createShop(ctx.db, 'nwc-sub-b');
    const inv = await createSubscriptionInvoice(ctx, s.vendorId, { plan_id: 'pro', months: 1 });
    const platform = wallets.at(-1) as FakeNwcWallet;
    await platform.pay(inv.payment_hash, { notify: false });
    expect(await reconcileSubscriptionInvoices(ctx)).toMatchObject({ settled: 1 });

    await unlinkWallet(ctx, { owner: 'platform', actor: 'test' });
    await expect(
      createSubscriptionInvoice(ctx, s.vendorId, { plan_id: 'pro', months: 1 }),
    ).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
  });
});

describe('pairing with nostr+walletauth', () => {
  it('links the wallet that approves the link, with the usual checks, and forgets the secret', async () => {
    const s = await createShop(ctx.db, 'nwc-pair-a');
    const watcher = new PairingWatcher(ctx);
    try {
      const pairing = await startPairing(ctx, s.vendorId);
      expect(pairing.open_uri).toMatch(/^nostr\+walletauth:\/\/[0-9a-f]{64}\?/);
      expect(pairing.open_uri).toContain(
        'request_methods=get_info%20get_balance%20make_invoice%20lookup_invoice',
      );
      await watcher.refresh();

      const w = await FakeNwcWallet.approve(pairing.open_uri);
      wallets.push(w);
      await expect
        .poll(
          async () =>
            (await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId }))?.walletPubkey,
          {
            timeout: 5000,
          },
        )
        .toBe(w.walletPubkey);
      expect(w.calls).toEqual(
        expect.arrayContaining(['get_info', 'make_invoice', 'lookup_invoice']),
      );
      await expect
        .poll(async () => {
          const [row] = await ctx.db
            .select()
            .from(core.walletPairings)
            .where(eq(core.walletPairings.id, pairing.pairing_id));
          return { status: row?.status, secret: row?.secretCiphertext ?? null };
        })
        .toEqual({ status: 'linked', secret: null });
      const [note] = await ctx.db
        .select()
        .from(core.vendorNotifications)
        .where(
          and(
            eq(core.vendorNotifications.vendorId, s.vendorId),
            eq(core.vendorNotifications.type, 'wallet.paired'),
          ),
        );
      expect(note?.data).toMatchObject({ status: 'linked', error: null });
    } finally {
      watcher.close();
    }
  });

  it('refuses a wallet that grants spending, and expires an unused link', async () => {
    const s = await createShop(ctx.db, 'nwc-pair-b');
    const watcher = new PairingWatcher(ctx);
    try {
      const pairing = await startPairing(ctx, s.vendorId);
      await watcher.refresh();
      wallets.push(
        await FakeNwcWallet.approve(pairing.open_uri, {
          methods: ['get_info', 'make_invoice', 'lookup_invoice', 'pay_invoice'],
        }),
      );
      await expect
        .poll(
          async () => {
            const [row] = await ctx.db
              .select()
              .from(core.walletPairings)
              .where(eq(core.walletPairings.id, pairing.pairing_id));
            return [row?.status, row?.error];
          },
          { timeout: 5000 },
        )
        .toEqual(['failed', 'NWC_PERMISSIONS_TOO_BROAD']);
      expect(await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId })).toBeNull();

      // A second link replaces the first; past its 10 minutes it expires.
      const first = await startPairing(ctx, s.vendorId);
      const second = await startPairing(ctx, s.vendorId);
      const status = async (id: string) =>
        (await ctx.db.select().from(core.walletPairings).where(eq(core.walletPairings.id, id)))[0]
          ?.status;
      expect(await status(first.pairing_id)).toBe('expired');
      await ctx.db
        .update(core.walletPairings)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(core.walletPairings.id, second.pairing_id));
      await watcher.refresh();
      expect(await status(second.pairing_id)).toBe('expired');
    } finally {
      watcher.close();
    }
  });
});

/** A Lightning Address server (LUD-06, LUD-16, LUD-21) on 127.0.0.1 that mints real, signed BOLT11 invoices. */
async function lnurlServer(opts: { verify: boolean; maxSendable?: number }) {
  const invoices = new Map<string, { preimage: string; paid: boolean; pr: string }>();
  const nodeKey = randomBytes(32);
  let base = '';
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', base);
    const json = (body: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (u.pathname === '/.well-known/lnurlp/shop')
      return json({
        tag: 'payRequest',
        callback: `${base}/cb`,
        minSendable: 1000,
        maxSendable: opts.maxSendable ?? 100_000_000_000,
        metadata: '[["text/plain","Shop"]]',
        commentAllowed: 120,
      });
    if (u.pathname === '/cb') {
      const amountMsat = Number(u.searchParams.get('amount'));
      const preimage = randomBytes(32);
      const hash = createHash('sha256').update(preimage).digest();
      const pr = encodeInvoice({
        amountMsat,
        paymentHash: hash,
        paymentSecret: randomBytes(32),
        description: 'Shop',
        expirySeconds: 86_400,
        timestamp: Math.floor(Date.now() / 1000),
        nodeKey,
      });
      invoices.set(hash.toString('hex'), { preimage: preimage.toString('hex'), paid: false, pr });
      return json({
        pr,
        routes: [],
        ...(opts.verify ? { verify: `${base}/verify/${hash.toString('hex')}` } : {}),
      });
    }
    const v = /^\/verify\/([0-9a-f]{64})$/.exec(u.pathname);
    const inv = v ? invoices.get(v[1] as string) : undefined;
    if (inv)
      return json({
        status: 'OK',
        settled: inv.paid,
        preimage: inv.paid ? inv.preimage : null,
        pr: inv.pr,
      });
    res.statusCode = 404;
    json({ status: 'ERROR', reason: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    lud16: `shop@${base.replace('http://', '')}`,
    pay: (hash: string) => {
      const i = invoices.get(hash);
      if (i) i.paid = true;
    },
    count: () => invoices.size,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('Lightning Address fallback', () => {
  it('makes the invoice through the address when the NWC wallet does not answer, and settles by LUD-21', async () => {
    const ln = await lnurlServer({ verify: true });
    try {
      const s = await createShop(ctx.db, 'nwc-lnurl-a');
      const w = await newWallet({ notifications: false });
      await link(s.vendorId, `${w.uri}&lud16=${encodeURIComponent(ln.lud16)}`);
      w.goOffline();

      const res = await post('/api/v1/orders', orderPayload('nwc-lnurl-a', s.variantId), {
        'idempotency-key': idemKey(),
      });
      expect(res.statusCode, res.body).toBe(201);
      const o = res.json();
      expect(ln.count()).toBe(1);
      const [inv] = await ctx.db
        .select()
        .from(core.invoices)
        .where(eq(core.invoices.orderId, o.order.id));
      expect(inv).toMatchObject({ source: 'lnurl', amountMsat: 27_103_000 });
      expect(inv?.verifyUrl).toContain('/verify/');
      // Selly keeps its own 20 minutes, not the server's 24 hours.
      expect((inv?.expiresAt.getTime() ?? 0) - Date.now()).toBeLessThanOrEqual(20 * 60_000 + 1000);

      await reconcileOnce(ctx);
      expect(await status(o.order.public_token)).toBe('pending_payment');
      ln.pay(o.invoice.payment_hash);
      await reconcileOnce(ctx);
      expect(await status(o.order.public_token)).toBe('paid');
    } finally {
      await ln.close();
    }
  }, 20_000);

  it('does not fall back to an address that cannot verify payments', async () => {
    const ln = await lnurlServer({ verify: false });
    try {
      const s = await createShop(ctx.db, 'nwc-lnurl-b');
      const w = await newWallet({ notifications: false });
      await link(s.vendorId, `${w.uri}&lud16=${encodeURIComponent(ln.lud16)}`);
      w.goOffline();
      const res = await post('/api/v1/orders', orderPayload('nwc-lnurl-b', s.variantId), {
        'idempotency-key': idemKey(),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('PAYMENT_UNAVAILABLE');
    } finally {
      await ln.close();
    }
  }, 20_000);
});

describe('Lightning Address as the wallet', () => {
  const linkAddress = (vendorId: string, lud16: string) =>
    linkLightningAddress(ctx, { owner: 'vendor', vendorId, lud16, actor: 'test' });

  it('refuses an address that can receive nothing yet, and says why', async () => {
    const ln = await lnurlServer({ verify: true, maxSendable: 0 });
    try {
      const s = await createShop(ctx.db, 'lnaddr-empty');
      await expect(linkAddress(s.vendorId, ln.lud16)).rejects.toMatchObject({
        message: CANNOT_RECEIVE_TEXT,
      });
    } finally {
      await ln.close();
    }
  });

  it('links an address with LUD-21, takes an order on it, and settles it by verify', async () => {
    const ln = await lnurlServer({ verify: true });
    try {
      const s = await createShop(ctx.db, 'lnaddr-a', { plan: null });
      const view = await linkAddress(s.vendorId, ln.lud16);
      expect(view).toMatchObject({
        kind: 'lightning_address',
        status: 'active',
        lud16: ln.lud16.toLowerCase(),
      });
      expect(ln.count()).toBe(1); // the test invoice, never paid
      const trial = await startTrial(ctx, s.vendorId, 'pro');
      expect(trial.subscription?.status).toBe('trialing');

      const res = await post('/api/v1/orders', orderPayload('lnaddr-a', s.variantId), {
        'idempotency-key': idemKey(),
      });
      expect(res.statusCode, res.body).toBe(201);
      const o = res.json();
      const [inv] = await ctx.db
        .select()
        .from(core.invoices)
        .where(eq(core.invoices.orderId, o.order.id));
      expect(inv).toMatchObject({ source: 'lnurl' });
      await reconcileOnce(ctx);
      expect(await status(o.order.public_token)).toBe('pending_payment');
      ln.pay(o.invoice.payment_hash);
      await reconcileOnce(ctx);
      expect(await status(o.order.public_token)).toBe('paid');
    } finally {
      await ln.close();
    }
  });

  it('refuses an address that cannot confirm payments, and one that is not an address', async () => {
    const ln = await lnurlServer({ verify: false });
    try {
      const s = await createShop(ctx.db, 'lnaddr-b');
      await expect(linkAddress(s.vendorId, ln.lud16)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        extra: { errors: [{ field: 'lud16', message: 'No payment verification (LUD-21)' }] },
      });
      await expect(linkAddress(s.vendorId, 'not an address')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(await liveWallet(ctx.db, { owner: 'vendor', vendorId: s.vendorId })).toBeNull();
    } finally {
      await ln.close();
    }
  });
});
