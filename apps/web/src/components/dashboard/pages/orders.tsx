'use client';

// Commandes. The vendor does not confirm an order: the customer pays it (architecture.md 4.4). What the vendor
// does is ship a paid order, or cancel one, with a refund arranged outside Selly when it was paid.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useT } from '../../lang';
import { useDashboard, useResource } from '../data';
import {
  fmtInt,
  fmtLongDate,
  fmtSats,
  fmtTime,
  fmtWhen,
  fmtXof,
  formatOptions,
  itemsLine,
  ORDER_STATUS,
  orderBadge,
} from '../format';
import { ArrowLeft, MessageCircle, Search, ShoppingBag, TriangleAlert, Truck, X } from '../icons';
import type { OrderStatus, Page, VendorOrder } from '../types';
import { Badge, Empty, Failed, InfoRow, Loading, Modal, PageTitle, PanelHead } from '../ui';

const FILTERS: { value: '' | OrderStatus; label: [fr: string, en: string] }[] = [
  { value: '', label: ['Tous les statuts', 'All statuses'] },
  { value: 'paid', label: ['À expédier', 'To ship'] },
  { value: 'pending_payment', label: ['En attente de paiement', 'Awaiting payment'] },
  { value: 'fulfilled', label: ['Expédiées', 'Shipped'] },
  { value: 'expired', label: ['Expirées', 'Expired'] },
  { value: 'cancelled', label: ['Annulées', 'Cancelled'] },
];

const money = (o: VendorOrder) =>
  o.total.currency === 'SAT' ? fmtSats(o.total.amount) : fmtXof(o.total.amount);

