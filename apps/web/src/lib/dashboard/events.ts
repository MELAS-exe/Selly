// The vendor's live stream (GET /vendors/me/events), reduced to what the dashboard must do.
// Pure: no fetching here. The live provider applies the result.

import type { Money } from '../types';

/** One server-sent event as the provider receives it. */
export interface StreamEvent {
  type: string;
  id: string;
  data: Record<string, unknown>;
}

export type ActivityKind =
  | 'order.created'
  | 'order.paid'
  | 'order.cancelled'
  | 'order.expired'
  | 'order.fulfilled'
  | 'draft.ready'
  | 'wallet.degraded'
  | 'wallet.restored'
  | 'conversation.handoff'
  | 'conversation.new'
  | 'subscription.updated'
  | 'usage.warning';

/** A line of the live activity feed. The customer's name is filled in later, from the order. */
export interface Activity {
  id: string;
  kind: ActivityKind;
  at: string;
  orderId?: string;
  number?: string;
  total?: Money;
  conversationId?: string;
  draftId?: string;
  title?: string;
}

export interface Reduced {
  /** Resource keys to fetch again ("orders" also refreshes every "orders?status=..."). */
  invalidate: string[];
  /** A short success effect: only for a payment. */
  celebrate: boolean;
  activity: Activity | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function reduceEvent(e: StreamEvent): Reduced {
  const at = str(e.data.at) ?? new Date().toISOString();
  const none: Reduced = { invalidate: [], celebrate: false, activity: null };

  if (e.type.startsWith('order.')) {
    const orderId = str(e.data.order_id);
    const kind = e.type as ActivityKind;
    if (
      ![
        'order.created',
        'order.paid',
        'order.cancelled',
        'order.expired',
        'order.fulfilled',
      ].includes(kind)
    )
      return none;
    return {
      invalidate: ['metrics', 'orders', ...(orderId ? [`order:${orderId}`] : [])],
      celebrate: kind === 'order.paid',
      activity: {
        id: e.id,
        kind,
        at,
        orderId,
        number: str(e.data.number),
        total: e.data.total as Money | undefined,
      },
    };
  }

  switch (e.type) {
    case 'draft.ready': {
      const draftId = str(e.data.draft_id);
      return {
        invalidate: ['drafts', 'metrics', 'inventory', ...(draftId ? [`draft:${draftId}`] : [])],
        celebrate: false,
        activity: { id: e.id, kind: 'draft.ready', at, draftId },
      };
    }
    case 'wallet.degraded':
    case 'wallet.restored':
      return {
        invalidate: ['wallet', 'vendor'],
        celebrate: false,
        activity: { id: e.id, kind: e.type, at },
      };
    case 'conversation.handoff':
    case 'conversation.new':
      return {
        invalidate: ['conversations', 'metrics'],
        celebrate: false,
        activity: {
          id: e.id,
          kind: e.type,
          at,
          conversationId: str(e.data.conversation_id),
          title: str(e.data.title),
        },
      };
    case 'subscription.updated':
      return {
        invalidate: ['subscription', 'vendor'],
        celebrate: false,
        activity: { id: e.id, kind: 'subscription.updated', at },
      };
    case 'usage.warning':
      return {
        invalidate: ['subscription'],
        celebrate: false,
        activity: { id: e.id, kind: 'usage.warning', at },
      };
    default:
      return none;
  }
}
