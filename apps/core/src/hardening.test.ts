// Running core on several processes: live streams woken by LISTEN/NOTIFY, one job leader by advisory lock, and
// invoices paid after they expired.
import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from './context';
import { PgLeader } from './leader';
import {
  createShop,
  createTestApp,
  createVendorSession,
  idemKey,
  orderPayload,
  reconcileLateOnce,
  reconcileLateSubscriptionInvoices,
  reconcileOnce,
  reconcileSubscriptionInvoices,
  SERVICE_TOKEN,
  type TestApp,
} from './testing';

let t: TestApp;
let base = '';
beforeAll(async () => {
  // A one-minute poll: anything a stream sends within the test came from a signal.
  t = await createTestApp({ SSE_POLL_MS: '60000' });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
}, 60_000);
afterAll(() => t.close());

function read(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  let text = '';
  const ready = fetch(url, { headers, signal: ctrl.signal }).then(async (res) => {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += dec.decode(value);
        }
      } catch {
        /* aborted */
      }
    })();
  });
  return { ready, text: () => text, close: () => ctrl.abort() };
}

const placeOrder = async (slug: string, variantId: string) => {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    payload: orderPayload(slug, variantId),
    headers: { 'idempotency-key': idemKey() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as {
    order: { id: string; public_token: string };
    invoice: { payment_hash: string };
  };
};

describe('live streams wake on LISTEN/NOTIFY', () => {
  it('sends a vendor notification at once, without waiting for the poll', async () => {
    const s = await createShop(t.db, 'signal-a');
    const { cookie } = await createVendorSession(t, s.vendorId);
    const stream = read(`${base}/api/v1/vendors/me/events`, { cookie: `selly_session=${cookie}` });
    await stream.ready;
    await expect.poll(() => stream.text(), { timeout: 2000 }).toContain(': connected');
    const res = await t.app.inject({
      method: 'POST',
      url: `/internal/v1/vendors/${s.vendorId}/notifications`,
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
      payload: { type: 'conversation.new', title: 'Fatou' },
    });
    expect(res.statusCode).toBe(202);
    await expect.poll(() => stream.text(), { timeout: 2000 }).toContain('event: conversation.new');
    stream.close();
  });

  it('tells the checkout page the order is paid as soon as it settles', async () => {
    const s = await createShop(t.db, 'signal-b');
    const o = await placeOrder('signal-b', s.variantId);
    const stream = read(`${base}/api/v1/checkout/${o.order.public_token}/events`);
    await stream.ready;
    await expect.poll(() => stream.text(), { timeout: 2000 }).toContain('"pending_payment"');
    t.provider.pay(o.invoice.payment_hash);
    await reconcileOnce(t.ctx);
    await expect.poll(() => stream.text(), { timeout: 2000 }).toContain('"status":"paid"');
    stream.close();
  });
});

describe('job leader', () => {
  /** A pool whose connections share one advisory lock table, like PostgreSQL sessions do. */
  function fakePool() {
    let holder: object | null = null;
    return {
      kill: () => {
        holder = null;
      },
      pool: {
        connect: async () => {
          const client = {
            on: () => client,
            release: () => {
              if (holder === client) holder = null;
            },
            query: async (q: string) => {
              if (q.includes('pg_try_advisory_lock')) {
                if (!holder) holder = client;
                return { rows: [{ ok: holder === client }] };
              }
              return { rows: [{}] };
            },
          };
          return client;
        },
      } as unknown as pg.Pool,
    };
  }

  it('lets one process lead, and another take over when it stops', async () => {
    const { pool } = fakePool();
    const changes: string[] = [];
    const a = new PgLeader(pool, silentLogger, (l) => changes.push(`a:${l}`));
    const b = new PgLeader(pool, silentLogger, (l) => changes.push(`b:${l}`));
    await a.tryLead();
    await b.tryLead();
    expect([a.isLeader(), b.isLeader()]).toEqual([true, false]);
    await a.tryLead(); // still the leader: keeps the lock
    expect(a.isLeader()).toBe(true);

    a.close();
    await b.tryLead();
    expect([a.isLeader(), b.isLeader()]).toEqual([false, true]);
    expect(changes).toEqual(['a:true', 'b:true']);
    b.close();
  });
});

describe('late payments', () => {
  it('records an order paid after its invoice expired', async () => {
    const s = await createShop(t.db, 'late-order', { stock: 3 });
    const o = await placeOrder('late-order', s.variantId);
    t.clock.advance(23 * 60_000); // 20-minute invoice plus 2 minutes of grace
    await reconcileOnce(t.ctx);
    const status = async () =>
      (await t.db.select().from(core.orders).where(eq(core.orders.id, o.order.id)))[0]?.status;
    expect(await status()).toBe('expired');

    t.provider.pay(o.invoice.payment_hash);
    await reconcileOnce(t.ctx); // only open invoices: nothing yet
    expect(await status()).toBe('expired');
    expect(await reconcileLateOnce(t.ctx)).toMatchObject({ settled: 1 });
    expect(await status()).toBe('paid');
    expect(await reconcileLateOnce(t.ctx)).toMatchObject({ settled: 0 });
  });

  it('extends a subscription paid after its invoice expired', async () => {
    const s = await createShop(t.db, 'late-sub');
    const { cookie } = await createVendorSession(t, s.vendorId);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/vendors/me/subscription/invoices',
      headers: {
        origin: 'http://localhost:3000',
        cookie: `selly_session=${cookie}`,
        'idempotency-key': idemKey(),
      },
      payload: { plan_id: 'pro', months: 1 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const inv = res.json();
    t.clock.advance(61 * 60_000);
    await reconcileSubscriptionInvoices(t.ctx);
    t.provider.pay(inv.payment_hash);
    expect(await reconcileLateSubscriptionInvoices(t.ctx)).toMatchObject({ settled: 1 });
    const [row] = await t.db
      .select()
      .from(core.subscriptionInvoices)
      .where(eq(core.subscriptionInvoices.id, inv.id));
    expect(row?.status).toBe('settled');
  });
});
