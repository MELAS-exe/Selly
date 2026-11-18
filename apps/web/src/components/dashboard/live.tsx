'use client';

// One live connection for the whole dashboard: GET /api/v1/vendors/me/events (server-sent events).
// Each event is reduced (lib/dashboard/events.ts) to the data to reload, a line for the activity feed and,
// for a payment, a short celebration. Pages read the feed and subscribe to events through this context.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '@/lib/browser-api';
import { type Activity, reduceEvent, type StreamEvent } from '@/lib/dashboard/events';
import { useInvalidate } from '@/lib/dashboard/resource';
import type { VendorOrder } from '@/lib/dashboard/types';
import { prefersReducedMotion } from '../motion/tokens';

/** Event names the stream sends (architecture.md 5.2 D, plus wallet.restored and conversation.new). */
const TYPES = [
  'order.created',
  'order.paid',
  'order.expired',
  'order.cancelled',
  'order.fulfilled',
  'draft.ready',
  'wallet.degraded',
  'wallet.restored',
  'wallet.paired',
  'conversation.handoff',
  'conversation.new',
  'subscription.updated',
  'usage.warning',
];

export interface FeedItem extends Activity {
  /** The customer's name, once the order has been read. */
  who?: string;
}

interface Live {
  status: 'connecting' | 'open' | 'down';
  feed: FeedItem[];
  /** Listen to every event (after the feed and the data have been updated). Returns the unsubscribe. */
  subscribe: (fn: (e: StreamEvent) => void) => () => void;
}

const LiveContext = createContext<Live>({
  status: 'connecting',
  feed: [],
  subscribe: () => () => {},
});

export const useLive = () => useContext(LiveContext);

/** A short, quiet burst from the sales figure, in the dashboard's greens. Skipped under reduced motion. */
function celebrate() {
  if (prefersReducedMotion()) return;
  const anchor = document.querySelector('[data-celebrate]') ?? document.querySelector('main');
  if (!anchor) return;
  import('../motion/confetti').then((m) =>
    m.burst(anchor, 36, ['--color-d-lime', '--color-d-ink', '--color-d-lime-deep']),
  );
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const invalidate = useInvalidate();
  const [status, setStatus] = useState<Live['status']>('connecting');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const listeners = useRef(new Set<(e: StreamEvent) => void>());

  const subscribe = useCallback((fn: (e: StreamEvent) => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/v1/vendors/me/events');
    es.onopen = () => setStatus('open');
    es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? 'down' : 'connecting');

    const handle = (type: string) => (msg: MessageEvent<string>) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      const event: StreamEvent = { type, id: msg.lastEventId, data };
      const r = reduceEvent(event);
      invalidate(r.invalidate);
      if (r.celebrate) celebrate();
      const activity = r.activity;
      if (activity) {
        setFeed((f) => [activity, ...f.filter((x) => x.id !== activity.id)].slice(0, 20));
        // The event has no customer name (core sends the order id and number): read the order for it.
        if (activity.orderId) {
          api<VendorOrder>(`/orders/${encodeURIComponent(activity.orderId)}`).then(
            (o) =>
              setFeed((f) =>
                f.map((x) => (x.id === activity.id ? { ...x, who: o.customer.display_name } : x)),
              ),
            () => {},
          );
        }
      }
      for (const fn of listeners.current) fn(event);
    };

    for (const t of TYPES) es.addEventListener(t, handle(t) as EventListener);
    return () => es.close();
  }, [invalidate]);

  const value = useMemo(() => ({ status, feed, subscribe }), [status, feed, subscribe]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
