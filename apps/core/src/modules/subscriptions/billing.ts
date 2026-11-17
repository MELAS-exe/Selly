// Paying for Selly (architecture.md section 3.7): the free trial, subscription invoices on the platform wallet,
// the period rules applied when an invoice settles, and the status job (grace, suspension, reminders).
//
// A subscription row holds the plan in force, the paid period, and at most one plan booked to start later
// (next_plan_id at next_plan_at): the plan bought during the trial, or a lower plan bought in the last 7 days.
// While a plan is booked, only that plan can be bought again; other changes wait until it starts.
import { core } from '@selly/db';
import { and, desc, eq, gt, inArray, isNotNull, lt, or } from '@selly/db/orm';
import { satToXofIndicative } from '@selly/money';
import type { Context, Database } from '../../context';
import { AppError } from '../../errors';
import { decodeCursor, encodeCursor, iso, sha256Hex } from '../../util';
import { isUuid, vendorSettings } from '../catalog/store';
import { notifyVendor } from '../events/notifications';
import { audit, publishEvent } from '../events/outbox';
import {
  currentSubscription,
  type EffectiveSubscription,
  GRACE_DAYS,
  limitsOf,
  monthStart,
  productCount,
  type SubscriptionStatus,
  stateOf,
  usageThisMonth,
} from './service';

const { subscriptions, subscriptionInvoices: si, plans, trialClaims, vendorKeys, vendors } = core;
type PlanRow = typeof plans.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;
type InvoiceRow = typeof si.$inferSelect;

export const TRIAL_DAYS = 14;
export const TRIAL_PLAN = 'pro';
/** An hour, because a vendor may have to buy sats first (architecture.md section 3.9). */
export const INVOICE_EXPIRY_SECONDS = 60 * 60;
export const DOWNGRADE_WINDOW_DAYS = 7;
const REMINDER_DAYS = [1, 3, 7];
const DAY_MS = 86_400_000;
/** A platform wallet that cannot be asked keeps its invoices open this long past their expiry. */
const UNREACHABLE_WALLET_GRACE_MS = 30 * 60_000;

const RANK: Record<string, number> = { starter: 1, pro: 2, business: 3 };
const rank = (planId: string) => RANK[planId] ?? 0;

/** Calendar months, clamped: 31 January plus one month is 28 (or 29) February. */
export function addMonths(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
}

const maxDate = (a: Date, b: Date) => (a > b ? a : b);

// ---------------------------------------------------------------------------------------------- views

type Rate = Awaited<ReturnType<Context['rates']['current']>> | null;

export function planView(p: PlanRow, rate: Rate) {
  const xof = (sat: number) =>
    rate ? Number(satToXofIndicative(BigInt(sat), BigInt(rate.xofPerBtcCents))) : null;
  return {
    id: p.id,
    name: p.name,
    monthly_price_sat: p.monthlyPriceSat,
    periods: Object.entries(p.periodPrices)
      .map(([months, price]) => ({
        months: Number(months),
        price_sat: price,
        discount_pct: Math.round((1 - price / (p.monthlyPriceSat * Number(months))) * 100),
        indicative_xof: xof(price),
      }))
      .sort((a, b) => a.months - b.months),
    limits: p.limits,
  };
}

/** The pricing page must load even when no rate is available: FCFA amounts are then left out. */
export const currentRate = (ctx: Context): Promise<Rate> => ctx.rates.current().catch(() => null);

async function findPlan(db: Database, id: string): Promise<PlanRow> {
  const [p] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.active, true)));
  if (!p)
    throw new AppError('VALIDATION_FAILED', `No plan "${id}".`, {
      errors: [{ field: 'plan_id', message: 'Unknown plan' }],
    });
  return p;
}

/** What the vendor may do now (api.json getSubscription). */
function actionsFor(sub: EffectiveSubscription | null, trialAvailable: boolean, now: Date) {
  const out: ('start_trial' | 'renew' | 'upgrade' | 'downgrade' | 'resume')[] = [];
  if (!sub) {
    if (trialAvailable) out.push('start_trial');
    out.push('renew');
    return out;
  }
  out.push(sub.status === 'suspended' ? 'resume' : 'renew');
  if (sub.next) return out; // a booked plan: only renewing it until it starts
  if (rank(sub.planId) < rank('business')) out.push('upgrade');
  const lapsed = sub.status === 'grace' || sub.status === 'suspended';
  const unpaidTrial = sub.row.status === 'trialing' && sub.inTrial;
  const lastDays = sub.periodEnd.getTime() - now.getTime() <= DOWNGRADE_WINDOW_DAYS * DAY_MS;
  if (rank(sub.planId) > rank('starter') && (lapsed || unpaidTrial || lastDays))
    out.push('downgrade');
  return out;
}

