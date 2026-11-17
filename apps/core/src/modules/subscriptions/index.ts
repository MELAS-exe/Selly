import { core } from '@selly/db';
import { asc, eq } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { withIdempotency } from '../../idempotency';
import { iso } from '../../util';
import { requireVendor } from '../auth/http';
import { findVendorById, storeStatus, vendorSettings } from '../catalog/store';
import {
  createSubscriptionInvoice,
  currentRate,
  findInvoice,
  listInvoices,
  planView,
  startTrial,
  subscriptionView,
  TRIAL_DAYS,
  TRIAL_PLAN,
} from './billing';
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

const planId = z.enum(['starter', 'pro', 'business']);
const trialBody = z.strictObject({ plan_id: planId });
const invoiceBody = z.strictObject({ plan_id: planId, months: z.number().int() });
const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export { GRACE_DAYS, TRIAL_DAYS };

// Plans, trial, subscription invoices, periods, limits, grace (architecture.md 3.7).
// The rules live in billing.ts (trial, invoices, settlement, status job) and service.ts (status, limits, usage).
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
    const rows = await ctx.db
      .select()
      .from(core.plans)
      .where(eq(core.plans.active, true))
      .orderBy(asc(core.plans.sort));
    const rate = await currentRate(ctx);
    reply.header('Cache-Control', 'public, max-age=300');
    return {
      data: rows.map((p) => planView(p, rate)),
      trial: { plan_id: TRIAL_PLAN, days: TRIAL_DAYS },
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

  // ------------------------------------------------------------------------------- the vendor's subscription

  app.get('/api/v1/vendors/me/subscription', async (req) => {
    const s = await requireVendor(app.ctx, req);
    return subscriptionView(app.ctx, s.vendorId);
  });

  app.post('/api/v1/vendors/me/subscription/trial', async (req, reply) => {
    const s = await requireVendor(app.ctx, req);
    const body = trialBody.parse(req.body);
    return reply.code(201).send(await startTrial(app.ctx, s.vendorId, body.plan_id));
  });

  // Each call asks the platform wallet for an invoice: a tighter limit than other routes.
  app.post(
    '/api/v1/vendors/me/subscription/invoices',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const s = await requireVendor(app.ctx, req);
      const body = invoiceBody.parse(req.body);
      const res = await withIdempotency(
        app.ctx,
        `subscription-invoice:${s.vendorId}`,
        req.headers['idempotency-key'] as string | undefined,
        body,
        async () => ({
          status: 201,
          body: await createSubscriptionInvoice(app.ctx, s.vendorId, body),
        }),
      );
      return reply.code(res.status).send(res.body);
    },
  );

  app.get('/api/v1/vendors/me/subscription/invoices', async (req) => {
    const s = await requireVendor(app.ctx, req);
    const q = listQuery.parse(req.query);
    return listInvoices(app.ctx, s.vendorId, q);
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/vendors/me/subscription/invoices/:id',
    async (req) => {
      const s = await requireVendor(app.ctx, req);
      return findInvoice(app.ctx, s.vendorId, req.params.id);
    },
  );
};
