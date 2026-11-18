'use client';

// Orders: tabs by status, a list grouped by day, and the detail of one order with its actions.
// Phones show the list or the detail; large screens show both side by side.

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/browser-api';
import { groupOrders } from '@/lib/dashboard/orders';
import { useInvalidate, useResource } from '@/lib/dashboard/resource';
import { relativeTime } from '@/lib/dashboard/time';
import type { Page, VendorOrder } from '@/lib/dashboard/types';
import { formatMoney, formatOptions, formatSats } from '@/lib/format';
import { dash } from '@/lib/i18n/dashboard';
import { describeError } from '@/lib/onboarding';
import type { OrderStatus } from '@/lib/types';
import { useVendor } from './shell';
import {
  btn,
  EmptyState,
  ErrorState,
  field,
  Label,
  ListSkeleton,
  ShareLink,
  Skeleton,
  StatusPill,
  Title,
} from './ui';

const TABS: OrderStatus[] = ['paid', 'pending_payment', 'fulfilled', 'cancelled', 'expired'];

// The chosen tab survives going to a detail and back (the list remounts with the route).
let lastTab: OrderStatus = 'paid';

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function OrderList({ selectedId }: { selectedId?: string }) {
  const { vendor } = useVendor();
  const [tab, setTab] = useState<OrderStatus>(lastTab);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState<VendorOrder[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const list = useResource<Page<VendorOrder>>(`orders?status=${tab}`, `/orders?status=${tab}`);

  useEffect(() => {
    lastTab = tab;
    setMore([]);
    setCursor(null);
  }, [tab]);
  useEffect(() => setCursor(list.data?.next_cursor ?? null), [list.data]);

  const orders = [...(list.data?.data ?? []), ...more];
  const now = new Date();

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<Page<VendorOrder>>(
        `/orders?status=${tab}&cursor=${encodeURIComponent(cursor)}`,
      );
      setMore((m) => [...m, ...page.data]);
      setCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={dash.orders.title}
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-3 lg:mx-0 lg:flex-wrap lg:px-0"
      >
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={`min-h-11 shrink-0 rounded-full border px-4 font-medium transition-colors ${
              tab === s
                ? 'border-d-ink bg-d-ink text-d-paper'
                : 'border-d-hairline text-d-ink-soft hover:text-d-ink'
            }`}
          >
            {dash.orders.tabs[s]}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={dash.orders.tabs[tab]}>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.refresh} />
        ) : list.loading ? (
          <ListSkeleton />
        ) : orders.length === 0 ? (
          <EmptyState
            compact
            title={dash.orders.empty[tab]}
            text={tab === 'paid' || tab === 'pending_payment' ? dash.orders.emptyHint : undefined}
            action={tab === 'paid' ? <ShareLink url={vendor.store_url} /> : undefined}
          />
        ) : (
          <>
            {groupOrders(orders, now).map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h2 className="border-b border-d-hairline pt-4 pb-1 text-sm font-medium text-d-ink-soft">
                  {g.label}
                </h2>
                <ul>
                  {g.items.map((o) => (
                    <li key={o.id} className="d-arrive">
                      <Link
                        href={`/app/commandes/${o.id}`}
                        aria-current={o.id === selectedId ? 'page' : undefined}
                        className={`grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-4 border-b border-d-hairline px-2 py-3 ${
                          o.id === selectedId ? 'bg-d-paper-deep' : 'hover:bg-d-paper-deep/60'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{o.customer.display_name}</span>
                          <span className="block truncate text-d-ink-soft">
                            {o.number} · {relativeTime(o.created_at, now)}
                            {o.attention && (
                              <span className="ml-2 font-medium text-d-alert">!</span>
                            )}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="d-figure block text-2xl">{formatMoney(o.total)}</span>
                          <span className="text-sm text-d-ink-soft">{formatSats(o.total_sat)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {cursor && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className={`${btn.secondary} mt-4`}
              >
                {dash.common.loadMore}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-4 py-1 ${strong ? 'font-medium' : 'text-d-ink-soft'}`}
    >
      <dt>{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}

function CancelDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [reason, setReason] = useState('');
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${id}-t`}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-[8px] border border-d-hairline bg-d-paper p-6 text-d-ink backdrop:bg-d-ink/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length >= 2) onConfirm(reason.trim());
        }}
      >
        <h2 id={`${id}-t`} className="font-display text-2xl">
          {dash.orders.cancelTitle}
        </h2>
        <label htmlFor={`${id}-r`} className="mt-4 block font-medium">
          {dash.orders.cancelReason}
        </label>
        <input
          id={`${id}-r`}
          required
          minLength={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={dash.orders.cancelReasonPlaceholder}
          className={`${field} mt-1`}
        />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={btn.secondary}>
            {dash.orders.keep}
          </button>
          <button type="submit" className={btn.danger}>
            {dash.orders.cancelConfirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function OrderDetail({ id }: { id: string }) {
  const { vendor } = useVendor();
  const invalidate = useInvalidate();
  const order = useResource<VendorOrder>(`order:${id}`, `/orders/${encodeURIComponent(id)}`);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const noteId = useId();
  const now = new Date();

  /** Optimistic: show the new state at once, put the old one back if core refuses. */
  async function act(optimistic: Partial<VendorOrder>, request: () => Promise<VendorOrder>) {
    const before = order.data;
    if (!before) return;
    setBusy(true);
    setActionError(null);
    order.mutate({ ...before, ...optimistic });
    try {
      order.mutate(await request());
      invalidate(['orders', 'metrics']);
    } catch (err) {
      order.mutate(before);
      setActionError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (order.error) return <ErrorState error={order.error} onRetry={order.refresh} />;
  if (!order.data)
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{dash.shell.loading}</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );

  const o = order.data;
  const zone = vendor.settings.delivery.zones.find((z) => z.id === o.delivery.zone_id);
  const phone = o.customer.phone_e164;

  return (
    <article aria-labelledby="order-title" className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <h2 id="order-title" className="font-display text-3xl">
          {dash.orders.order(o.number)}
        </h2>
        <StatusPill status={o.status} />
      </div>
      <p className="text-d-ink-soft">{dateTime.format(new Date(o.created_at))}</p>

      {o.attention && (
        <p
          role="alert"
          className="mt-3 border-l-2 border-d-alert bg-d-alert-soft px-3 py-2 text-d-alert"
        >
          {dash.orders.attention[o.attention]}
        </p>
      )}

      <section aria-labelledby="o-items" className="border-t border-d-hairline pt-4 mt-4">
        <Label id="o-items">{dash.orders.items}</Label>
        <ul>
          {o.items.map((it, i) => (
            <li key={`${it.title}-${i}`} className="flex justify-between gap-4 py-1.5">
              <span>
                {it.quantity} × {it.title}
                {Object.keys(it.options).length > 0 && (
                  <span className="block text-d-ink-soft">{formatOptions(it.options)}</span>
                )}
              </span>
              <span className="tnum">
                {formatMoney({ ...it.unit_price, amount: it.unit_price.amount * it.quantity })}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 border-t border-d-hairline pt-2">
          <Row label={dash.orders.subtotal} value={formatMoney(o.subtotal)} />
          <Row label={dash.orders.delivery} value={formatMoney(o.delivery_fee)} />
          {o.discount.amount > 0 && (
            <Row label={dash.orders.discount} value={`− ${formatMoney(o.discount)}`} />
          )}
        </dl>
        <div className="flex items-baseline justify-between gap-4 border-t border-d-hairline pt-3">
          <span className="font-medium">{dash.orders.total}</span>
          <span className="text-right">
            <span className="d-figure block text-4xl">{formatMoney(o.total)}</span>
            <span className="text-d-ink-soft">{formatSats(o.total_sat)}</span>
          </span>
        </div>
      </section>

      <section aria-labelledby="o-customer" className="border-t border-d-hairline pt-4 mt-4">
        <Label id="o-customer">{dash.orders.customer}</Label>
        <p className="font-medium">{o.customer.display_name}</p>
        {phone && (
          <>
            <p className="tnum text-d-ink-soft">{phone}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={`tel:${phone}`} className={btn.secondary}>
                {dash.orders.call}
              </a>
              <a
                href={`https://wa.me/${phone.replace(/^\+/, '')}`}
                target="_blank"
                rel="noopener"
                className={btn.secondary}
              >
                {dash.orders.whatsapp}
              </a>
              {o.conversation_id && (
                <Link href={`/app/discussions/${o.conversation_id}`} className={btn.secondary}>
                  {dash.orders.openChat}
                </Link>
              )}
            </div>
          </>
        )}
        <p className="mt-3">
          {o.delivery.method === 'pickup'
            ? dash.orders.pickup
            : `${dash.orders.deliveryTo}${zone ? `, ${zone.label}` : ''}`}
        </p>
        {o.delivery.address_text && <p className="text-d-ink-soft">{o.delivery.address_text}</p>}
        {o.delivery.note && (
          <p className="text-d-ink-soft">
            {dash.orders.note}: {o.delivery.note}
          </p>
        )}
      </section>

      <section aria-labelledby="o-pay" className="border-t border-d-hairline pt-4 mt-4">
        <Label id="o-pay">{dash.orders.payment}</Label>
        <p>
          {o.paid_at
            ? dash.orders.paidAt(dateTime.format(new Date(o.paid_at)))
            : o.status === 'pending_payment'
              ? dash.orders.expiresAt(relativeTime(o.expires_at, now).replace(' ago', ''))
              : dash.orders.notPaid}
        </p>
        <p className="text-d-ink-soft">{formatSats(o.total_sat)}</p>
        {o.fulfilled_at && (
          <p className="mt-2">{dash.orders.fulfilled(dateTime.format(new Date(o.fulfilled_at)))}</p>
        )}
        {o.cancelled_at && (
          <p className="mt-2">
            {dash.orders.cancelled(dateTime.format(new Date(o.cancelled_at)))}
            {o.cancel_reason && <span className="block text-d-ink-soft">{o.cancel_reason}</span>}
          </p>
        )}
      </section>

      {(o.status === 'paid' || o.status === 'pending_payment') && (
        <section aria-label="Actions" className="border-t border-d-hairline pt-4 mt-4 space-y-3">
          {o.status === 'paid' && (
            <>
              <label htmlFor={noteId} className="block font-medium">
                {dash.orders.fulfilNote}
              </label>
              <input
                id={noteId}
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
                placeholder={dash.orders.fulfilNotePlaceholder}
                className={field}
              />
              <button
                type="button"
                disabled={busy}
                className={`${btn.primary} w-full sm:w-auto`}
                onClick={() =>
                  act({ status: 'fulfilled', fulfilled_at: new Date().toISOString() }, () =>
                    api<VendorOrder>(`/orders/${encodeURIComponent(o.id)}/fulfill`, {
                      method: 'PATCH',
                      body: note.trim() ? { note: note.trim() } : {},
                    }),
                  )
                }
              >
                {dash.orders.fulfil}
              </button>
            </>
          )}
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCancelling(true)}
              className={btn.danger}
            >
              {dash.orders.cancel}
            </button>
          </div>
          {actionError && (
            <p role="alert" className="text-d-alert">
              {actionError}
            </p>
          )}
          <CancelDialog
            open={cancelling}
            onClose={() => setCancelling(false)}
            onConfirm={(reason) => {
              setCancelling(false);
              act(
                {
                  status: 'cancelled',
                  cancelled_at: new Date().toISOString(),
                  cancel_reason: reason,
                },
                () =>
                  api<VendorOrder>(`/orders/${encodeURIComponent(o.id)}/cancel`, {
                    method: 'POST',
                    body: { reason },
                  }),
              );
            }}
          />
        </section>
      )}
    </article>
  );
}

/** The Orders screen. With `selectedId`, phones show only the detail (with a way back). */
export function Orders({ selectedId }: { selectedId?: string }) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className={selectedId ? 'hidden lg:block' : ''}>
        <Title>{dash.orders.title}</Title>
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10">
        <div className={selectedId ? 'hidden lg:block' : ''}>
          <OrderList selectedId={selectedId} />
        </div>
        <div className={selectedId ? '' : 'hidden lg:block'}>
          {selectedId ? (
            <>
              <Link href="/app/commandes" className={`${btn.quiet} mb-2 lg:hidden`}>
                ← {dash.orders.title}
              </Link>
              <div className="lg:sticky lg:top-8 lg:border-l lg:border-d-hairline lg:pl-10">
                <OrderDetail id={selectedId} />
              </div>
            </>
          ) : (
            <p className="mt-16 border-l border-d-hairline pl-10 text-d-ink-soft">
              {dash.orders.pick}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