async function trialAvailable(ctx: Context, vendorId: string): Promise<boolean> {
  const keys = await ctx.db
    .select({ pubkey: vendorKeys.pubkey })
    .from(vendorKeys)
    .where(eq(vendorKeys.vendorId, vendorId));
  const claimKeys = keys.map((k) => `key:${k.pubkey}`);
  const claims = await ctx.db
    .select({ key: trialClaims.claimKey })
    .from(trialClaims)
    .where(
      claimKeys.length > 0
        ? or(eq(trialClaims.vendorId, vendorId), inArray(trialClaims.claimKey, claimKeys))
        : eq(trialClaims.vendorId, vendorId),
    )
    .limit(1);
  return claims.length === 0;
}

export async function subscriptionView(ctx: Context, vendorId: string) {
  const now = ctx.now();
  const sub = await currentSubscription(ctx, vendorId);
  const [usage, products, rate, plan, canTrial] = await Promise.all([
    usageThisMonth(ctx.db, vendorId, now),
    productCount(ctx.db, vendorId),
    currentRate(ctx),
    sub ? findPlan(ctx.db, sub.planId).catch(() => null) : null,
    sub ? false : trialAvailable(ctx, vendorId),
  ]);
  const limits = sub?.limits ?? limitsOf(undefined);
  const month = monthStart(now).slice(0, 7);
  const used = (u: number, limit: number) => ({
    used: u,
    limit,
    remaining: Math.max(limit - u, 0),
  });
  return {
    subscription: sub
      ? {
          plan_id: sub.planId,
          next_plan_id: sub.next?.planId ?? null,
          status: sub.status,
          trial: sub.inTrial,
          current_period_start: iso(sub.periodStart) as string,
          current_period_end: iso(sub.periodEnd) as string,
          grace_ends_at:
            sub.status === 'grace' || sub.status === 'suspended' ? iso(sub.graceEndsAt) : null,
        }
      : null,
    plan: plan ? planView(plan, rate) : null,
    usage: {
      products: used(products, limits.products),
      agent_turns: { ...used(usage.agent_turns, limits.agent_turns_per_month), month },
      drafts: { ...used(usage.drafts, limits.drafts_per_month), month },
    },
    actions: actionsFor(sub, canTrial, now),
  };
}

export function invoiceView(inv: InvoiceRow) {
  return {
    id: inv.id,
    status: inv.status,
    plan_id: inv.planId,
    months: inv.months,
    list_price_sat: inv.listPriceSat,
    credit_sat: inv.creditSat,
    amount_sat: inv.amountSat,
    bolt11: inv.bolt11,
    payment_hash: inv.paymentHash,
    amount_msat: inv.amountMsat,
    lightning_uri: `lightning:${inv.bolt11}`,
    description: inv.description,
    expires_at: iso(inv.expiresAt) as string,
    created_at: iso(inv.createdAt) as string,
    covers: {
      from: iso(inv.periodStart ?? inv.createdAt) as string,
      to: iso(inv.periodEnd ?? inv.createdAt) as string,
    },
    settled_at: iso(inv.settledAt),
    preimage: inv.preimage,
  };
}

export async function findInvoice(ctx: Context, vendorId: string, id: string) {
  if (!isUuid(id)) throw new AppError('NOT_FOUND', 'No such invoice.');
  const [inv] = await ctx.db
    .select()
    .from(si)
    .where(and(eq(si.id, id), eq(si.vendorId, vendorId)));
  if (!inv) throw new AppError('NOT_FOUND', 'No such invoice.');
  return invoiceView(inv);
}

