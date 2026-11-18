'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { type FeedItem, useLive } from '@/components/dashboard/live';
import { useVendor } from '@/components/dashboard/shell';
import {
  EmptyState,
  ErrorState,
  Label,
  Section,
  ShareLink,
  Skeleton,
  Title,
} from '@/components/dashboard/ui';
import { NumberRoll } from '@/components/motion/number-roll';
import { useResource } from '@/lib/dashboard/resource';
import { relativeTime } from '@/lib/dashboard/time';
import type { Draft, Metrics, Page, Period, VendorOrder } from '@/lib/dashboard/types';
import { formatMoney } from '@/lib/format';
import { dash } from '@/lib/i18n/dashboard';

const PERIODS: Period[] = ['today', '7d', '30d'];

/** Re-renders every `ms`, so "2 min ago" stays true. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Period"
      className="flex rounded-[6px] border border-d-hairline p-0.5"
    >
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={`min-h-10 rounded-[4px] px-3 text-[0.9375rem] font-medium transition-colors ${
            value === p ? 'bg-d-ink text-d-paper' : 'text-d-ink-soft hover:text-d-ink'
          }`}
        >
          {dash.home.periods[p]}
        </button>
      ))}
    </div>
  );
}

function Figures({ metrics }: { metrics: Metrics }) {
  return (
    <div>
      <p className="text-d-ink-soft">{dash.home.sales}</p>
      <p data-celebrate className="d-figure mt-1 text-[3.25rem] sm:text-[4rem]">
        <NumberRoll value={metrics.revenue.xof} kind="xof" />
      </p>
      <p className="d-figure mt-2 text-2xl text-d-ink-soft">
        <NumberRoll value={metrics.revenue.sat} kind="sats" />{' '}
        <span className="font-ui text-base">{dash.home.sats}</span>
      </p>
      <p className="mt-3 flex flex-wrap gap-x-4 text-d-ink-soft">
        <span>{dash.home.orders(metrics.orders.created)}</span>
        <span>{dash.home.paidOrders(metrics.orders.paid)}</span>
      </p>
    </div>
  );
}

function TodoRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="group flex min-h-12 items-center justify-between gap-3 border-b border-d-hairline py-2"
      >
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="size-2 rounded-full bg-d-lime-deep" />
          {children}
        </span>
        <span
          aria-hidden="true"
          className="text-d-ink-soft transition-transform group-hover:translate-x-1"
        >
          →
        </span>
      </Link>
    </li>
  );
}

function Todo({ metrics }: { metrics: Metrics }) {
  const id = useId();
  const paid = useResource<Page<VendorOrder>>('orders?status=paid', '/orders?status=paid');
  const drafts = useResource<Page<Draft>>('drafts', '/inventory/drafts');
  const toShip = paid.data?.data.length ?? 0;
  const toReview = drafts.data?.data.filter((d) => d.status === 'needs_review').length ?? 0;
  const rows = [
    toShip > 0 && (
      <TodoRow key="ship" href="/app/commandes">
        {dash.home.todoShip(toShip)}
      </TodoRow>
    ),
    metrics.chats_waiting > 0 && (
      <TodoRow key="chats" href="/app/discussions">
        {dash.home.todoChats(metrics.chats_waiting)}
      </TodoRow>
    ),
    metrics.low_stock.length > 0 && (
      <TodoRow key="stock" href="/app/catalogue#stock">
        {dash.home.todoStock(metrics.low_stock.length)}
      </TodoRow>
    ),
    toReview > 0 && (
      <TodoRow key="drafts" href="/app/catalogue#drafts">
        {dash.home.todoDrafts(toReview)}
      </TodoRow>
    ),
  ].filter(Boolean);

  return (
    <Section labelledBy={id}>
      <Label id={id}>{dash.home.todo}</Label>
      {paid.loading || drafts.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length ? (
        <ul>{rows}</ul>
      ) : (
        <p className="text-d-ink-soft">{dash.home.allDone}</p>
      )}
    </Section>
  );
}

function feedText(item: FeedItem): string {
  const who = item.who ?? dash.activity.aCustomer;
  const n = item.number ?? '';
  switch (item.kind) {
    case 'order.paid':
      return dash.activity['order.paid'](who, n, item.total ? formatMoney(item.total) : '');
    case 'order.created':
    case 'order.cancelled':
    case 'order.expired':
    case 'order.fulfilled':
      return dash.activity[item.kind](who, n);
    case 'conversation.handoff':
    case 'conversation.new':
      return item.title ?? dash.activity[item.kind];
    default:
      return dash.activity[item.kind];
  }
}

function feedHref(item: FeedItem): string | null {
  if (item.orderId) return `/app/commandes/${item.orderId}`;
  if (item.conversationId) return `/app/discussions/${item.conversationId}`;
  if (item.kind === 'draft.ready') return '/app/catalogue#drafts';
  if (item.kind.startsWith('wallet.')) return '/app/portefeuille';
  if (item.kind === 'subscription.updated' || item.kind === 'usage.warning')
    return '/app/abonnement';
  return null;
}

function Feed() {
  const id = useId();
  const { feed } = useLive();
  const now = useNow();
  return (
    <Section labelledBy={id}>
      <Label id={id}>
        <span className="inline-flex items-center gap-2">
          {dash.home.live}
          <span
            aria-hidden="true"
            className="motion-loop size-2 animate-pulse rounded-full bg-d-lime-deep"
          />
        </span>
      </Label>
      {feed.length === 0 ? (
        <p className="text-d-ink-soft">{dash.home.liveEmpty}</p>
      ) : (
        <ol aria-live="polite" className="space-y-0">
          {feed.map((item) => {
            const href = feedHref(item);
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={`mt-2 size-2 shrink-0 rounded-full ${item.kind === 'order.paid' ? 'bg-d-paid' : 'bg-d-ink/30'}`}
                />
                <span className="flex-1">
                  <span className={item.kind === 'order.paid' ? 'font-medium' : ''}>
                    {feedText(item)}
                  </span>
                  <span className="block text-sm text-d-ink-soft">
                    {relativeTime(item.at, now)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={item.id} className="d-arrive border-b border-d-hairline">
                {href ? (
                  <Link href={href} className="flex min-h-12 gap-3 py-2 hover:bg-d-paper-deep/60">
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function ShopLink() {
  const id = useId();
  const { vendor } = useVendor();
  return (
    <Section labelledBy={id}>
      <Label id={id}>{dash.home.shopLink}</Label>
      <p className="mb-1 font-display text-xl break-all">
        {vendor.store_url.replace(/^https?:\/\//, '')}
      </p>
      <p className="mb-3 text-d-ink-soft">{dash.home.shopLinkHint}</p>
      <ShareLink url={vendor.store_url} />
    </Section>
  );
}

export default function HomePage() {
  const { vendor } = useVendor();
  const [period, setPeriod] = useState<Period>('today');
  const metrics = useResource<Metrics>(
    `metrics?period=${period}`,
    `/vendors/dashboard/metrics?period=${period}`,
  );

  const noOrders =
    metrics.data && metrics.data.orders.created === 0 && metrics.data.revenue.xof === 0;

  return (
    <div className="mx-auto max-w-6xl">
      <Title aside={<PeriodPicker value={period} onChange={setPeriod} />}>{dash.home.title}</Title>
      <div className="grid gap-x-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <div className="border-t border-d-hairline py-6">
            {metrics.error ? (
              <ErrorState error={metrics.error} onRetry={metrics.refresh} />
            ) : !metrics.data ? (
              <div role="status" className="space-y-3">
                <span className="sr-only">{dash.shell.loading}</span>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-14 w-64" />
                <Skeleton className="h-6 w-40" />
              </div>
            ) : (
              <>
                <Figures metrics={metrics.data} />
                {noOrders && period === '30d' && (
                  <EmptyState
                    compact
                    title={dash.home.noOrdersTitle}
                    text={dash.home.noOrdersText}
                    action={<ShareLink url={vendor.store_url} />}
                  />
                )}
              </>
            )}
          </div>
          {metrics.data && <Todo metrics={metrics.data} />}
        </div>
        <div>
          <Feed />
          <ShopLink />
        </div>
      </div>
    </div>
  );
}
