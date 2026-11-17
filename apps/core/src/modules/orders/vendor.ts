// The vendor's view of orders: list, detail, fulfil and cancel (architecture.md section 5.2 group E).
import { core } from '@selly/db';
import { and, desc, eq, lt, or } from '@selly/db/orm';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { decodeCursor, encodeCursor, iso, money } from '../../util';
import { isUuid, type Vendor } from '../catalog/store';
import { audit, publishEvent } from '../events/outbox';
import * as inventory from '../inventory/service';
import { orderEventData } from '../payments/service';
import { fulfillOrder } from './internal';

const { orders, orderItems, customers, invoices } = core;
type Order = typeof orders.$inferSelect;
type Status = Order['status'];

export async function vendorOrderView(ctx: Context, o: Order) {
  const [items, [c]] = await Promise.all([
    ctx.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
    ctx.db.select().from(customers).where(eq(customers.id, o.customerId)),
  ]);
  const d = o.delivery as {
    method?: 'delivery' | 'pickup';
    zone_id?: string;
    address_text?: string;
    note?: string;
  };
  const cur = o.pricingCurrency;
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    attention: o.attention,
    channel: o.channel,
    customer: { display_name: c?.displayName ?? '', phone_e164: c?.phoneE164 ?? null },
    items: items.map((i) => ({
      title: i.titleSnapshot,
      options: i.optionsSnapshot,
      quantity: i.quantity,
      unit_price: money(i.unitPriceAmount, i.priceCurrency),
    })),
    subtotal: money(o.subtotalXof, cur),
    delivery_fee: money(o.deliveryFeeXof, cur),
    discount: money(o.discountXof, cur),
    total: money(o.totalXof, cur),
    total_sat: o.totalMsat / 1000,
    delivery: {
      method: d.method ?? 'pickup',
      zone_id: d.zone_id ?? null,
      address_text: d.address_text ?? null,
      note: d.note ?? null,
    },
    conversation_id: o.conversationRef && isUuid(o.conversationRef) ? o.conversationRef : null,
    expires_at: iso(o.expiresAt) as string,
    paid_at: iso(o.paidAt),
    fulfilled_at: iso(o.fulfilledAt),
    cancelled_at: iso(o.cancelledAt),
    cancel_reason: o.cancelReason,
    created_at: iso(o.createdAt) as string,
  };
}

export async function findVendorOrderById(
  ctx: Context,
  vendor: Vendor,
  id: string,
): Promise<Order> {
  if (!isUuid(id)) throw new AppError('NOT_FOUND', 'No such order.');
  const [o] = await ctx.db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.vendorId, vendor.id)));
  if (!o) throw new AppError('NOT_FOUND', 'No such order.');
  return o;
}

/** Newest first, by pages. */
export async function listVendorOrders(
  ctx: Context,
  vendor: Vendor,
  q: { status?: Status | undefined; cursor?: string | undefined; limit: number },
) {
  const conds = [eq(orders.vendorId, vendor.id)];
  if (q.status) conds.push(eq(orders.status, q.status));
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conds.push(
      or(
        lt(orders.createdAt, c.at),
        and(eq(orders.createdAt, c.at), lt(orders.id, c.id)),
      ) as ReturnType<typeof eq>,
    );
  }
  const rows = await ctx.db
    .select()
    .from(orders)
    .where(and(...conds))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    data: await Promise.all(page.map((o) => vendorOrderView(ctx, o))),
    next_cursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function fulfillVendorOrder(ctx: Context, vendor: Vendor, id: string, note?: string) {
  const o = await findVendorOrderById(ctx, vendor, id);
  await fulfillOrder(ctx, vendor, o.id, `vendor:${vendor.id}`, note);
  return vendorOrderView(ctx, await findVendorOrderById(ctx, vendor, id));
}

/**
 * Cancels an order. Unpaid: its stock is released and its open invoices cancelled; a payment that still arrives is
 * recorded as a late payment (architecture.md section 4.4). Paid: cancelled without touching stock (the item may
 * never have left, or be damaged); the vendor refunds from their own wallet and adjusts stock by hand.
 * Fulfilled orders cannot be cancelled. Cancelling twice is harmless.
 */
export async function cancelVendorOrder(ctx: Context, vendor: Vendor, id: string, reason: string) {
  const o = await findVendorOrderById(ctx, vendor, id);
  if (o.status === 'cancelled') return vendorOrderView(ctx, o);
  if (o.status === 'fulfilled')
    throw new AppError(
      'VALIDATION_FAILED',
      `Order ${o.number} is fulfilled and cannot be cancelled.`,
    );
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: reason, updatedAt: now })
      .where(and(eq(orders.id, o.id), eq(orders.status, o.status)))
      .returning();
    const cancelled = rows[0];
    if (!cancelled)
      throw new AppError(
        'VALIDATION_FAILED',
        `Order ${o.number} changed meanwhile. Reload and try again.`,
      );
    if (o.status === 'pending_payment') {
      await inventory.release(tx, o.id, `vendor:${vendor.id}`);
      await tx
        .update(invoices)
        .set({ status: 'cancelled' })
        .where(and(eq(invoices.orderId, o.id), eq(invoices.status, 'pending')));
    }
    await audit(tx, {
      actor: `vendor:${vendor.id}`,
      action: 'order.cancelled',
      target: o.id,
      details: { from: o.status, reason },
    });
    await publishEvent(tx, {
      type: 'order.cancelled',
      vendorId: vendor.id,
      key: o.id,
      data: orderEventData(ctx.config.APP_BASE_URL, cancelled),
      now,
    });
  });
  return vendorOrderView(ctx, await findVendorOrderById(ctx, vendor, id));
}
