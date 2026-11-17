import { core } from '@selly/db';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../../context';
import { iso } from '../../util';

export type EventType =
  | 'order.created'
  | 'order.paid'
  | 'order.expired'
  | 'order.cancelled'
  | 'order.fulfilled'
  | 'draft.requested'
  | 'wallet.degraded'
  | 'wallet.restored'
  | 'stock.low'
  | 'entitlements.changed';

/**
 * Write an event to the outbox, in the caller's transaction. A dispatcher (not built yet) delivers it to the agent
 * with a signature, at least once and in order per key (architecture.md section 7.1).
 */
export async function publishEvent(
  tx: Database,
  e: { type: EventType; vendorId: string; key: string; data: Record<string, unknown>; now: Date },
) {
  const eventId = uuidv7();
  await tx.insert(core.outbox).values({
    topic: e.type,
    key: e.key,
    payload: {
      event_id: eventId,
      type: e.type,
      occurred_at: iso(e.now),
      vendor_id: e.vendorId,
      data: e.data,
    },
  });
  return eventId;
}

export async function audit(
  tx: Database,
  a: { actor: string; action: string; target?: string; details?: Record<string, unknown> },
) {
  await tx.insert(core.auditLog).values({
    actor: a.actor,
    action: a.action,
    target: a.target ?? null,
    details: a.details ?? {},
  });
}
