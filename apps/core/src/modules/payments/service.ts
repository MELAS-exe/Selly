// Settlement and reconciliation for order invoices (architecture.md sections 4.4, 7.3 and 7.6).
// Paid means the wallet that received the money confirmed it with lookup_invoice (ADR-06). Subscription
// invoices will follow the same path once the subscriptions module is built.
import { core } from '@selly/db';
import { and, eq, gt, inArray, lte, ne } from '@selly/db/orm';
import type { Context, Database } from '../../context';
import { sha256Hex } from '../../util';
import { audit, publishEvent } from '../events/outbox';
import * as inventory from '../inventory/service';

const { invoices, orders, orderItems } = core;

export type SettleResult = 'settled' | 'duplicate' | 'unknown';

/** The data of every order.* event. checkout_url lets the agent show the order card again. */
export function orderEventData(appBaseUrl: string, order: typeof orders.$inferSelect) {
  return {
    order_id: order.id,
    number: order.number,
    channel: order.channel,
    conversation_ref: order.conversationRef,
    total: { amount: order.totalXof, currency: order.pricingCurrency },
    total_sat: order.totalMsat / 1000,
    checkout_url: `${appBaseUrl}/c/${order.publicToken}`,
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
        data: orderEventData(ctx.config.APP_BASE_URL, order),
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
      data: orderEventData(ctx.config.APP_BASE_URL, order),
      now,
    });
    return true;
  });
}

/**
 * A wallet notification says an invoice was paid. The notification only triggers a direct lookup on the wallet
 * that made the invoice (ADR-06); the order is paid only if that lookup says settled.
 */
export async function confirmPayment(
  ctx: Context,
  n: { vendorId: string; walletConnectionId: string; paymentHash: string },
): Promise<SettleResult | 'pending'> {
  const [inv] = await ctx.db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.vendorId, n.vendorId),
        eq(invoices.walletConnectionId, n.walletConnectionId),
        eq(invoices.paymentHash, n.paymentHash),
      ),
    );
  if (!inv) return 'unknown'; // a payment for something else, e.g. the vendor's own invoices
  if (inv.status === 'settled') return 'duplicate';
  const state = await ctx.invoices.forVendor(n.vendorId).lookupInvoice({
    vendorId: n.vendorId,
    walletConnectionId: n.walletConnectionId,
    paymentHash: n.paymentHash,
    verifyUrl: inv.verifyUrl,
  });
  if (!state.settled) return 'pending';
  return settleInvoice(ctx, {
    vendorId: n.vendorId,
    paymentHash: n.paymentHash,
    preimage: state.preimage,
  });
}

/** How long past its deadline an order may wait for a wallet that cannot be reached, before it expires anyway. */
const UNREACHABLE_WALLET_GRACE_MS = 30 * 60_000;

/**
 * One reconciliation pass (architecture.md section 7.3). Asks the wallet about every open invoice, settles the paid
 * ones, then expires orders past their deadline after one last look. Notifications only make this faster.
 * An order whose wallet cannot be asked waits up to 30 more minutes: a payment that comes later is still recorded
 * as a late payment (architecture.md section 4.4).
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
      const found = await ctx.invoices.forVendor(invoice.vendorId).lookupInvoice({
        vendorId: invoice.vendorId,
        walletConnectionId: invoice.walletConnectionId,
        paymentHash: invoice.paymentHash,
        verifyUrl: invoice.verifyUrl,
      });
      if (found.settled) {
        await settleInvoice(ctx, {
          vendorId: invoice.vendorId,
          paymentHash: invoice.paymentHash,
          preimage: found.preimage,
        });
      }
    } catch (err) {
      lookupFailed.add(invoice.orderId);
      log?.warn({ err: String(err), invoice: invoice.id }, 'lookup_invoice failed');
    }
  }

  const due = await ctx.db
    .select({ id: orders.id, expiresAt: orders.expiresAt })
    .from(orders)
    .where(and(eq(orders.status, 'pending_payment'), lte(orders.expiresAt, now)));
  let expired = 0;
  for (const o of due) {
    const waitForWallet =
      lookupFailed.has(o.id) && now.getTime() < o.expiresAt.getTime() + UNREACHABLE_WALLET_GRACE_MS;
    if (!waitForWallet && (await expireOrder(ctx, o.id))) expired++;
  }

  return { checked: open.length, expired };
}

/** How long after its expiry an invoice is still looked up: payers sometimes pay a stale invoice. */
export const LATE_PAYMENT_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Looks up invoices that expired or were cancelled in the last 24 hours (architecture.md section 4.4). A regular
 * Lightning invoice cannot be withdrawn, so one paid late is still recorded: the order becomes paid if stock allows,
 * or is flagged for a refund. Runs every few minutes on the job leader; wallet notifications catch most of these
 * sooner.
 */
export async function reconcileLateOnce(
  ctx: Context,
  log?: { warn: (o: object, m: string) => void },
) {
  const now = ctx.now();
  const stale = await ctx.db
    .select()
    .from(invoices)
    .where(
      and(
        inArray(invoices.status, ['expired', 'cancelled']),
        gt(invoices.expiresAt, new Date(now.getTime() - LATE_PAYMENT_WINDOW_MS)),
      ),
    )
    .limit(500);
  let settled = 0;
  for (const inv of stale) {
    try {
      const found = await ctx.invoices.forVendor(inv.vendorId).lookupInvoice({
        vendorId: inv.vendorId,
        walletConnectionId: inv.walletConnectionId,
        paymentHash: inv.paymentHash,
        verifyUrl: inv.verifyUrl,
      });
      if (
        found.settled &&
        (await settleInvoice(ctx, {
          vendorId: inv.vendorId,
          paymentHash: inv.paymentHash,
          preimage: found.preimage,
        })) === 'settled'
      )
        settled++;
    } catch (err) {
      log?.warn({ err: String(err), invoice: inv.id }, 'late lookup_invoice failed');
    }
  }
  return { checked: stale.length, settled };
}
