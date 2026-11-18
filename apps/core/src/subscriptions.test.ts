// Paying for Selly (architecture.md section 3.7): trial, invoices on the platform wallet, the period rules at
// settlement, and the status job. The fake provider stands in for the platform wallet.
import { randomBytes } from 'node:crypto';
import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimTrialWallet } from './modules/subscriptions/billing';
import {
  assertContract,
  createShop,
  createTestApp,
  createVendorSession,
  idemKey,
  reconcileSubscriptionInvoices,
  runSubscriptionJob,
  settleSubscriptionInvoice,
  type TestApp,
} from './testing';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

const DAY = 86_400_000;
const ORIGIN = 'http://localhost:3000';
let seq = 0;

async function call(
  method: 'GET' | 'POST',
  template: string,
  url: string,
  cookie: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: { origin: ORIGIN, cookie: `selly_session=${cookie}`, ...headers },
    remoteAddress: `10.9.${Math.floor(++seq / 250)}.${seq % 250}`,
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  const json = res.body ? res.json() : undefined;
  assertContract(method, template, res.statusCode, json);
  return { status: res.statusCode, body: json };
}

const SUB = '/api/v1/vendors/me/subscription';
const INVOICES = '/api/v1/vendors/me/subscription/invoices';
const view = (cookie: string) => call('GET', SUB, SUB, cookie);
const buy = (cookie: string, plan_id: string, months: number, key = idemKey()) =>
  call('POST', INVOICES, INVOICES, cookie, { plan_id, months }, { 'idempotency-key': key });

/** A shop and a signed-in session. `sub` sets a subscription relative to the test clock. */
async function shop(
  slug: string,
  sub?: { plan: string; status?: 'active' | 'trialing'; endsInDays: number },
) {
  const s = await createShop(t.db, slug, { plan: null, wallet: false });
  const { cookie } = await createVendorSession(t, s.vendorId);
  if (sub) {
    const now = t.clock.now();
    await t.db.insert(core.subscriptions).values({
      vendorId: s.vendorId,
      planId: sub.plan,
      status: sub.status ?? 'active',
      currentPeriodStart: new Date(now.getTime() - 30 * DAY),
      currentPeriodEnd: new Date(now.getTime() + sub.endsInDays * DAY),
    });
  }
  return { ...s, cookie };
}

async function linkWallet(vendorId: string, walletPubkey = randomBytes(32).toString('hex')) {
  await t.db.insert(core.walletConnections).values({
    owner: 'vendor',
    vendorId,
    kind: 'nwc',
    walletPubkey,
    status: 'active',
  });
  return walletPubkey;
}

/** The customer, here the vendor, pays the invoice; the reconciler sees it. */
async function pay(paymentHash: string) {
  t.provider.pay(paymentHash);
  return reconcileSubscriptionInvoices(t.ctx);
}

const subRow = async (vendorId: string) =>
  (
    await t.db.select().from(core.subscriptions).where(eq(core.subscriptions.vendorId, vendorId))
  )[0];

const notifications = (vendorId: string) =>
  t.db
    .select()
    .from(core.vendorNotifications)
    .where(
      and(
        eq(core.vendorNotifications.vendorId, vendorId),
        eq(core.vendorNotifications.type, 'subscription.updated'),
      ),
    );

const at = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

