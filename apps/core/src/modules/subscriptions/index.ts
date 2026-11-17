import { core } from '@selly/db';
import { asc, eq } from '@selly/db/orm';
import { satToXofIndicative } from '@selly/money';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { iso } from '../../util';
import { findVendorById, storeStatus, vendorSettings } from '../catalog/store';
import {
  currentSubscription,
  ENTITLEMENTS_TTL_SECONDS,
  GRACE_DAYS,
  monthStart,
  productCount,
  reportUsage,
  usageThisMonth,
} from './service';

const usageBody = z.strictObject({
  metric: z.enum(['agent_turns', 'drafts']),
  quantity: z.number().int().min(1).max(10),
  reference: z.string().min(1).max(64),
});

export const TRIAL_DAYS = 14;
export { GRACE_DAYS };

// Plans, trial, subscription invoices, periods, limits, grace (architecture.md 3.7).
// Built so far: the public plan list, and the agent's entitlements and usage reports.
// TODO (Dev 3): trial, invoices on the platform wallet, the status job, the dashboard routes.
export const subscriptionsModule: FastifyPluginAsync = async (app) => {
  // Before each turn the agent asks: is the shop open, may the agent answer, how much quota is left?
  app.get<{ Params: { id: string } }>('/internal/v1/vendors/:id/entitlements', async (req) => {
    const ctx = app.ctx;
    const v = await findVendorById(ctx, req.params.id);
    const now = ctx.now();
    const [sub, status, usage, products] = await Promise.all([
      currentSubscription(ctx, v.id),
      storeStatus(ctx, v),
      usageThisMonth(ctx.db, v.id, now),
      productCount(ctx.db, v.id),
    ]);
    const limits = sub?.limits;
    const turnsLeft = (limits?.agent_turns_per_month ?? 0) - usage.agent_turns;
    return {
      vendor_id: v.id,
      store_status: status,
      plan_id: sub?.planId ?? null,
      subscription_status: sub?.status ?? null,
      agent_enabled: status === 'active' && vendorSettings(v).agentEnabled && turnsLeft > 0,
      features: {
        voice_notes: limits?.voice_notes ?? false,
        nostr_dm_alerts: limits?.nostr_dm_alerts ?? false,
      },
      limits: {
        products: limits?.products ?? 0,
        agent_turns_per_month: limits?.agent_turns_per_month ?? 0,
        drafts_per_month: limits?.drafts_per_month ?? 0,
      },
      usage: {
        products,
        agent_turns: usage.agent_turns,
        drafts: usage.drafts,
        month: monthStart(now).slice(0, 7),
      },
      valid_for_seconds: ENTITLEMENTS_TTL_SECONDS,
    };
  });

  app.post<{ Params: { id: string } }>('/internal/v1/vendors/:id/usage', async (req) => {
    const body = usageBody.parse(req.body);
    const v = await findVendorById(app.ctx, req.params.id);
    return reportUsage(app.ctx, v.id, body);
  });
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
