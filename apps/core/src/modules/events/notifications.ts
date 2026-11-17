// What the vendor's dashboard hears about (architecture.md section 5.2 group D: GET /vendors/me/events).
// Written in the same transaction as the change it reports; read by the SSE stream; kept 7 days.
import { core } from '@selly/db';
import { and, desc, eq, gt, lt } from '@selly/db/orm';
import type { Database } from '../../context';

const { vendorNotifications: vn } = core;

export type VendorNotificationType =
  | 'order.created'
  | 'order.paid'
  | 'order.expired'
  | 'order.cancelled'
  | 'order.fulfilled'
  | 'wallet.degraded'
  | 'wallet.restored'
  | 'wallet.paired'
  | 'conversation.handoff'
  | 'conversation.new'
  | 'usage.warning'
  | 'draft.ready'
  | 'subscription.updated';

/** Core events the vendor's dashboard also shows. Others (draft.requested, entitlements.changed) are for the agent. */
export const VENDOR_TOPICS = new Set<string>([
  'order.created',
  'order.paid',
  'order.expired',
  'order.cancelled',
  'order.fulfilled',
  'wallet.degraded',
  'wallet.restored',
]);

export const KEEP_DAYS = 7;

/**
 * Records a notification. With a dedupeKey, a repeat inside `dedupeWindowMs` is dropped: a chat handed to the vendor
 * five times in a minute is one alert.
 */
export async function notifyVendor(
  tx: Database,
  n: {
    vendorId: string;
    type: VendorNotificationType;
    data: Record<string, unknown>;
    now: Date;
    dedupeKey?: string;
    dedupeWindowMs?: number;
  },
): Promise<boolean> {
  if (n.dedupeKey) {
    const since = new Date(n.now.getTime() - (n.dedupeWindowMs ?? 5 * 60_000));
    const [recent] = await tx
      .select({ id: vn.id })
      .from(vn)
      .where(
        and(eq(vn.vendorId, n.vendorId), eq(vn.dedupeKey, n.dedupeKey), gt(vn.createdAt, since)),
      )
      .limit(1);
    if (recent) return false;
  }
  await tx.insert(vn).values({
    vendorId: n.vendorId,
    type: n.type,
    data: n.data,
    dedupeKey: n.dedupeKey ?? null,
    createdAt: n.now,
  });
  return true;
}

/** Notifications after `afterId` (UUIDv7, so ordered by time), oldest first. */
export async function notificationsAfter(
  db: Database,
  vendorId: string,
  afterId: string | null,
  limit = 50,
) {
  return db
    .select()
    .from(vn)
    .where(afterId ? and(eq(vn.vendorId, vendorId), gt(vn.id, afterId)) : eq(vn.vendorId, vendorId))
    .orderBy(vn.id)
    .limit(limit);
}

/** The newest notification id, so a new stream starts from now instead of replaying the week. */
export async function latestNotificationId(db: Database, vendorId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: vn.id })
    .from(vn)
    .where(eq(vn.vendorId, vendorId))
    .orderBy(desc(vn.id))
    .limit(1);
  return row?.id ?? null;
}

export async function purgeOldNotifications(db: Database, now: Date) {
  await db.delete(vn).where(lt(vn.createdAt, new Date(now.getTime() - KEEP_DAYS * 86_400_000)));
}
