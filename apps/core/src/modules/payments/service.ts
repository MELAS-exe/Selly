// Settlement and reconciliation for order invoices (architecture.md sections 4.4, 7.3 and 7.6).
// Paid means the wallet that received the money confirmed it with lookup_invoice (ADR-06). Subscription
// invoices will follow the same path once the subscriptions module is built.
import { core } from '@selly/db';
import { and, eq, lte, ne } from 'drizzle-orm';
import type { Context, Database } from '../../context';
import { sha256Hex } from '../../util';
import { audit, publishEvent } from '../events/outbox';
import * as inventory from '../inventory/service';

const { invoices, orders, orderItems } = core;

export type SettleResult = 'settled' | 'duplicate' | 'unknown';

export async function orderEventData(tx: Database, order: typeof orders.$inferSelect) {
  return {
    order_id: order.id,
    number: order.number,
    channel: order.channel,
    conversation_ref: order.conversationRef,
    total: { amount: order.totalXof, currency: order.pricingCurrency },
    total_sat: order.totalMsat / 1000,
  };
}

/**
 * An invoice was paid. Matched by vendor and payment hash together, never by hash alone, so one vendor's wallet
 * can never settle another vendor's order. Idempotent: a second call changes nothing.
 */
export async function settleInvoice(
  ctx: Context,
  input: { vendorId: string; paymentHash: string; preimage?: string },
): Promise<SettleResult> {
  const now = ctx.now();
  if (input.preimage && sha256Hex(Buffer.from(input.preimage, 'hex')) !== input.paymentHash) {
    throw new Error('preimage does not match the payment hash');
  }
  return ctx.db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.vendorId, input.vendorId), eq(invoices.paymentHash, input.paymentHash)),
      );
    if (!inv) return 'unknown';

    const claimed = await tx
      .update(invoices)
      .set({ status: 'settled', settledAt: now, preimage: input.preimage ?? null })
      .where(and(eq(invoices.id, inv.id), ne(invoices.status, 'settled')))
      .returning({ id: invoices.id });
    if (claimed.length === 0) return 'duplicate';

    const [order] = await tx.select().from(orders).where(eq(orders.id, inv.orderId)).for('update');
    if (!order) return 'unknown';

    let becamePaid = false;
    if (order.status === 'pending_payment') {
      await inventory.commit(tx, order.id, 'system');
      await tx
        .update(orders)
        .set({ status: 'paid', paidAt: now, updatedAt: now })
        .where(eq(orders.id, order.id));
      becamePaid = true;
    } else if (order.status === 'expired' || order.status === 'cancelled') {
      // A late payment: the invoice cannot be withdrawn from the payer's wallet. Take the order if stock allows.
      if (await inventory.canReserve(tx, order.id)) {
        const items = await tx
          .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
        await inventory.reserve(tx, order.id, items, 'system');
        await inventory.commit(tx, order.id, 'system');
        await tx
          .update(orders)
          .set({ status: 'paid', paidAt: now, updatedAt: now })
          .where(eq(orders.id, order.id));
        becamePaid = true;
      } else {
        await tx
          .update(orders)
          .set({ attention: 'paid_without_stock', updatedAt: now })
          .where(eq(orders.id, order.id));
      }
    } else {
      await tx
        .update(orders)
        .set({ attention: 'paid_twice', updatedAt: now })
        .where(eq(orders.id, order.id));
    }

    await audit(tx, {
      actor: 'system',
      action: becamePaid ? 'order.paid' : 'order.paid_attention',
      target: order.id,
      details: { payment_hash: input.paymentHash },
    });
    if (becamePaid) {
      await publishEvent(tx, {
        type: 'order.paid',
        vendorId: order.vendorId,
        key: order.id,
        data: await orderEventData(tx, order),
        now,
      });
    }
    return 'settled';
  });
}

/** Unpaid and past its deadline: free the stock and tell the agent. A conditional update, so it runs once. */
export async function expireOrder(ctx: Context, orderId: string): Promise<boolean> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'pending_payment')))
      .returning();
    const order = rows[0];
    if (!order) return false;
    await inventory.release(tx, order.id, 'system');
    await tx
      .update(invoices)
      .set({ status: 'expired' })
      .where(and(eq(invoices.orderId, order.id), eq(invoices.status, 'pending')));
    await publishEvent(tx, {
      type: 'order.expired',
      vendorId: order.vendorId,
      key: order.id,
      data: {
        order_id: order.id,
        number: order.number,
        channel: order.channel,
        conversation_ref: order.conversationRef,
      },
      now,
    });
    return true;
  });
}

/**
 * One reconciliation pass (architecture.md section 7.3). Asks the wallet about every open invoice, settles the paid
 * ones, then expires orders past their deadline after one last look. Notifications only make this faster.
 * Not yet covered: polling already-expired invoices for late payments.
 */
export async function reconcileOnce(ctx: Context, log?: { warn: (o: object, m: string) => void }) {
  const now = ctx.now();
  const open = await ctx.db
    .select({ invoice: invoices })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(and(eq(invoices.status, 'pending'), eq(orders.status, 'pending_payment')))
    .limit(200);

  const lookupFailed = new Set<string>();
  for (const { invoice } of open) {
    try {
      const found = await ctx.invoices
        .forVendor(invoice.vendorId)
        .lookupInvoice({ vendorId: invoice.vendorId, paymentHash: invoice.paymentHash });
      if (found.settled) {
        await settleInvoice(ctx, {
          vendorId: invoice.vendorId,
          paymentHash: invoice.paymentHash,
          preimage: found.preimage,
        });
      }
    } catch (err) {
      // Never expire an order whose wallet we could not ask: it may have been paid.
      lookupFailed.add(invoice.orderId);
      log?.warn({ err, invoice: invoice.id }, 'lookup_invoice failed');
    }
  }

  const due = await ctx.db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'pending_payment'), lte(orders.expiresAt, now)));
  let expired = 0;
  for (const o of due) if (!lookupFailed.has(o.id) && (await expireOrder(ctx, o.id))) expired++;

  return { checked: open.length, expired };
}
