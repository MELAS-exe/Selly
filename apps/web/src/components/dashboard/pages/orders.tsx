'use client';

// Commandes. The vendor does not confirm an order: the customer pays it (architecture.md 4.4). What the vendor
// does is ship a paid order, or cancel one, with a refund arranged outside Selly when it was paid.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
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

const FILTERS: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: 'Tous les statuts' },
  { value: 'paid', label: 'À expédier' },
  { value: 'pending_payment', label: 'En attente de paiement' },
  { value: 'fulfilled', label: 'Expédiées' },
  { value: 'expired', label: 'Expirées' },
  { value: 'cancelled', label: 'Annulées' },
];

const money = (o: VendorOrder) =>
  o.total.currency === 'SAT' ? fmtSats(o.total.amount) : fmtXof(o.total.amount);

export function Orders() {
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
        eyebrow="Ventes · votre boutique"
        title="Commandes"
        description="Chaque paiement client va directement dans votre portefeuille Lightning. Expédiez les commandes payées."
      />
      <div className="toolbar">
        <label className="search-wrap">
          <Search size={15} />
          <input
            aria-label="Rechercher une commande"
            className="search"
            placeholder="Numéro, client, téléphone, article…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="select"
          aria-label="Filtrer les commandes"
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | OrderStatus)}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
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
                  <th>Commande</th>
                  <th>Client</th>
                  <th>Articles</th>
                  <th>État</th>
                  <th>Livraison</th>
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
                          ? 'Retrait'
                          : (o.delivery.address_text ?? 'Livraison')}
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
                                  `Commande ${o.number} marquée expédiée.`,
                                ).catch(() => {})
                              }
                            >
                              <Truck size={13} /> Expédiée
                            </button>
                          )}
                          {(o.status === 'pending_payment' || o.status === 'paid') && (
                            <button
                              type="button"
                              className="button small ghost"
                              aria-label={`Annuler la commande ${o.number}`}
                              title="Annuler"
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
                  orders.data.data.length ? 'Aucune commande trouvée' : 'Pas encore de commande'
                }
                text={
                  orders.data.data.length
                    ? 'Essayez un autre mot-clé ou statut.'
                    : 'Les commandes prises par l’assistant ou sur votre boutique arrivent ici.'
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
  return (
    <Modal title={`Annuler ${order.number}`} onClose={onClose}>
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
            ? 'Cette commande est payée. Selly ne peut pas rembourser : renvoyez les sats au client depuis votre portefeuille. Le stock n’est pas remis automatiquement.'
            : 'La commande et sa facture sont annulées, et le stock réservé est libéré.'}
        </p>
        <label className="form-label" htmlFor="cancel-reason">
          Raison, visible par le client
        </label>
        <input
          id="cancel-reason"
          className="form-control"
          required
          minLength={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex. Article en rupture"
        />
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Retour
          </button>
          <button
            type="submit"
            className="button danger"
            disabled={busy || reason.trim().length < 2}
          >
            Annuler la commande
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const { mutate } = useDashboard();
  const order = useResource<VendorOrder>(`/orders/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState('');

  if (order.error && !order.data) return <Failed error={order.error} retry={order.reload} />;
  const o = order.data;
  if (!o) return <Loading rows={5} />;
  const b = orderBadge(o);
  const steps: [string, string | null][] = [
    ['Commande créée', o.created_at],
    ['Payée', o.paid_at],
    ['Expédiée', o.fulfilled_at],
    ...(o.cancelled_at ? ([['Annulée', o.cancelled_at]] as [string, string][]) : []),
  ];

  return (
    <>
      <Link href="/app/commandes" className="text-link" style={{ marginBottom: 18 }}>
        <ArrowLeft size={13} /> Toutes les commandes
      </Link>
      <PageTitle
        eyebrow={`Commande · ${fmtWhen(o.created_at)}`}
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
                Annuler
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
              ? 'Cette commande a été payée deux fois. Renvoyez le second paiement au client depuis votre portefeuille.'
              : 'Payée alors que le stock était parti. Remboursez le client depuis votre portefeuille, ou réapprovisionnez.'}
          </span>
        </div>
      )}
      {o.status === 'paid' && (
        <section className="panel" style={{ marginBottom: 24 }}>
          <PanelHead
            title="À expédier"
            sub="Le client est prévenu dès que vous marquez la commande expédiée."
          />
          <form
            className="chat-compose"
            style={{ borderTop: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              mutate(
                `/orders/${o.id}/fulfill`,
                { method: 'PATCH', body: note.trim() ? { note: note.trim() } : {} },
                `Commande ${o.number} marquée expédiée.`,
              ).catch(() => {});
            }}
          >
            <input
              aria-label="Note pour le client (facultatif)"
              placeholder="Note pour le client, facultatif : « Livreur en route, arrivée vers 16 h »"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="submit" className="button olive">
              <Truck size={14} /> Marquer expédiée
            </button>
          </form>
        </section>
      )}
      <div className="wallet-page-grid">
        <section className="panel">
          <PanelHead
            title="Articles"
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
            <InfoRow label="Sous-total" value={fmtXof(o.subtotal.amount)} />
            <InfoRow
              label="Livraison"
              value={o.delivery_fee.amount ? fmtXof(o.delivery_fee.amount) : 'Offerte'}
            />
            {o.discount.amount > 0 && (
              <InfoRow label="Remise" value={`− ${fmtXof(o.discount.amount)}`} />
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
            title="Client"
            sub={o.channel === 'web' ? 'Commande passée sur votre boutique' : `Via ${o.channel}`}
          />
          <div className="info-list">
            <InfoRow label="Nom" value={o.customer.display_name} />
            <InfoRow
              label="Téléphone"
              value={
                o.customer.phone_e164 ? (
                  <a href={`tel:${o.customer.phone_e164}`}>{o.customer.phone_e164}</a>
                ) : (
                  '—'
                )
              }
            />
            <InfoRow
              label="Mode"
              value={o.delivery.method === 'pickup' ? 'Retrait en boutique' : 'Livraison'}
            />
            {o.delivery.address_text && <InfoRow label="Adresse" value={o.delivery.address_text} />}
            {o.delivery.note && <InfoRow label="Note" value={o.delivery.note} />}
            {o.conversation_id && (
              <InfoRow
                label="Discussion"
                value={
                  <Link className="text-link" href={`/app/discussions/${o.conversation_id}`}>
                    <MessageCircle size={12} /> Ouvrir
                  </Link>
                }
              />
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHead title="Suivi" sub={ORDER_STATUS[o.status].label} />
          <div className="info-list">
            {steps.map(([label, at]) => (
              <InfoRow
                key={label}
                label={label}
                value={
                  at
                    ? `${fmtLongDate(at)}, ${fmtTime(at)}`
                    : o.status === 'pending_payment' && label === 'Payée'
                      ? `Avant ${fmtTime(o.expires_at)}`
                      : '—'
                }
              />
            ))}
            {o.cancel_reason && <InfoRow label="Raison" value={o.cancel_reason} />}
          </div>
        </section>
        <section className="panel">
          <PanelHead title="Paiement" sub="Lightning, directement dans votre portefeuille" />
          <div
            style={{ padding: '18px 22px', fontSize: 13, lineHeight: 1.65, color: 'var(--ink-70)' }}
          >
            {o.paid_at
              ? `${fmtInt(o.total_sat)} sats reçus le ${fmtLongDate(o.paid_at)}. Pour vérifier ou rembourser, utilisez votre portefeuille : Selly ne déclenche ni remboursement ni transfert.`
              : o.status === 'pending_payment'
                ? 'Le client n’a pas encore payé. La facture expire après 20 minutes et le stock réservé est alors libéré.'
                : 'Aucun paiement reçu pour cette commande.'}
          </div>
        </section>
      </div>
      {cancelling && <CancelModal order={o} onClose={() => setCancelling(false)} />}
    </>
  );
}