export async function listInvoices(
  ctx: Context,
  vendorId: string,
  q: { cursor?: string | undefined; limit: number },
) {
  const conds = [eq(si.vendorId, vendorId)];
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conds.push(
      or(lt(si.createdAt, c.at), and(eq(si.createdAt, c.at), lt(si.id, c.id))) as ReturnType<
        typeof eq
      >,
    );
  }
  const rows = await ctx.db
    .select()
    .from(si)
    .where(and(...conds))
    .orderBy(desc(si.createdAt), desc(si.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    data: page.map(invoiceView),
    next_cursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

// ---------------------------------------------------------------------------------------------- trial

/**
 * A 14-day Pro trial for a vendor with a working wallet. One per Nostr key and per wallet: the claims are written
 * with the subscription, so a second shop on the same key or wallet is refused.
 */
export async function startTrial(ctx: Context, vendorId: string, planId: string) {
  if (planId !== TRIAL_PLAN)
    throw new AppError('VALIDATION_FAILED', `The trial is on the ${TRIAL_PLAN} plan.`, {
      errors: [{ field: 'plan_id', message: `Must be ${TRIAL_PLAN}` }],
    });
  const [wallet] = await ctx.db
    .select()
    .from(core.walletConnections)
    .where(
      and(
        eq(core.walletConnections.owner, 'vendor'),
        eq(core.walletConnections.vendorId, vendorId),
        eq(core.walletConnections.status, 'active'),
      ),
    );
  if (!wallet?.walletPubkey)
    throw new AppError('VALIDATION_FAILED', 'Link a working wallet before starting the trial.', {
      errors: [{ field: 'wallet', message: 'Missing' }],
    });

  const now = ctx.now();
  const end = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  const used = (claim: 'key' | 'wallet' | 'subscription') =>
    new AppError('TRIAL_ALREADY_USED', 'A trial was already used by this key or by this wallet.', {
      errors: [{ claim }],
    });

  await ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.vendorId, vendorId));
    if (existing) throw used('subscription');

    const keys = await tx
      .select({ pubkey: vendorKeys.pubkey })
      .from(vendorKeys)
      .where(eq(vendorKeys.vendorId, vendorId));
    const claims = [
      ...keys.map((k) => ({ claimKey: `key:${k.pubkey}`, kind: 'key' as const })),
      { claimKey: `wallet:${wallet.walletPubkey}`, kind: 'wallet' as const },
    ];
    for (const c of claims) {
      const ok = await tx
        .insert(trialClaims)
        .values({ claimKey: c.claimKey, vendorId, claimedAt: now })
        .onConflictDoNothing()
        .returning({ key: trialClaims.claimKey });
      if (ok.length === 0) throw used(c.kind);
    }
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        vendorId,
        planId: TRIAL_PLAN,
        status: 'trialing',
        currentPeriodStart: now,
        currentPeriodEnd: end,
        trialEndsAt: end,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!sub) throw used('subscription');
    await audit(tx, {
      actor: `vendor:${vendorId}`,
      action: 'subscription.trial_started',
      target: vendorId,
    });
    await announce(tx, sub, now, { reason: 'trial_started' });
  });
  return subscriptionView(ctx, vendorId);
}

// ---------------------------------------------------------------------------------------------- invoices

interface Priced {
  listPriceSat: number;
  creditSat: number;
  amountSat: number;
  from: Date;
  to: Date;
}

/** A lower plan must fit what the shop already has (architecture.md section 3.7). */
async function checkFits(ctx: Context, vendorId: string, plan: PlanRow) {
  const limit = limitsOf(plan).products;
  const n = await productCount(ctx.db, vendorId);
  if (n > limit)
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      `The ${plan.name} plan allows ${limit} products and the shop has ${n}. Archive some first.`,
      { errors: [{ limit: 'products', used: n, allowed: limit }] },
    );
}

