import { core } from '@selly/db';
import { satToXofIndicative } from '@selly/money';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { iso } from '../../util';

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

// Plans, trial, subscription invoices, periods, limits, grace (architecture.md 3.7).
// Built so far: the public plan list. TODO (Dev 3): trial, invoices on the platform wallet, period rules, entitlements.
export const subscriptionsModule: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/plans', async (_req, reply) => {
    const ctx = app.ctx;
    const plans = await ctx.db
      .select()
      .from(core.plans)
      .where(eq(core.plans.active, true))
      .orderBy(asc(core.plans.sort));
    // The pricing page must load even when no rate is available: FCFA amounts are then left out.
    const rate = await ctx.rates.current().catch(() => null);
    const xof = (sat: number) =>
      rate ? Number(satToXofIndicative(BigInt(sat), BigInt(rate.xofPerBtcCents))) : null;

    reply.header('Cache-Control', 'public, max-age=300');
    return {
      data: plans.map((p) => ({
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
      })),
      trial: { plan_id: 'pro', days: TRIAL_DAYS },
      grace_days: GRACE_DAYS,
      rate: rate
        ? {
            xof_per_btc: Math.floor(rate.xofPerBtcCents / 100),
            source: rate.source,
            quoted_at: iso(rate.fetchedAt),
          }
        : null,
    };
  });
};
