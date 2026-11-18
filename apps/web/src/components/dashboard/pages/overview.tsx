'use client';

// Accueil: four summary cards, the sales chart and wallet block, then what needs the vendor (recent orders,
// things to do) and the stock to watch. Everything comes from core; nothing here is a fixed figure.

import Link from 'next/link';
import { useState } from 'react';
import { useDashboard, useResource } from '../data';
import {
  daysUntil,
  fmtAgo,
  fmtInt,
  fmtSats,
  fmtToday,
  fmtXof,
  formatOptions,
  itemsLine,
  orderBadge,
} from '../format';
import {
  ArrowRight,
  ArrowUpRight,
  Hand,
  type IconComponent,
  ImagePlus,
  MessageCircle,
  Package,
  ShoppingBag,
  TriangleAlert,
  Truck,
  Wallet as WalletIcon,
  Zap,
} from '../icons';
import { SalesChart } from '../sales-chart';
import type {
  BtcXofRate,
  ConversationSummary,
  DashboardMetrics,
  DashboardPeriod,
  Draft,
  Page,
  SubscriptionView,
  VendorOrder,
  VendorProduct,
  Wallet,
} from '../types';
import { Badge, Empty, PanelHead, Stat } from '../ui';

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: 'year', label: 'Cette année' },
];