/** Prices a purchase and works out the period it will cover, or refuses it (the rules of section 3.7). */
export async function priceInvoice(
  ctx: Context,
  vendorId: string,
  plan: PlanRow,
  months: number,
  sub: EffectiveSubscription | null,
): Promise<Priced> {
  const list = plan.periodPrices[String(months)];
  if (!list)
    throw new AppError('VALIDATION_FAILED', 'months must be 1, 3 or 12.', {
      errors: [{ field: 'months', message: 'Not allowed' }],
    });
  const now = ctx.now();
  const priced = (from: Date, credit = 0): Priced => {
    if (list - credit <= 0)
      throw new AppError(
        'VALIDATION_FAILED',
        'Your remaining time already covers this purchase. Choose a longer period.',
        { errors: [{ field: 'months', message: 'Covered by the credit' }] },
      );
    return {
      listPriceSat: list,
      creditSat: credit,
      amountSat: list - credit,
      from,
      to: addMonths(from, months),
    };
  };

  // Never subscribed, or lapsed: any plan, starting now.
  if (!sub || sub.status === 'grace' || sub.status === 'suspended') {
    if (sub && rank(plan.id) < rank(sub.planId)) await checkFits(ctx, vendorId, plan);
    return priced(now);
  }
  // On the trial and not paid yet: any plan, starting when the trial ends.
  if (sub.row.status === 'trialing' && sub.inTrial && sub.trialEndsAt) {
    if (rank(plan.id) < rank(sub.planId)) await checkFits(ctx, vendorId, plan);
    return priced(sub.trialEndsAt);
  }

  const tail = sub.next?.planId ?? sub.planId;
  if (sub.next && plan.id !== tail)
    throw new AppError(
      'VALIDATION_FAILED',
      `The ${tail} plan is booked from ${iso(sub.next.at)}. Buy it again to extend it, or change plan once it starts.`,
      { errors: [{ field: 'plan_id', message: `Must be ${tail} until ${iso(sub.next.at)}` }] },
    );
  if (plan.id === tail) return priced(maxDate(now, sub.periodEnd));

  if (rank(plan.id) > rank(sub.planId)) {
    // Upgrade now. The unused paid time of the current plan is credited; free trial days are not.
    const [current] = await ctx.db.select().from(plans).where(eq(plans.id, sub.planId));
    const paidFrom = sub.trialEndsAt ? maxDate(now, sub.trialEndsAt) : now;
    const days = Math.max(0, Math.floor((sub.periodEnd.getTime() - paidFrom.getTime()) / DAY_MS));
    const credit = Math.floor(((current?.monthlyPriceSat ?? 0) * days) / 30);
    return priced(now, credit);
  }

  // A lower plan: only in the last 7 days, from the end of the period.
  if (sub.periodEnd.getTime() - now.getTime() > DOWNGRADE_WINDOW_DAYS * DAY_MS)
    throw new AppError(
      'DOWNGRADE_NOT_ALLOWED_YET',
      `A lower plan can be bought in the last ${DOWNGRADE_WINDOW_DAYS} days of the period. Yours ends on ${iso(sub.periodEnd)?.slice(0, 10)}.`,
      { errors: [{ period_end: iso(sub.periodEnd) }] },
    );
  await checkFits(ctx, vendorId, plan);
  return priced(sub.periodEnd);
}

/**
 * Prices the purchase, then asks the platform wallet for an invoice, outside any transaction. A wrong answer from
 * the wallet never becomes an invoice (architecture.md section 3.6).
 */
export async function createSubscriptionInvoice(
  ctx: Context,
  vendorId: string,
  input: { plan_id: string; months: number },
) {
  const plan = await findPlan(ctx.db, input.plan_id);
  const sub = await currentSubscription(ctx, vendorId);
  const p = await priceInvoice(ctx, vendorId, plan, input.months, sub);
  const amountMsat = p.amountSat * 1000;
  const description = `Selly ${plan.name} ${input.months} mois`;

  let made: Awaited<ReturnType<ReturnType<Context['invoices']['forPlatform']>['makeInvoice']>>;
  try {
    made = await ctx.invoices.forPlatform().makeInvoice({
      vendorId,
      amountMsat,
      description,
      expirySeconds: INVOICE_EXPIRY_SECONDS,
    });
  } catch (err) {
    ctx.log.warn({ err: String(err), vendorId }, 'platform make_invoice failed');
    throw new AppError(
      'PAYMENT_UNAVAILABLE',
      'The invoice could not be created. Try again in a few minutes.',
      { headers: { 'Retry-After': '60' } },
    );
  }
  if (
    made.amountMsat !== amountMsat ||
    made.expiresAt <= ctx.now() ||
    !/^[0-9a-f]{64}$/.test(made.paymentHash)
  ) {
    throw new AppError(
      'PAYMENT_UNAVAILABLE',
      'The wallet returned an invoice that does not match the request.',
      { headers: { 'Retry-After': '60' } },
    );
  }

  const [inv] = await ctx.db
    .insert(si)
    .values({
      vendorId,
      subscriptionId: sub?.row.id ?? null,
      planId: plan.id,
      months: input.months,
      listPriceSat: p.listPriceSat,
      creditSat: p.creditSat,
      amountSat: p.amountSat,
      walletConnectionId: made.walletConnectionId,
      source: made.source,
      bolt11: made.bolt11,
      paymentHash: made.paymentHash,
      amountMsat,
      description,
      verifyUrl: made.verifyUrl ?? null,
      expiresAt: made.expiresAt,
      periodStart: p.from,
      periodEnd: p.to,
      createdAt: ctx.now(),
    })
    .returning();
  return invoiceView(inv as InvoiceRow);
}

