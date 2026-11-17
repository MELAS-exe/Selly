// Read side of subscriptions (architecture.md section 3.7): the effective status of a vendor's plan, its limits,
// monthly usage and the entitlements the agent asks for before each turn.
// The status is computed from the period dates on every read, so an unpaid period moves to grace, then suspended,
// even before the scheduled status job exists. That job will only persist what this computes.
import { core } from '@selly/db';
import { and, eq, ne, sql } from '@selly/db/orm';
import type { Context, Database } from '../../context';
import { notifyVendor } from '../events/notifications';

const { subscriptions, plans, usageCounters, products, idempotencyKeys } = core;

export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;
export const ENTITLEMENTS_TTL_SECONDS = 60;

export type SubscriptionStatus = 'trialing' | 'active' | 'grace' | 'suspended';
export type Metric = 'agent_turns' | 'drafts';

export interface PlanLimits {
  products: number;
  agent_turns_per_month: number;
  drafts_per_month: number;
  voice_notes: boolean;
  nostr_dm_alerts: boolean;
  powered_by_badge: boolean;
}

const NO_LIMITS: PlanLimits = {
  products: 0,
  agent_turns_per_month: 0,
  drafts_per_month: 0,
  voice_notes: false,
  nostr_dm_alerts: false,
  powered_by_badge: true,
};

export interface EffectiveSubscription {
  planId: string;
  status: SubscriptionStatus;
  periodEnd: Date;
  graceEndsAt: Date | null;
  limits: PlanLimits;
}

/** trialing or active past the period end is grace; grace past its end is suspended. */
export function effectiveStatus(
  s: { status: SubscriptionStatus; currentPeriodEnd: Date; graceEndsAt: Date | null },
  now: Date,
): { status: SubscriptionStatus; graceEndsAt: Date | null } {
  const graceEndsAt = s.graceEndsAt ?? new Date(s.currentPeriodEnd.getTime() + GRACE_DAYS * DAY_MS);
  if (s.status === 'suspended') return { status: 'suspended', graceEndsAt };
  if (now < s.currentPeriodEnd && s.status !== 'grace')
    return { status: s.status, graceEndsAt: null };
  return now < graceEndsAt
    ? { status: 'grace', graceEndsAt }
    : { status: 'suspended', graceEndsAt };
}

export async function currentSubscription(
  ctx: Pick<Context, 'db' | 'now'>,
  vendorId: string,
): Promise<EffectiveSubscription | null> {
  const [row] = await ctx.db
    .select({ s: subscriptions, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.vendorId, vendorId));
  if (!row) return null;
  const eff = effectiveStatus(row.s, ctx.now());
  return {
    planId: row.s.planId,
    status: eff.status,
    periodEnd: row.s.currentPeriodEnd,
    graceEndsAt: eff.graceEndsAt,
    limits: { ...NO_LIMITS, ...(row.p.limits as Partial<PlanLimits>) },
  };
}

/** A subscription that lets the shop sell: trialing, active or in grace. */
export const isServing = (s: EffectiveSubscription | null) => !!s && s.status !== 'suspended';

/** First day of the calendar month, UTC, as 'YYYY-MM-DD' (usage counters are monthly). */
export function monthStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function usageThisMonth(
  db: Database,
  vendorId: string,
  now: Date,
): Promise<Record<Metric, number>> {
  const rows = await db
    .select({ metric: usageCounters.metric, used: usageCounters.used })
    .from(usageCounters)
    .where(and(eq(usageCounters.vendorId, vendorId), eq(usageCounters.month, monthStart(now))));
  const out: Record<Metric, number> = { agent_turns: 0, drafts: 0 };
  for (const r of rows) out[r.metric] = r.used;
  return out;
}

export async function productCount(db: Database, vendorId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.vendorId, vendorId), ne(products.status, 'archived')));
  return r?.n ?? 0;
}

const limitFor = (limits: PlanLimits, metric: Metric) =>
  metric === 'agent_turns' ? limits.agent_turns_per_month : limits.drafts_per_month;

/**
 * Count usage after an agent turn or a draft. A repeat with the same reference is counted once: the reference is
 * recorded in idempotency_keys, so no extra table is needed.
 */
export async function reportUsage(
  ctx: Pick<Context, 'db' | 'now'>,
  vendorId: string,
  input: { metric: Metric; quantity: number; reference: string },
) {
  const now = ctx.now();
  const month = monthStart(now);
  const sub = await currentSubscription(ctx, vendorId);
  const limit = limitFor(sub?.limits ?? NO_LIMITS, input.metric);

  const used = await ctx.db.transaction(async (tx) => {
    const fresh = await tx
      .insert(idempotencyKeys)
      .values({ scope: `usage:${vendorId}`, key: input.reference, requestHash: Buffer.alloc(0) })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (fresh.length > 0) {
      await tx
        .insert(usageCounters)
        .values({ vendorId, metric: input.metric, month, used: input.quantity })
        .onConflictDoUpdate({
          target: [usageCounters.vendorId, usageCounters.metric, usageCounters.month],
          set: { used: sql`${usageCounters.used} + ${input.quantity}` },
        });
    }
    const [row] = await tx
      .select({ used: usageCounters.used })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.vendorId, vendorId),
          eq(usageCounters.metric, input.metric),
          eq(usageCounters.month, month),
        ),
      );
    const after = row?.used ?? 0;
    // Tell the vendor once when this report crosses 80 % of the month's quota, and once at 100 %.
    if (fresh.length > 0 && limit > 0) {
      const before = after - input.quantity;
      for (const pct of [80, 100]) {
        const mark = (limit * pct) / 100;
        if (before < mark && after >= mark) {
          await notifyVendor(tx, {
            vendorId,
            type: 'usage.warning',
            data: { metric: input.metric, used: after, limit, percent: pct },
            now,
            dedupeKey: `usage:${input.metric}:${month}:${pct}`,
            dedupeWindowMs: 32 * DAY_MS,
          });
        }
      }
    }
    return after;
  });

  return {
    metric: input.metric,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    exceeded: used >= limit,
    warning: limit > 0 && used >= limit * 0.8,
  };
}
