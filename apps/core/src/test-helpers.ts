// Shared setup for tests: in-process PostgreSQL, fake wallet, fixed price feeds and a clock the test controls.
import { randomBytes } from 'node:crypto';
import { core } from '@selly/db';
import { createTestDb } from '@selly/db/testing';
import { buildApp } from './app';
import { loadConfig } from './config';
import { type Context, type Database, silentLogger } from './context';
import type { EmailMessage } from './modules/events/email';
import { MemoryObjectStore } from './modules/media/storage';
import { FakeInvoiceProvider } from './modules/payments/fake';
import { singleProvider } from './modules/payments/provider';
import type { RateFeed } from './modules/rates/feeds';
import { RateService } from './modules/rates/service';
import { Keyring } from './secrets';
import { PgliteSignals } from './signals';

export const SERVICE_TOKEN = 'test-service-token';

export const feed = (name: string, cents: bigint | Error): RateFeed => ({
  name,
  btcEurCents: async () => {
    if (cents instanceof Error) throw cents;
    return cents;
  },
});

/** env overrides the test configuration, for example a long SSE_POLL_MS to prove that a signal woke a stream. */
export async function createTestApp(env: Record<string, string> = {}) {
  const { db: pg, client, close } = await createTestDb();
  // Real LISTEN/NOTIFY through PGlite: live streams wake on commit like in production.
  const signals = new PgliteSignals(client);
  await signals.start();
  const db = pg as unknown as Database;
  let time = new Date('2026-11-17T10:00:00Z');
  const clock = {
    now: () => new Date(time),
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
  };
  const provider = new FakeInvoiceProvider(clock.now);
  const media = new MemoryObjectStore();
  // BTC = 90,000 EUR: 59,036,130 XOF per BTC, the example of architecture.md section 4.5.
  const feeds = [feed('a', 9_000_000n), feed('b', 9_000_000n)];
  // Emails "sent" by core, for the tests to read (codes, alerts).
  const emails: EmailMessage[] = [];
  const ctx: Context = {
    config: loadConfig({
      NODE_ENV: 'test',
      SERVICE_TOKEN_AGENT: SERVICE_TOKEN,
      SSE_POLL_MS: '30',
      VENDOR_STREAM_SESSION_CHECK_MS: '50',
      NWC_ALLOW_INSECURE_RELAYS: 'true',
      NWC_MIN_INTERVAL_MS: '0',
      NWC_MAKE_INVOICE_TIMEOUT_MS: '1500',
      NWC_LOOKUP_TIMEOUT_MS: '1500',
      NWC_GET_INFO_TIMEOUT_MS: '1500',
      ...env,
    } as NodeJS.ProcessEnv),
    db,
    now: clock.now,
    rates: new RateService(db, feeds, clock.now),
    invoices: singleProvider(provider),
    media,
    signals,
    keyring: Keyring.forTests(),
    log: silentLogger,
    email: { send: async (m) => void emails.push(m) },
  };
  const app = buildApp(ctx);
  await app.ready();
  return {
    app,
    ctx,
    emails,
    db,
    provider,
    media,
    clock,
    close: async () => {
      await app.close();
      signals.close();
      await close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** A shop with one product in two sizes and a delivery zone. Returns ids for the tests. */
export async function createShop(
  db: Database,
  slug: string,
  opts: {
    stock?: number;
    negotiate?: boolean;
    plan?: 'starter' | 'pro' | 'business' | null;
    /** A linked wallet row (orders need one); the fake provider makes the invoices. Default true. */
    wallet?: boolean;
  } = {},
) {
  const [v] = await db
    .insert(core.vendors)
    .values({
      displayName: `Shop ${slug}`,
      slug,
      settings: {
        pricing_currency: 'XOF',
        delivery: {
          zones: [
            { id: 'plateau', label: 'Dakar Plateau', fee: { amount: 1000, currency: 'XOF' } },
          ],
          pickup: { available: true, address_text: 'Marché HLM' },
        },
        agent: { negotiation: { mode: opts.negotiate ? 'allow' : 'fixed', max_discount_pct: 10 } },
      },
    })
    .returning();
  const vendorId = (v as { id: string }).id;
  if (opts.plan !== null) {
    // Far from the test clock (2026-11-17), so the shop stays open in every test.
    await db.insert(core.subscriptions).values({
      vendorId,
      planId: opts.plan ?? 'pro',
      status: 'active',
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2030-01-01T00:00:00Z'),
    });
  }
  if (opts.wallet !== false) {
    await db.insert(core.walletConnections).values({
      owner: 'vendor',
      vendorId,
      kind: 'nwc',
      walletPubkey: randomBytes(32).toString('hex'),
      status: 'active',
    });
  }
  const [p] = await db
    .insert(core.products)
    .values({
      vendorId,
      title: 'Robe wax noire',
      slug: 'robe-wax-noire',
      description: 'Tissu élégant',
      priceAmount: 15000,
    })
    .returning();
  const productId = (p as { id: string }).id;
  const [variant] = await db
    .insert(core.productVariants)
    .values({ productId, options: { size: '42', color: 'noir' }, onHand: opts.stock ?? 3 })
    .returning();
  return { vendorId, productId, variantId: (variant as { id: string }).id };
}

export const orderPayload = (
  slug: string,
  variantId: string,
  over: Record<string, unknown> = {},
) => ({
  store_slug: slug,
  channel: 'web',
  customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
  items: [{ variant_id: variantId, quantity: 1 }],
  delivery: {
    method: 'delivery',
    zone_id: 'plateau',
    address_text: 'Rue 10',
    note: 'Appeler avant',
  },
  expected_total: { amount: 16000, currency: 'XOF' },
  ...over,
});

let n = 0;
export const idemKey = () => `test-key-${String(++n).padStart(8, '0')}-abcdef`;