// ---------------------------------------------------------------------------------------------- settlement

/** Tells the dashboard (subscription.updated) and the agent (entitlements.changed), in the caller's transaction. */
async function announce(
  tx: Database,
  sub: SubRow,
  now: Date,
  extra: Record<string, unknown>,
  dedupe?: { key: string; windowMs: number },
): Promise<boolean> {
  const st = stateOf(sub, now);
  const sent = await notifyVendor(tx, {
    vendorId: sub.vendorId,
    type: 'subscription.updated',
    data: {
      status: st.status,
      plan_id: st.planId,
      next_plan_id: st.next?.planId ?? null,
      current_period_end: iso(sub.currentPeriodEnd),
      ...extra,
    },
    now,
    ...(dedupe ? { dedupeKey: dedupe.key, dedupeWindowMs: dedupe.windowMs } : {}),
  });
  if (extra.reason === 'reminder') return sent;
  const [v] = await tx.select().from(vendors).where(eq(vendors.id, sub.vendorId));
  await publishEvent(tx, {
    type: 'entitlements.changed',
    vendorId: sub.vendorId,
    key: sub.vendorId,
    data: {
      plan_id: st.planId,
      subscription_status: st.status,
      agent_enabled:
        st.status !== 'suspended' && !!v && v.status === 'active' && vendorSettings(v).agentEnabled,
    },
    now,
  });
  return sent;
}

/**
 * The new state of a subscription once an invoice for `planId` and `months` is paid (the rules of section 3.7).
 * Every payment extends the service, even an unexpected one: money is never kept without service in return.
 */
function applyPayment(
  sub: SubRow | null,
  planId: string,
  months: number,
  now: Date,
): { values: Partial<SubRow>; from: Date; to: Date } {
  const fresh = (from: Date) => {
    const to = addMonths(from, months);
    return {
      values: {
        planId,
        nextPlanId: null,
        nextPlanAt: null,
        status: 'active' as SubscriptionStatus,
        currentPeriodStart: from,
        currentPeriodEnd: to,
        graceEndsAt: null,
      },
      from,
      to,
    };
  };
  if (!sub) return fresh(now);
  const st = stateOf(sub, now);
  if (st.status === 'grace' || st.status === 'suspended') return fresh(now);

  if (sub.status === 'trialing' && st.inTrial && sub.trialEndsAt) {
    const from = sub.trialEndsAt;
    const to = addMonths(from, months);
    const booked = planId === sub.planId ? {} : { nextPlanId: planId, nextPlanAt: from };
    return { values: { status: 'active', currentPeriodEnd: to, ...booked }, from, to };
  }

  // A booked plan that has started becomes the plan.
  const base: Partial<SubRow> = st.switched
    ? { planId: st.planId, currentPeriodStart: st.periodStart, nextPlanId: null, nextPlanAt: null }
    : {};
  const tail = st.next?.planId ?? st.planId;
  if (planId === tail || st.next) {
    // A renewal, or (rarely) a second invoice paid for another plan while one is booked: extend the period.
    const from = maxDate(now, sub.currentPeriodEnd);
    const to = addMonths(from, months);
    return { values: { ...base, status: 'active', currentPeriodEnd: to }, from, to };
  }
  if (rank(planId) > rank(st.planId)) return fresh(now);
  // A lower plan, from the end of the period.
  const from = sub.currentPeriodEnd;
  const to = addMonths(from, months);
  return {
    values: {
      ...base,
      status: 'active',
      nextPlanId: planId,
      nextPlanAt: from,
      currentPeriodEnd: to,
    },
    from,
    to,
  };
}