describe('trial', () => {
  it('gives 14 days of Pro, and is used once per key and per wallet', async () => {
    const a = await shop('trial-a');
    const none = await view(a.cookie);
    expect(none.body).toMatchObject({ subscription: null, plan: null });
    expect(none.body.actions).toEqual(['start_trial', 'renew']);

    const walletKey = await linkWallet(a.vendorId);
    const started = await call('POST', `${SUB}/trial`, `${SUB}/trial`, a.cookie, {
      plan_id: 'pro',
    });
    expect(started.status).toBe(201);
    const now = t.clock.now().getTime();
    expect(started.body.subscription).toMatchObject({
      plan_id: 'pro',
      status: 'trialing',
      trial: true,
      current_period_end: at(now + 14 * DAY),
    });
    expect(started.body.actions).toEqual(['renew', 'upgrade', 'downgrade']);

    const again = await call('POST', `${SUB}/trial`, `${SUB}/trial`, a.cookie, { plan_id: 'pro' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TRIAL_ALREADY_USED');

    // A second shop on the same wallet gets no second trial.
    const b = await shop('trial-b');
    await linkWallet(b.vendorId, walletKey);
    expect((await view(b.cookie)).body.actions).toEqual(['start_trial', 'renew']);
    const second = await call('POST', `${SUB}/trial`, `${SUB}/trial`, b.cookie, {
      plan_id: 'pro',
    });
    expect(second.status).toBe(409);
    expect(second.body.errors).toEqual([{ claim: 'wallet' }]);
    expect(await subRow(b.vendorId)).toBeUndefined();

    // The agent hears about the new plan.
    const [event] = await t.db.select().from(core.outbox).where(eq(core.outbox.key, a.vendorId));
    expect(event?.topic).toBe('entitlements.changed');
  });

  it('starts without a wallet; a wallet linked later joins the claims', async () => {
    const a = await shop('trial-nowallet-a');
    const started = await call('POST', `${SUB}/trial`, `${SUB}/trial`, a.cookie, {
      plan_id: 'pro',
    });
    expect(started.status).toBe(201);
    expect(started.body.subscription).toMatchObject({ status: 'trialing', trial: true });

    const walletKey = randomBytes(32).toString('hex');
    await t.db.transaction((tx) =>
      claimTrialWallet(tx, a.vendorId, { walletPubkey: walletKey, lud16: null }, t.clock.now()),
    );
    const claims = await t.db
      .select()
      .from(core.trialClaims)
      .where(eq(core.trialClaims.claimKey, `wallet:${walletKey}`));
    expect(claims.map((c) => c.vendorId)).toEqual([a.vendorId]);

    // The same wallet cannot carry a second shop's unpaid trial.
    const b = await shop('trial-nowallet-b');
    await call('POST', `${SUB}/trial`, `${SUB}/trial`, b.cookie, { plan_id: 'pro' });
    await expect(
      t.db.transaction((tx) =>
        claimTrialWallet(tx, b.vendorId, { walletPubkey: walletKey, lud16: null }, t.clock.now()),
      ),
    ).rejects.toMatchObject({ code: 'TRIAL_ALREADY_USED' });
  });

  it('an unpaid trial closes the shop as soon as it ends, with no grace', async () => {
    const s = await shop('trial-ends');
    await call('POST', `${SUB}/trial`, `${SUB}/trial`, s.cookie, { plan_id: 'pro' });
    await linkWallet(s.vendorId);
    const store = () =>
      t.app.inject({ method: 'GET', url: '/api/v1/stores/trial-ends' }).then((r) => r.json());
    expect((await store()).store.status).toBe('active');

    t.clock.advance(14 * DAY + 1000);
    expect((await view(s.cookie)).body.subscription.status).toBe('suspended');
    expect((await store()).store).toMatchObject({
      status: 'paused',
      ordering: { enabled: false, reason: 'store_paused' },
    });
  });

  it('a plan bought during the trial starts when the trial ends', async () => {
    const s = await shop('trial-buy');
    await linkWallet(s.vendorId);
    await call('POST', `${SUB}/trial`, `${SUB}/trial`, s.cookie, { plan_id: 'pro' });
    const trialEnd = t.clock.now().getTime() + 14 * DAY;

    const key = idemKey();
    const inv = await buy(s.cookie, 'starter', 3, key);
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({
      status: 'pending',
      plan_id: 'starter',
      months: 3,
      list_price_sat: 14250,
      credit_sat: 0,
      amount_sat: 14250,
      amount_msat: 14_250_000,
      description: 'Selly Starter 3 mois',
      covers: { from: at(trialEnd) },
    });
    expect(inv.body.lightning_uri).toBe(`lightning:${inv.body.bolt11}`);
    // A QR code to scan from the dashboard while it can be paid; gone once settled.
    expect(inv.body.qr_svg).toMatch(/^<svg/);
    expect(new Date(inv.body.expires_at).getTime() - t.clock.now().getTime()).toBe(3_600_000);
    // The same Idempotency-Key returns the same invoice.
    expect((await buy(s.cookie, 'starter', 3, key)).body.id).toBe(inv.body.id);

    expect(await pay(inv.body.payment_hash)).toMatchObject({ settled: 1 });
    const paid = await call('GET', `${INVOICES}/{id}`, `${INVOICES}/${inv.body.id}`, s.cookie);
    expect(paid.body.status).toBe('settled');
    expect(paid.body.preimage).toMatch(/^[0-9a-f]{64}$/);
    expect(paid.body.qr_svg).toBeUndefined();

    // Still Pro until the trial ends, then Starter.
    let v = (await view(s.cookie)).body;
    expect(v.subscription).toMatchObject({
      plan_id: 'pro',
      next_plan_id: 'starter',
      status: 'active',
      trial: true,
    });
    expect(v.actions).toEqual(['renew']);
    const [n] = await notifications(s.vendorId).then((r) =>
      r.filter((x) => x.data.reason === 'paid'),
    );
    expect(n?.data).toMatchObject({ invoice_id: inv.body.id, next_plan_id: 'starter' });

    t.clock.advance(15 * DAY);
    v = (await view(s.cookie)).body;
    expect(v.subscription).toMatchObject({ plan_id: 'starter', next_plan_id: null, trial: false });
    expect(v.usage.agent_turns.limit).toBe(300);
    await runSubscriptionJob(t.ctx);
    expect(await subRow(s.vendorId)).toMatchObject({ planId: 'starter', nextPlanId: null });
  });
});

describe('invoices', () => {
  it('renews from the end of the period, and lists invoices newest first', async () => {
    const s = await shop('renew', { plan: 'pro', endsInDays: 10 });
    const end = (await subRow(s.vendorId))?.currentPeriodEnd as Date;
    const inv = await buy(s.cookie, 'pro', 1);
    expect(inv.body.covers.from).toBe(at(end.getTime()));
    await pay(inv.body.payment_hash);
    const row = await subRow(s.vendorId);
    expect(row?.currentPeriodEnd.getTime()).toBeGreaterThan(end.getTime() + 27 * DAY);

    const second = await buy(s.cookie, 'pro', 12);
    expect(second.body.amount_sat).toBe(150000);
    const list = await call('GET', INVOICES, `${INVOICES}?limit=1`, s.cookie);
    expect(list.body.data.map((i: { id: string }) => i.id)).toEqual([second.body.id]);
    const next = await call(
      'GET',
      INVOICES,
      `${INVOICES}?cursor=${list.body.next_cursor}`,
      s.cookie,
    );
    expect(next.body.data.map((i: { id: string }) => i.id)).toEqual([inv.body.id]);

    // Another vendor cannot read it.
    const other = await shop('renew-other', { plan: 'pro', endsInDays: 10 });
    const res = await call('GET', `${INVOICES}/{id}`, `${INVOICES}/${inv.body.id}`, other.cookie);
    expect(res.status).toBe(404);
  });

  it('upgrades now with a credit for the unused paid days', async () => {
    const s = await shop('upgrade', { plan: 'starter', endsInDays: 15 });
    const inv = await buy(s.cookie, 'business', 1);
    // floor(5,000 sats × 15 days / 30) = 2,500 sats.
    expect(inv.body).toMatchObject({ list_price_sat: 40000, credit_sat: 2500, amount_sat: 37500 });
    expect(inv.body.covers.from).toBe(at(t.clock.now().getTime()));
    await pay(inv.body.payment_hash);
    expect((await view(s.cookie)).body.subscription).toMatchObject({
      plan_id: 'business',
      status: 'active',
    });
  });

  it('allows a lower plan only in the last 7 days, from the end of the period', async () => {
    const early = await shop('down-early', { plan: 'pro', endsInDays: 20 });
    const refused = await buy(early.cookie, 'starter', 1);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('DOWNGRADE_NOT_ALLOWED_YET');

    const late = await shop('down-late', { plan: 'pro', endsInDays: 5 });
    const end = (await subRow(late.vendorId))?.currentPeriodEnd as Date;
    const inv = await buy(late.cookie, 'starter', 1);
    expect(inv.status).toBe(201);
    expect(inv.body.covers.from).toBe(at(end.getTime()));
    await pay(inv.body.payment_hash);
    expect((await view(late.cookie)).body.subscription).toMatchObject({
      plan_id: 'pro',
      next_plan_id: 'starter',
    });
    // While a plan is booked, only that plan can be bought.
    expect((await buy(late.cookie, 'business', 1)).status).toBe(422);
    expect((await buy(late.cookie, 'starter', 1)).status).toBe(201);
  });

  it('refuses a lower plan the shop does not fit in', async () => {
    const s = await shop('down-full', { plan: 'pro', endsInDays: 3 });
    await t.db.insert(core.products).values(
      Array.from({ length: 30 }, (_, i) => ({
        vendorId: s.vendorId,
        title: `Article ${i}`,
        slug: `article-${i}`,
        priceAmount: 1000,
      })),
    );
    const res = await buy(s.cookie, 'starter', 1);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('answers 503 when the platform wallet fails, and 422 for a wrong period', async () => {
    const s = await shop('wallet-down', { plan: 'pro', endsInDays: 10 });
    t.provider.failNext = true;
    const down = await buy(s.cookie, 'pro', 1);
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('PAYMENT_UNAVAILABLE');
    expect((await buy(s.cookie, 'pro', 6)).status).toBe(422);
  });

  it('expires an unpaid invoice, and still honours a late payment', async () => {
    const s = await shop('late', { plan: 'pro', endsInDays: 10 });
    const end = (await subRow(s.vendorId))?.currentPeriodEnd as Date;
    const inv = await buy(s.cookie, 'pro', 1);
    t.clock.advance(61 * 60_000);
    await reconcileSubscriptionInvoices(t.ctx);
    const expired = await call('GET', `${INVOICES}/{id}`, `${INVOICES}/${inv.body.id}`, s.cookie);
    expect(expired.body.status).toBe('expired');

    // The payer's wallet paid it anyway: the money buys the month.
    const preimage = t.provider.pay(inv.body.payment_hash);
    expect(await settleSubscriptionInvoice(t.ctx, { invoiceId: inv.body.id, preimage })).toBe(
      'settled',
    );
    expect(await settleSubscriptionInvoice(t.ctx, { invoiceId: inv.body.id, preimage })).toBe(
      'duplicate',
    );
    expect((await subRow(s.vendorId))?.currentPeriodEnd.getTime()).toBeGreaterThan(
      end.getTime() + 27 * DAY,
    );
  });
});

describe('status job', () => {
  it('reminds before the end, then moves to grace, then suspends; a payment reopens the shop', async () => {
    const s = await shop('lapse', { plan: 'pro', endsInDays: 2 });
    await linkWallet(s.vendorId); // published, so the store status follows the plan
    expect(await runSubscriptionJob(t.ctx)).toMatchObject({ reminded: expect.any(Number) });
    const reminders = async () =>
      (await notifications(s.vendorId)).filter((n) => n.data.reason === 'reminder');
    expect((await reminders()).map((n) => n.data.days_left)).toEqual([3]);
    await runSubscriptionJob(t.ctx);
    expect(await reminders()).toHaveLength(1); // once per threshold

    t.clock.advance(1.5 * DAY);
    await runSubscriptionJob(t.ctx);
    expect((await reminders()).map((n) => n.data.days_left)).toEqual([3, 1]);

    t.clock.advance(1 * DAY);
    await runSubscriptionJob(t.ctx);
    expect(await subRow(s.vendorId)).toMatchObject({ status: 'grace' });
    let v = (await view(s.cookie)).body;
    expect(v.subscription.status).toBe('grace');
    expect(v.subscription.grace_ends_at).not.toBeNull();
    expect(v.actions).toEqual(['renew', 'upgrade', 'downgrade']);

    t.clock.advance(7 * DAY);
    await runSubscriptionJob(t.ctx);
    expect(await subRow(s.vendorId)).toMatchObject({ status: 'suspended' });
    v = (await view(s.cookie)).body;
    expect(v.actions).toEqual(['resume', 'upgrade', 'downgrade']);
    const store = await t.app.inject({
      url: `/internal/v1/stores/lapse/vendor`,
      headers: { authorization: 'Bearer test-service-token' },
    });
    expect(store.json().store_status).toBe('paused');

    // Any plan, from now.
    const inv = await buy(s.cookie, 'starter', 1);
    expect(inv.body.covers.from).toBe(at(t.clock.now().getTime()));
    await pay(inv.body.payment_hash);
    expect(await subRow(s.vendorId)).toMatchObject({
      status: 'active',
      planId: 'starter',
      graceEndsAt: null,
    });
    const open = await t.app.inject({
      url: `/internal/v1/stores/lapse/vendor`,
      headers: { authorization: 'Bearer test-service-token' },
    });
    expect(open.json().store_status).toBe('active');
  });
});