export function Overview() {
  const { vendor, mutate } = useDashboard();
  const [period, setPeriod] = useState<DashboardPeriod>('7d');
  const month = useResource<DashboardMetrics>('/vendors/dashboard/metrics?period=30d');
  const chart = useResource<DashboardMetrics>(`/vendors/dashboard/metrics?period=${period}`);
  const orders = useResource<Page<VendorOrder>>('/orders');
  const toShip = useResource<Page<VendorOrder>>('/orders?status=paid');
  const unpaid = useResource<Page<VendorOrder>>('/orders?status=pending_payment');
  const chats = useResource<Page<ConversationSummary>>('/conversations');
  const drafts = useResource<Page<Draft>>('/inventory/drafts?status=needs_review');
  const products = useResource<Page<VendorProduct>>('/inventory');
  const wallet = useResource<Wallet>('/vendors/me/wallet');
  const rate = useResource<BtcXofRate>('/rates/btc-xof');
  const sub = useResource<SubscriptionView>('/vendors/me/subscription');

  const firstName = vendor?.display_name ?? '';
  const shipCount = toShip.data?.data.length;
  const waiting = (chats.data?.data ?? []).filter((c) => c.mode === 'human');
  const unread = (chats.data?.data ?? []).filter((c) => c.unread_count > 0 && c.mode !== 'human');
  const active = (products.data?.data ?? []).filter((p) => p.status === 'active');
  const available = active.reduce((n, p) => n + p.variants.reduce((m, v) => m + v.available, 0), 0);
  const revenue = month.data?.revenue.xof;
  const previous = month.data?.revenue_previous.xof ?? 0;
  const trend =
    revenue !== undefined && previous > 0 ? ((revenue - previous) / previous) * 100 : null;

  const attention: {
    icon: IconComponent;
    title: string;
    text: string;
    when: string;
    href: string;
    cta: string;
  }[] = [];
  for (const c of waiting)
    attention.push({
      icon: Hand,
      title: `${c.customer_label} attend votre réponse`,
      text: c.last_message.text ?? 'L’assistant vous a passé la main.',
      when: fmtAgo(c.last_message.created_at),
      href: `/app/discussions/${c.id}`,
      cta: 'Répondre',
    });
  for (const o of orders.data?.data ?? [])
    if (o.attention)
      attention.push({
        icon: TriangleAlert,
        title: `Commande ${o.number} : à rembourser`,
        text:
          o.attention === 'paid_twice'
            ? 'Payée deux fois. Remboursez le second paiement depuis votre portefeuille.'
            : 'Payée alors que le stock était parti. Remboursez le client depuis votre portefeuille.',
        when: fmtAgo(o.paid_at ?? o.created_at),
        href: `/app/commandes/${o.id}`,
        cta: 'Voir',
      });
  if (drafts.data?.data.length)
    attention.push({
      icon: ImagePlus,
      title: `${drafts.data.data.length} produit${drafts.data.data.length > 1 ? 's' : ''} à vérifier`,
      text: 'Confirmés par vous, ils rejoignent le catalogue.',
      when: 'Brouillons photo',
      href: '/app/brouillons',
      cta: 'Vérifier',
    });
  if (wallet.data?.status === 'degraded')
    attention.push({
      icon: WalletIcon,
      title: 'Votre portefeuille ne répond plus',
      text: 'Les clients ne peuvent pas payer tant qu’il ne répond pas.',
      when: wallet.data.last_error ?? fmtAgo(wallet.data.checked_at),
      href: '/app/portefeuille',
      cta: 'Vérifier',
    });
  const s = sub.data?.subscription;
  if (s) {
    const end = s.status === 'grace' && s.grace_ends_at ? s.grace_ends_at : s.current_period_end;
    const left = daysUntil(end);
    if (s.status === 'grace' || s.status === 'suspended' || left <= 7)
      attention.push({
        icon: Zap,
        title:
          s.status === 'suspended'
            ? 'Abonnement suspendu'
            : s.status === 'grace'
              ? 'Abonnement expiré : période de grâce'
              : `${s.trial ? 'Votre essai' : 'Votre formule'} se termine dans ${left} jour${left > 1 ? 's' : ''}`,
        text:
          s.status === 'suspended'
            ? 'La boutique est fermée et son lien ne s’ouvre plus. Choisissez une formule pour la rouvrir.'
            : 'Le renouvellement n’est jamais automatique : réglez une facture quand vous voulez.',
        when: `${sub.data?.plan?.name ?? ''} · renouvellement manuel`,
        href: '/app/abonnement',
        cta: 'Renouveler',
      });
  }
  for (const c of unread.slice(0, 2))
    attention.push({
      icon: MessageCircle,
      title: `Nouveau message de ${c.customer_label}`,
      text: c.last_message.text ?? '',
      when: fmtAgo(c.last_message.created_at),
      href: `/app/discussions/${c.id}`,
      cta: 'Voir',
    });

  const stock = active
    .flatMap((p) => p.variants.map((v) => ({ p, v })))
    .sort((a, b) => a.v.available - b.v.available)
    .slice(0, 5);
  const recent = (orders.data?.data ?? []).slice(0, 4);
  const balance = wallet.data?.balance_sat ?? null;

  return (
    <>
      <div className="welcome">
        <div>
          <div className="eyebrow">{fmtToday()} · Dakar</div>
          <h1>
            Bonjour{firstName ? ', ' : ''}
            {firstName && <em>{firstName}</em>}.
          </h1>
          <p>
            {shipCount
              ? `${shipCount} commande${shipCount > 1 ? 's' : ''} payée${shipCount > 1 ? 's' : ''} à expédier. Voici ce qui mérite votre attention.`
              : 'Votre boutique tourne. Voici ce qui mérite votre attention.'}
          </p>
        </div>
        <Link href="/app/brouillons?photo=1" className="button primary">
          <ImagePlus size={15} /> Ajouter depuis une photo
        </Link>
      </div>

      <div className="stats">
        <Stat
          label="Commandes à expédier"
          value={shipCount ?? '—'}
          icon={ShoppingBag}
          note={
            <>
              <b>{unpaid.data?.data.length ?? 0}</b> en attente de paiement
            </>
          }
        />
        <Stat
          label="Ventes · 30 jours"
          value={revenue !== undefined ? fmtInt(revenue) : '—'}
          unit="FCFA"
          icon={ArrowUpRight}
          note={
            trend === null ? (
              <>{month.data ? fmtSats(month.data.revenue.sat) : ' '}</>
            ) : (
              <>
                <b className={trend < 0 ? 'down' : ''}>
                  {trend >= 0 ? '+' : ''}
                  {trend.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %
                </b>{' '}
                vs les 30 jours d’avant
              </>
            )
          }
        />
        <Stat
          label="Discussions en attente"
          value={chats.data ? waiting.length : '—'}
          icon={MessageCircle}
          note={
            <>
              {unread.length} non lue{unread.length > 1 ? 's' : ''} avec l’assistant
            </>
          }
        />
        <Stat
          label="Articles disponibles"
          value={products.data ? fmtInt(available) : '—'}
          icon={Package}
          note={
            <>
              sur {active.length} produit{active.length > 1 ? 's' : ''} en ligne
            </>
          }
        />
      </div>

      <section className="content-grid">
        <div className="panel">
          <PanelHead
            title="Activité des ventes"
            sub="Évolution de vos ventes payées"
            action={
              <select
                className="period"
                aria-label="Période"
                value={period}
                onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            }
          />
          <div className="chart-wrap">
            <div className="chart-total">
              <div>
                <b>{chart.data ? fmtXof(chart.data.revenue.xof) : '—'}</b>
                <span>Ventes payées</span>
              </div>
              <div>
                <b>
                  {chart.data ? fmtInt(chart.data.series.reduce((n, p) => n + p.orders, 0)) : '—'}
                </b>
                <span>Commandes</span>
              </div>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-dot" />
                Ventes (FCFA)
              </span>
              <span>
                <i className="legend-dot sats" />
                Commandes
              </span>
            </div>
            {chart.data ? (
              <SalesChart metrics={chart.data} />
            ) : (
              <div className="chart-empty skeleton" aria-busy="true" />
            )}
          </div>
        </div>

        <div className="panel wallet-panel">
          <PanelHead
            title="Mon portefeuille"
            sub={wallet.data ? 'Votre wallet Lightning connecté' : 'Aucun portefeuille lié'}
            action={
              <Link
                href="/app/portefeuille"
                className="row-action"
                aria-label="Détails du portefeuille"
              >
                <ArrowUpRight size={16} />
              </Link>
            }
          />
          <div className="wallet-inner">
            <div className="wallet-label">Solde disponible</div>
            <div className="wallet-balance">
              {balance !== null ? fmtInt(balance) : '—'} <small>sats</small>
            </div>
            <div className="wallet-xof">
              {balance !== null && rate.data
                ? `≈ ${fmtXof(Math.round(balance * rate.data.xof_per_sat))} · estimation`
                : wallet.data
                  ? 'Solde non communiqué par ce portefeuille'
                  : 'Liez un portefeuille pour recevoir les paiements'}
            </div>
            <div
              className={`wallet-status ${!wallet.data ? 'off' : wallet.data.status !== 'active' ? 'degraded' : ''}`}
            >
              <i className="status-dot" />
              {!wallet.data
                ? 'Non connecté'
                : wallet.data.status === 'active'
                  ? 'Connecté · Réception activée'
                  : 'Ne répond plus'}
            </div>
            <div className="wallet-detail">
              <span>
                Ventes encaissées · {PERIODS.find((p) => p.value === period)?.label.toLowerCase()}
              </span>
              <b>{chart.data ? `+ ${fmtXof(chart.data.revenue.xof)}` : '—'}</b>
            </div>
            <div className="wallet-detail">
              <span>Mode de réception</span>
              <b>
                {wallet.data?.kind === 'lightning_address'
                  ? 'Adresse Lightning'
                  : 'Lightning (NWC)'}
              </b>
            </div>
          </div>
          <div className="wallet-note">
            Les paiements clients arrivent directement dans votre portefeuille. Selly ne détient pas
            vos fonds.
          </div>
        </div>
      </section>

      <div className="overview-grid">
        <section className="panel">
          <PanelHead
            title="À ne pas laisser passer"
            sub="Vos commandes récentes"
            action={
              <Link href="/app/commandes" className="text-link">
                Toutes les commandes <ArrowRight size={13} />
              </Link>
            }
          />
          {recent.length === 0 ? (
            <Empty
              icon={ShoppingBag}
              title="Pas encore de commande"
              text="Partagez le lien de votre boutique : l’assistant prend les commandes pour vous."
            />
          ) : (
            <div className="order-list">
              {recent.map((o) => {
                const b = orderBadge(o);
                return (
                  <div className="order-row" key={o.id}>
                    <div>
                      <Link href={`/app/commandes/${o.id}`} className="order-code">
                        {o.number}
                      </Link>
                      <div className="order-time">{fmtAgo(o.created_at)}</div>
                    </div>
                    <div className="order-person">
                      <div className="order-customer">{o.customer.display_name}</div>
                      <div className="order-product">{itemsLine(o)}</div>
                    </div>
                    <div className="order-state">
                      <Badge tone={b.tone}>{b.label}</Badge>
                    </div>
                    <div className="money">
                      {fmtInt(o.total.amount)}
                      <span className="unit">{o.total.currency === 'SAT' ? 'sats' : 'FCFA'}</span>
                      {o.status === 'paid' && !o.attention && (
                        <button
                          type="button"
                          className="text-link"
                          style={{ display: 'flex', marginLeft: 'auto', marginTop: 4 }}
                          onClick={() =>
                            mutate(
                              `/orders/${o.id}/fulfill`,
                              { method: 'PATCH', body: {} },
                              `Commande ${o.number} marquée expédiée.`,
                            ).catch(() => {})
                          }
                        >
                          <Truck size={12} /> Expédiée
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <PanelHead
            title="À votre attention"
            sub="Un petit point sur la boutique"
            action={
              attention.length > 0 ? (
                <Badge tone="pending">
                  {attention.length} chose{attention.length > 1 ? 's' : ''}
                </Badge>
              ) : undefined
            }
          />
          <div className="activity">
            {attention.length === 0 ? (
              <p className="activity-empty">Rien ne vous attend. L’assistant s’occupe du reste.</p>
            ) : (
              attention.slice(0, 5).map((a) => (
                <div className="activity-item" key={a.title + a.href}>
                  <div className="activity-icon">
                    <a.icon size={15} />
                  </div>
                  <div className="activity-copy">
                    <b>{a.title}</b>
                    <br />
                    {a.text}
                    <div className="activity-time">{a.when}</div>
                  </div>
                  <Link className="text-link" href={a.href}>
                    {a.cta}
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="lower-grid" style={{ gridTemplateColumns: '1fr' }}>
        <section className="panel">
          <PanelHead
            title="Stock à surveiller"
            sub="Les articles les plus bas : disponibles, et déjà réservés par des commandes en attente"
            action={
              <Link href="/app/catalogue" className="text-link">
                Gérer le stock <ArrowRight size={13} />
              </Link>
            }
          />
          {stock.length === 0 ? (
            <Empty
              icon={Package}
              title="Catalogue vide"
              text="Ajoutez un produit pour suivre son stock ici."
            />
          ) : (
            <div className="stock-list">
              {stock.map(({ p, v }) => {
                const opts = formatOptions(v.options);
                return (
                  <div className="stock-line" key={v.id}>
                    <div>
                      <b>{p.title}</b>
                      <small>{opts || 'Article unique'}</small>
                    </div>
                    <div className={`stock-number ${v.available <= 3 ? 'low' : ''}`}>
                      {v.available} disponible{v.available > 1 ? 's' : ''}
                      <em>
                        {v.reserved} réservé{v.reserved > 1 ? 's' : ''}
                      </em>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
