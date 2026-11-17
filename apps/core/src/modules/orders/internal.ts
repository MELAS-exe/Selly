// Orders for the agent: status by number, the vendor's order list, fulfilment and sales numbers
// (architecture.md section 5.2 group G). Every query is scoped to the vendor of the route.
import { core } from '@selly/db';
import { and, desc, eq, gte, inArray, sql } from '@selly/db/orm';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { iso, money } from '../../util';
import { isUuid, type Vendor } from '../catalog/store';
import { audit, publishEvent } from '../events/outbox';
import { orderEventData } from '../payments/service';
import { usageThisMonth } from '../subscriptions/service';

const { orders, customers, productVariants: pv, products } = core;
type Order = typeof orders.$inferSelect;
type Status = Order['status'];

const DAY_MS = 86_400_000;
const LOW_STOCK = 3;

export const statusView = (o: Order) => ({
  number: o.number,
  status: o.status,
  paid_at: iso(o.paidAt),
  fulfilled_at: iso(o.fulfilledAt),
  total: money(o.totalXof, o.pricingCurrency),
});

/** An order by id or by its short number ("A7K2", case-insensitive), within this vendor. */
export async function findOrder(ctx: Context, vendor: Vendor, ref: string): Promise<Order> {
  const byId = isUuid(ref);
  const number = ref.trim().toUpperCase();
  if (!byId && !/^[A-Z0-9]{4}$/.test(number))
    throw new AppError('NOT_FOUND', `No order ${ref} for this shop.`);
  const [o] = await ctx.db
    .select()
    .from(orders)
    .where(
      and(eq(orders.vendorId, vendor.id), byId ? eq(orders.id, ref) : eq(orders.number, number)),
    );
  if (!o) throw new AppError('NOT_FOUND', `No order ${ref} for this shop.`);
  return o;
}

/** Start of the period in UTC (Senegal is UTC all year, architecture.md F10). */
export function periodStart(period: 'today' | '7d' | '30d', now: Date): Date {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return period === 'today'
    ? today
    : new Date(today.getTime() - (period === '7d' ? 6 : 29) * DAY_MS);
}

export async function listOrders(
  ctx: Context,
  vendor: Vendor,
  q: { status?: Status | undefined; period?: 'today' | '7d' | undefined },
) {
  const conds = [eq(orders.vendorId, vendor.id)];
  if (q.status) conds.push(eq(orders.status, q.status));
  if (q.period) conds.push(gte(orders.createdAt, periodStart(q.period, ctx.now())));
  const rows = await ctx.db
    .select({ o: orders, name: customers.displayName })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(...conds))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  return {
    data: rows.map(({ o, name }) => ({
      number: o.number,
      status: o.status,
      total: money(o.totalXof, o.pricingCurrency),
      customer_name: name ?? '',
      created_at: iso(o.createdAt) as string,
    })),
  };
}

/** Paid to fulfilled (dispatched or delivered). The customer's order page shows it; the agent is told. */
export async function fulfillOrder(
  ctx: Context,
  vendor: Vendor,
  ref: string,
  actor: string,
  note?: string,
) {
  const order = await findOrder(ctx, vendor, ref);
  const now = ctx.now();
  const updated = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({ status: 'fulfilled', fulfilledAt: now, updatedAt: now })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'paid')))
      .returning();
    const o = rows[0];
    if (!o) return null;
    await audit(tx, {
      actor,
      action: 'order.fulfilled',
      target: o.id,
      ...(note ? { details: { note } } : {}),
    });
    await publishEvent(tx, {
      type: 'order.fulfilled',
      vendorId: vendor.id,
      key: o.id,
      data: orderEventData(ctx.config.APP_BASE_URL, o),
      now,
    });
    return o;
  });
  if (!updated) {
    if (order.status === 'fulfilled') return statusView(order); // already done: the command is idempotent
    throw new AppError(
      'VALIDATION_FAILED',
      `Only paid orders can be fulfilled. Order ${order.number} is ${order.status}.`,
    );
  }
  return statusView(updated);
}

/**
 * Sales numbers for a period. Orders are counted by creation date, revenue by payment date.
 * chats_waiting is the agent's own data and is always 0 here; agent_turns is this calendar month.
 */
export async function metrics(ctx: Context, vendor: Vendor, period: 'today' | '7d' | '30d') {
  const now = ctx.now();
  const from = periodStart(period, now);
  const [counts] = await ctx.db
    .select({
      created: sql<number>`count(*)::int`,
      paid: sql<number>`count(*) filter (where ${orders.paidAt} is not null)::int`,
      fulfilled: sql<number>`count(*) filter (where ${orders.status} = 'fulfilled')::int`,
      pending: sql<number>`count(*) filter (where ${orders.status} = 'pending_payment')::int`,
      expired: sql<number>`count(*) filter (where ${orders.status} = 'expired')::int`,
    })
    .from(orders)
    .where(and(eq(orders.vendorId, vendor.id), gte(orders.createdAt, from)));
  const [revenue] = await ctx.db
    .select({
      xof: sql<number>`coalesce(sum(${orders.totalXof}) filter (where ${orders.pricingCurrency} = 'XOF'), 0)::bigint`,
      msat: sql<number>`coalesce(sum(${orders.totalMsat}), 0)::bigint`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.vendorId, vendor.id),
        inArray(orders.status, ['paid', 'fulfilled']),
        gte(orders.paidAt, from),
      ),
    );
  const low = await ctx.db
    .select({
      id: pv.id,
      title: products.title,
      options: pv.options,
      available: sql<number>`(${pv.onHand} - ${pv.reserved})::int`,
    })
    .from(pv)
    .innerJoin(products, eq(products.id, pv.productId))
    .where(
      and(
        eq(products.vendorId, vendor.id),
        eq(products.status, 'active'),
        sql`${pv.onHand} - ${pv.reserved} <= ${LOW_STOCK}`,
      ),
    )
    .orderBy(sql`${pv.onHand} - ${pv.reserved}`, products.title)
    .limit(20);
  const usage = await usageThisMonth(ctx.db, vendor.id, now);

  return {
    period,
    orders: counts ?? { created: 0, paid: 0, fulfilled: 0, pending: 0, expired: 0 },
    revenue: { xof: Number(revenue?.xof ?? 0), sat: Math.floor(Number(revenue?.msat ?? 0) / 1000) },
    low_stock: low.map((l) => ({
      variant_id: l.id,
      title: l.title,
      options: l.options,
      available: l.available,
    })),
    chats_waiting: 0,
    agent_turns: usage.agent_turns,
  };
}