export function Orders() {
  const t = useT();
  const router = useRouter();
  const { mutate } = useDashboard();
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [search, setSearch] = useState('');
  const orders = useResource<Page<VendorOrder>>(status ? `/orders?status=${status}` : '/orders');
  const [cancelling, setCancelling] = useState<VendorOrder | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (orders.data?.data ?? []).filter(
      (o) =>
        !q ||
        `${o.number} ${o.customer.display_name} ${o.customer.phone_e164 ?? ''} ${itemsLine(o)}`
          .toLowerCase()
          .includes(q),
    );
  }, [orders.data, search]);

  return (
    <>
      <PageTitle
        eyebrow={t('Ventes · votre boutique', 'Sales · your shop')}
        title={t('Commandes', 'Orders')}
        description={t(
          'Chaque paiement client va directement dans votre portefeuille Lightning. Expédiez les commandes payées.',
          'Every customer payment goes straight into your Lightning wallet. Ship the paid orders.',
        )}
      />
      <div className="toolbar">
        <label className="search-wrap">
          <Search size={15} />
          <input
            aria-label={t('Rechercher une commande', 'Search orders')}
            className="search"
            placeholder={t('Numéro, client, téléphone, article…', 'Number, customer, phone, item…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="select"
          aria-label={t('Filtrer les commandes', 'Filter orders')}
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | OrderStatus)}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {t(...f.label)}
            </option>
          ))}
        </select>
      </div>
      {orders.error && !orders.data ? (
        <Failed error={orders.error} retry={orders.reload} />
      ) : !orders.data ? (
        <Loading />
      ) : (
        <div className="table-panel">
          <div className="table-scroll">
            <table className="data-table orders-table">
              <thead>
                <tr>
                  <th>{t('Commande', 'Order')}</th>
                  <th>{t('Client', 'Customer')}</th>
                  <th>{t('Articles', 'Items')}</th>
                  <th>{t('État', 'Status')}</th>
                  <th>{t('Livraison', 'Delivery')}</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => {
                  const b = orderBadge(o);
                  return (
                    <tr
                      key={o.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a')) return;
                        router.push(`/app/commandes/${o.id}`);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <Link className="table-primary" href={`/app/commandes/${o.id}`}>
                          {o.number}
                        </Link>
                        <div className="table-secondary">{fmtWhen(o.created_at)}</div>
                      </td>
                      <td>
                        <div className="table-primary">{o.customer.display_name}</div>
                        <div className="table-secondary">{o.customer.phone_e164 ?? '—'}</div>
                      </td>
                      <td>{itemsLine(o)}</td>
                      <td>
                        <Badge tone={b.tone}>{b.label}</Badge>
                      </td>
                      <td>
                        {o.delivery.method === 'pickup'
                          ? t('Retrait', 'Pickup')
                          : (o.delivery.address_text ?? t('Livraison', 'Delivery'))}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="table-primary">{money(o)}</div>
                        <div className="table-secondary">{fmtSats(o.total_sat)}</div>
                      </td>
                      <td>
                        <div className="table-actions">
                          {o.status === 'paid' && (
                            <button
                              type="button"
                              className="button small olive"
                              onClick={() =>
                                mutate(
                                  `/orders/${o.id}/fulfill`,
                                  { method: 'PATCH', body: {} },
                                  t(
                                    `Commande ${o.number} marquée expédiée.`,
                                    `Order ${o.number} marked shipped.`,
                                  ),
                                ).catch(() => {})
                              }
                            >
                              <Truck size={13} /> {t('Expédiée', 'Shipped')}
                            </button>
                          )}
                          {(o.status === 'pending_payment' || o.status === 'paid') && (
                            <button
                              type="button"
                              className="button small ghost"
                              aria-label={t(
                                `Annuler la commande ${o.number}`,
                                `Cancel order ${o.number}`,
                              )}
                              title={t('Annuler', 'Cancel')}
                              onClick={() => setCancelling(o)}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && (
              <Empty
                icon={ShoppingBag}
                title={
                  orders.data.data.length
                    ? t('Aucune commande trouvée', 'No order found')
                    : t('Pas encore de commande', 'No orders yet')
                }
                text={
                  orders.data.data.length
                    ? t('Essayez un autre mot-clé ou statut.', 'Try another word or status.')
                    : t(
                        'Les commandes prises par l’assistant ou sur votre boutique arrivent ici.',
                        'Orders taken by the assistant or in your shop arrive here.',
                      )
                }
              />
            )}
          </div>
        </div>
      )}
      {cancelling && <CancelModal order={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function CancelModal({ order, onClose }: { order: VendorOrder; onClose: () => void }) {
  const { mutate } = useDashboard();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <Modal title={t(`Annuler ${order.number}`, `Cancel ${order.number}`)} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await mutate(
              `/orders/${order.id}/cancel`,
              { method: 'POST', body: { reason: reason.trim() } },
              `Commande ${order.number} annulée.`,
            );
            onClose();
          } catch {
            setBusy(false);
          }
        }}
      >
        <p className="modal-copy">
          {order.status === 'paid'
            ? t(
                'Cette commande est payée. Selly ne peut pas rembourser : renvoyez les sats au client depuis votre portefeuille. Le stock n’est pas remis automatiquement.',
                'This order is paid. Selly cannot refund: send the sats back to the customer from your wallet. The stock is not put back automatically.',
              )
            : t(
                'La commande et sa facture sont annulées, et le stock réservé est libéré.',
                'The order and its invoice are cancelled, and the reserved stock is released.',
              )}
        </p>
        <label className="form-label" htmlFor="cancel-reason">
          {t('Raison, visible par le client', 'Reason, shown to the customer')}
        </label>
        <input
          id="cancel-reason"
          className="form-control"
          required
          minLength={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('Ex. Article en rupture', 'E.g. Out of stock')}
        />
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {t('Retour', 'Back')}
          </button>
          <button
            type="submit"
            className="button danger"
            disabled={busy || reason.trim().length < 2}
          >
            {t('Annuler la commande', 'Cancel the order')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const t = useT();
  const { mutate } = useDashboard();
  const order = useResource<VendorOrder>(`/orders/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState('');

  if (order.error && !order.data) return <Failed error={order.error} retry={order.reload} />;
  const o = order.data;
  if (!o) return <Loading rows={5} />;
  const b = orderBadge(o);
  const steps: [string, string | null][] = [
    [t('Commande créée', 'Order placed'), o.created_at],
    [t('Payée', 'Paid'), o.paid_at],
    [t('Expédiée', 'Shipped'), o.fulfilled_at],
    ...(o.cancelled_at
      ? ([[t('Annulée', 'Cancelled'), o.cancelled_at]] as [string, string][])
      : []),
  ];

  return (
    <>
      <Link href="/app/commandes" className="text-link" style={{ marginBottom: 18 }}>
        <ArrowLeft size={13} /> Toutes les commandes
      </Link>
      <PageTitle
        eyebrow={`${t('Commande', 'Order')} · ${fmtWhen(o.created_at)}`}
        title={
          <>
            {o.number} <em>{o.customer.display_name}</em>
          </>
        }
        description={<Badge tone={b.tone}>{b.label}</Badge>}
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(o.status === 'pending_payment' || o.status === 'paid') && (
              <button type="button" className="button" onClick={() => setCancelling(true)}>
                {t('Annuler', 'Cancel')}
              </button>
            )}
          </div>
        }
      />
      {o.attention && (
        <div className="banner alert" role="alert">
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <TriangleAlert size={16} />
            {o.attention === 'paid_twice'
              ? t(
                  'Cette commande a été payée deux fois. Renvoyez le second paiement au client depuis votre portefeuille.',
                  'This order was paid twice. Send the second payment back to the customer from your wallet.',
                )
              : t(
                  'Payée alors que le stock était parti. Remboursez le client depuis votre portefeuille, ou réapprovisionnez.',
                  'Paid after the stock was gone. Refund the customer from your wallet, or restock.',
                )}
          </span>
        </div>
      )}
      {o.status === 'paid' && (
        <section className="panel" style={{ marginBottom: 24 }}>
          <PanelHead
            title={t('À expédier', 'To ship')}
            sub={t(
              'Le client est prévenu dès que vous marquez la commande expédiée.',
              'The customer is told as soon as you mark the order shipped.',
            )}
          />
          <form
            className="chat-compose"
            style={{ borderTop: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              mutate(
                `/orders/${o.id}/fulfill`,
                { method: 'PATCH', body: note.trim() ? { note: note.trim() } : {} },
                t(`Commande ${o.number} marquée expédiée.`, `Order ${o.number} marked shipped.`),
              ).catch(() => {});
            }}
          >
            <input
              aria-label={t('Note pour le client (facultatif)', 'Note for the customer (optional)')}
              placeholder={t(
                'Note pour le client, facultatif : « Livreur en route, arrivée vers 16 h »',
                'Note for the customer, optional: “Courier on the way, there around 4 pm”',
              )}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="submit" className="button olive">
              <Truck size={14} /> {t('Marquer expédiée', 'Mark shipped')}
            </button>
          </form>
        </section>
      )}
      <div className="wallet-page-grid">
        <section className="panel">
          <PanelHead
            title={t('Articles', 'Items')}
            sub={`${o.items.reduce((n, i) => n + i.quantity, 0)} article(s)`}
          />
          <div className="info-list">
            {o.items.map((i) => (
              <InfoRow
                key={`${i.title}-${JSON.stringify(i.options)}`}
                label={
                  <>
                    {i.quantity} × {i.title}
                    {formatOptions(i.options) ? ` · ${formatOptions(i.options)}` : ''}
                  </>
                }
                value={fmtXof(i.unit_price.amount * i.quantity)}
              />
            ))}
            <InfoRow label={t('Sous-total', 'Subtotal')} value={fmtXof(o.subtotal.amount)} />
            <InfoRow
              label={t('Livraison', 'Delivery')}
              value={o.delivery_fee.amount ? fmtXof(o.delivery_fee.amount) : t('Offerte', 'Free')}
            />
            {o.discount.amount > 0 && (
              <InfoRow label={t('Remise', 'Discount')} value={`− ${fmtXof(o.discount.amount)}`} />
            )}
            <InfoRow
              label="Total"
              value={
                <>
                  {fmtXof(o.total.amount)}{' '}
                  <span className="table-secondary">· {fmtSats(o.total_sat)}</span>
                </>
              }
            />
          </div>
        </section>
        <section className="panel">
          <PanelHead
            title={t('Client', 'Customer')}
            sub={
              o.channel === 'web'
                ? t('Commande passée sur votre boutique', 'Ordered in your shop')
                : `Via ${o.channel}`
            }
          />
          <div className="info-list">
            <InfoRow label={t('Nom', 'Name')} value={o.customer.display_name} />
            <InfoRow
              label={t('Téléphone', 'Phone')}
              value={
                o.customer.phone_e164 ? (
                  <a href={`tel:${o.customer.phone_e164}`}>{o.customer.phone_e164}</a>
                ) : (
                  '—'
                )
              }
            />
            <InfoRow
              label={t('Mode', 'Method')}
              value={
                o.delivery.method === 'pickup'
                  ? t('Retrait en boutique', 'Pickup at the shop')
                  : t('Livraison', 'Delivery')
              }
            />
            {o.delivery.address_text && (
              <InfoRow label={t('Adresse', 'Address')} value={o.delivery.address_text} />
            )}
            {o.delivery.note && <InfoRow label={t('Note', 'Note')} value={o.delivery.note} />}
            {o.conversation_id && (
              <InfoRow
                label={t('Discussion', 'Chat')}
                value={
                  <Link className="text-link" href={`/app/discussions/${o.conversation_id}`}>
                    <MessageCircle size={12} /> {t('Ouvrir', 'Open')}
                  </Link>
                }
              />
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHead title={t('Suivi', 'Progress')} sub={ORDER_STATUS[o.status].label} />
          <div className="info-list">
            {steps.map(([label, at]) => (
              <InfoRow
                key={label}
                label={label}
                value={
                  at
                    ? `${fmtLongDate(at)}, ${fmtTime(at)}`
                    : o.status === 'pending_payment' && label === t('Payée', 'Paid')
                      ? `Avant ${fmtTime(o.expires_at)}`
                      : '—'
                }
              />
            ))}
            {o.cancel_reason && <InfoRow label={t('Raison', 'Reason')} value={o.cancel_reason} />}
          </div>
        </section>
        <section className="panel">
          <PanelHead
            title={t('Paiement', 'Payment')}
            sub={t(
              'Lightning, directement dans votre portefeuille',
              'Lightning, straight into your wallet',
            )}
          />
          <div
            style={{ padding: '18px 22px', fontSize: 13, lineHeight: 1.65, color: 'var(--ink-70)' }}
          >
            {o.paid_at
              ? t(
                  `${fmtInt(o.total_sat)} sats reçus le ${fmtLongDate(o.paid_at)}. Pour vérifier ou rembourser, utilisez votre portefeuille : Selly ne déclenche ni remboursement ni transfert.`,
                  `${fmtInt(o.total_sat)} sats received on ${fmtLongDate(o.paid_at)}. To check or refund, use your wallet: Selly makes no refunds or transfers.`,
                )
              : o.status === 'pending_payment'
                ? t(
                    'Le client n’a pas encore payé. La facture expire après 20 minutes et le stock réservé est alors libéré.',
                    'The customer has not paid yet. The invoice expires after 20 minutes, and the held stock is then released.',
                  )
                : t(
                    'Aucun paiement reçu pour cette commande.',
                    'No payment received for this order.',
                  )}
          </div>
        </section>
      </div>
      {cancelling && <CancelModal order={o} onClose={() => setCancelling(false)} />}
    </>
  );
}
