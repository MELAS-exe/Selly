// The only writer of stock columns (architecture.md sections 3.5 and 4.6).
// Every function takes a transaction so a stock change and its movement row commit together.
import { core } from '@selly/db';
import { and, eq, sql } from '@selly/db/orm';
import type { Database } from '../../context';
import { AppError } from '../../errors';

export interface StockLine {
  variantId: string;
  quantity: number;
}

const { productVariants: pv, inventoryMovements: mv, orderItems } = core;

/** Hold stock for an order. All or nothing: throws OUT_OF_STOCK, and the caller rolls back. */
export async function reserve(tx: Database, orderId: string, lines: StockLine[], actor: string) {
  // Variant id order, so two concurrent orders cannot deadlock each other.
  const sorted = [...lines].sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
  const short: Record<string, unknown>[] = [];
  for (const l of sorted) {
    const rows = await tx
      .update(pv)
      .set({ reserved: sql`${pv.reserved} + ${l.quantity}` })
      .where(and(eq(pv.id, l.variantId), sql`${pv.onHand} - ${pv.reserved} >= ${l.quantity}`))
      .returning({ id: pv.id });
    if (rows.length === 0) {
      const [v] = await tx
        .select({ onHand: pv.onHand, reserved: pv.reserved })
        .from(pv)
        .where(eq(pv.id, l.variantId));
      short.push({ variant_id: l.variantId, available: v ? v.onHand - v.reserved : 0 });
      continue;
    }
    await tx.insert(mv).values({
      variantId: l.variantId,
      deltaReserved: l.quantity,
      reason: 'reserve',
      orderId,
      actor,
    });
  }
  if (short.length > 0) {
    throw new AppError('OUT_OF_STOCK', 'Some items are no longer available.', { errors: short });
  }
}

async function orderLines(tx: Database, orderId: string): Promise<StockLine[]> {
  const items = await tx
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return items;
}

/** Give back the stock an unpaid order was holding. */
export async function release(tx: Database, orderId: string, actor: string) {
  for (const l of await orderLines(tx, orderId)) {
    await tx
      .update(pv)
      .set({ reserved: sql`${pv.reserved} - ${l.quantity}` })
      .where(eq(pv.id, l.variantId));
    await tx.insert(mv).values({
      variantId: l.variantId,
      deltaReserved: -l.quantity,
      reason: 'release',
      orderId,
      actor,
    });
  }
}

/** The order was paid: the held units leave the shelf. */
export async function commit(tx: Database, orderId: string, actor: string) {
  for (const l of await orderLines(tx, orderId)) {
    await tx
      .update(pv)
      .set({
        onHand: sql`${pv.onHand} - ${l.quantity}`,
        reserved: sql`${pv.reserved} - ${l.quantity}`,
      })
      .where(eq(pv.id, l.variantId));
    await tx.insert(mv).values({
      variantId: l.variantId,
      deltaOnHand: -l.quantity,
      deltaReserved: -l.quantity,
      reason: 'sale',
      orderId,
      actor,
    });
  }
}

/** Is every line of this order available right now? Used when a late payment arrives for an expired order. */
export async function canReserve(tx: Database, orderId: string): Promise<boolean> {
  for (const l of await orderLines(tx, orderId)) {
    const [v] = await tx
      .select({ onHand: pv.onHand, reserved: pv.reserved })
      .from(pv)
      .where(eq(pv.id, l.variantId));
    if (!v || v.onHand - v.reserved < l.quantity) return false;
  }
  return true;
}

/** A vendor changes stock by hand. on_hand can never go below reserved. */
export async function adjust(
  tx: Database,
  variantId: string,
  change: { delta: number } | { setTo: number },
  reason: 'restock' | 'adjustment',
  actor: string,
) {
  const [v] = await tx.select().from(pv).where(eq(pv.id, variantId));
  if (!v) throw new AppError('NOT_FOUND', 'No such variant.');
  const target = 'setTo' in change ? change.setTo : v.onHand + change.delta;
  if (target < v.reserved) {
    throw new AppError(
      'VALIDATION_FAILED',
      `on_hand cannot go below ${v.reserved}, which is held by pending orders.`,
    );
  }
  const delta = target - v.onHand;
  const [updated] = await tx
    .update(pv)
    .set({ onHand: target })
    .where(eq(pv.id, variantId))
    .returning();
  const [movement] = await tx
    .insert(mv)
    .values({ variantId, deltaOnHand: delta, reason, actor })
    .returning();
  return { variant: updated as typeof v, movement: movement as typeof mv.$inferSelect };
}