export type SubscriptionSettleResult = 'settled' | 'duplicate' | 'unknown';

/**
 * A subscription invoice was paid, as the platform wallet confirmed with lookup_invoice (ADR-06). One transaction
 * marks it settled and extends the subscription. Idempotent: a second call changes nothing.
 */
export async function settleSubscriptionInvoice(
  ctx: Context,
  input: { invoiceId: string; preimage?: string | undefined },
): Promise<SubscriptionSettleResult> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [inv] = await tx.select().from(si).where(eq(si.id, input.invoiceId));
    if (!inv) return 'unknown';
    if (inv.status === 'settled') return 'duplicate';
    if (input.preimage && sha256Hex(Buffer.from(input.preimage, 'hex')) !== inv.paymentHash)
      throw new Error('preimage does not match the payment hash');
    // A late payment (expired invoice) counts too: it cannot be withdrawn from the payer's wallet.
    const claimed = await tx
      .update(si)
      .set({ status: 'settled', settledAt: now, preimage: input.preimage ?? null })
      .where(and(eq(si.id, inv.id), eq(si.status, inv.status)))
      .returning({ id: si.id });
    if (claimed.length === 0) return 'duplicate';

    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.vendorId, inv.vendorId))
      .for('update');
    const next = applyPayment(sub ?? null, inv.planId, inv.months, now);
    let saved: SubRow | undefined;
    if (sub) {
      [saved] = await tx
        .update(subscriptions)
        .set({ ...next.values, updatedAt: now })
        .where(eq(subscriptions.id, sub.id))
        .returning();
    } else {
      [saved] = await tx
        .insert(subscriptions)
        .values({
          vendorId: inv.vendorId,
          planId: inv.planId,
          status: 'active',
          currentPeriodStart: next.from,
          currentPeriodEnd: next.to,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    }
    const s = saved as SubRow;
    await tx
      .update(si)
      .set({ subscriptionId: s.id, periodStart: next.from, periodEnd: next.to })
      .where(eq(si.id, inv.id));
    await audit(tx, {
      actor: 'system',
      action: inv.status === 'pending' ? 'subscription.paid' : 'subscription.paid_late',
      target: inv.vendorId,
      details: {
        invoice_id: inv.id,
        plan_id: inv.planId,
        months: inv.months,
        amount_sat: inv.amountSat,
      },
    });
    await announce(tx, s, now, { reason: 'paid', invoice_id: inv.id });
    return 'settled';
  });
}

/** A payment notification from the platform wallet: only a direct lookup can settle (ADR-06). */
export async function confirmSubscriptionPayment(
  ctx: Context,
  n: { walletConnectionId: string; paymentHash: string },
): Promise<SubscriptionSettleResult | 'pending'> {
  const [inv] = await ctx.db
    .select()
    .from(si)
    .where(and(eq(si.walletConnectionId, n.walletConnectionId), eq(si.paymentHash, n.paymentHash)));
  if (!inv) return 'unknown';
  if (inv.status === 'settled') return 'duplicate';
  const state = await ctx.invoices.forPlatform().lookupInvoice({
    vendorId: inv.vendorId,
    walletConnectionId: inv.walletConnectionId,
    paymentHash: inv.paymentHash,
  });
  if (!state.settled) return 'pending';
  return settleSubscriptionInvoice(ctx, { invoiceId: inv.id, preimage: state.preimage });
}

/**
 * One pass over open subscription invoices: settle the paid ones, expire the others past their deadline after one
 * last look. A wallet that cannot be asked keeps its invoices open 30 more minutes.
 */
/** Subscription invoices that expired in the last 24 hours: a late payment still buys its months. */
export async function reconcileLateSubscriptionInvoices(
  ctx: Context,
  log?: { warn: (o: object, m: string) => void },
) {
  const now = ctx.now();
  const stale = await ctx.db
    .select()
    .from(si)
    .where(and(eq(si.status, 'expired'), gt(si.expiresAt, new Date(now.getTime() - DAY_MS))))
    .limit(500);
  let settled = 0;
  for (const inv of stale) {
    try {
      const found = await ctx.invoices.forPlatform().lookupInvoice({
        vendorId: inv.vendorId,
        walletConnectionId: inv.walletConnectionId,
        paymentHash: inv.paymentHash,
      });
      if (
        found.settled &&
        (await settleSubscriptionInvoice(ctx, { invoiceId: inv.id, preimage: found.preimage })) ===
          'settled'
      )
        settled++;
    } catch (err) {
      log?.warn({ err: String(err), invoice: inv.id }, 'late subscription lookup failed');
    }
  }
  return { checked: stale.length, settled };
}

export async function reconcileSubscriptionInvoices(
  ctx: Context,
  log?: { warn: (o: object, m: string) => void },
) {
  const now = ctx.now();
  const open = await ctx.db.select().from(si).where(eq(si.status, 'pending')).limit(200);
  let settled = 0;
  let expired = 0;
  for (const inv of open) {
    let failed = false;
    try {
      const found = await ctx.invoices.forPlatform().lookupInvoice({
        vendorId: inv.vendorId,
        walletConnectionId: inv.walletConnectionId,
        paymentHash: inv.paymentHash,
      });
      if (found.settled) {
        if (
          (await settleSubscriptionInvoice(ctx, {
            invoiceId: inv.id,
            preimage: found.preimage,
          })) === 'settled'
        )
          settled++;
        continue;
      }
    } catch (err) {
      failed = true;
      log?.warn({ err: String(err), invoice: inv.id }, 'subscription lookup_invoice failed');
    }
    const deadline = inv.expiresAt.getTime() + (failed ? UNREACHABLE_WALLET_GRACE_MS : 0);
    if (now.getTime() >= deadline) {
      const rows = await ctx.db
        .update(si)
        .set({ status: 'expired' })
        .where(and(eq(si.id, inv.id), eq(si.status, 'pending')))
        .returning({ id: si.id });
      expired += rows.length;
    }
  }
  return { checked: open.length, settled, expired };
}

// ---------------------------------------------------------------------------------------------- status job

/**
 * Persists what reads already compute: trial or period ended (grace), grace ended (suspended), a booked plan that
 * has started. Each change is a conditional update, so a payment settling at the same moment wins. Also sends the
 * renewal reminders 7, 3 and 1 days before the end, once each.
 */
export async function runSubscriptionJob(ctx: Context) {
  const now = ctx.now();
  const rows = await ctx.db
    .select()
    .from(subscriptions)
    .where(
      or(
        inArray(subscriptions.status, ['trialing', 'active', 'grace']),
        isNotNull(subscriptions.nextPlanId),
      ),
    );
  let changed = 0;
  let reminded = 0;
  for (const sub of rows) {
    const st = stateOf(sub, now);
    const set: Partial<SubRow> = {};
    if (st.switched) {
      Object.assign(set, {
        planId: st.planId,
        currentPeriodStart: st.periodStart,
        nextPlanId: null,
        nextPlanAt: null,
      });
    }
    if (st.status !== sub.status) {
      set.status = st.status;
      set.graceEndsAt = st.status === 'grace' || st.status === 'suspended' ? st.graceEndsAt : null;
    }
    if (Object.keys(set).length > 0) {
      const done = await ctx.db.transaction(async (tx) => {
        const [saved] = await tx
          .update(subscriptions)
          .set({ ...set, updatedAt: now })
          .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.updatedAt, sub.updatedAt)))
          .returning();
        if (!saved) return false;
        if (set.status)
          await audit(tx, {
            actor: 'system',
            action: `subscription.${set.status}`,
            target: sub.vendorId,
            details: { from: sub.status },
          });
        await announce(tx, saved, now, { reason: set.status ? 'status' : 'plan_started' });
        return true;
      });
      if (done) changed++;
    }

    if (st.status === 'trialing' || st.status === 'active') {
      const left = sub.currentPeriodEnd.getTime() - now.getTime();
      const days = REMINDER_DAYS.find((d) => left <= d * DAY_MS);
      if (days !== undefined && left > 0) {
        const sent = await ctx.db.transaction((tx) =>
          announce(
            tx,
            sub,
            now,
            { reason: 'reminder', days_left: days },
            { key: `reminder:${iso(sub.currentPeriodEnd)}:${days}`, windowMs: 40 * DAY_MS },
          ),
        );
        if (sent) reminded++;
      }
    }
  }
  return { checked: rows.length, changed, reminded };
}

export { GRACE_DAYS };
