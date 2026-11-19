'use client';

// Accueil: four summary cards, the sales chart and wallet block, then what needs the vendor (recent orders,
// things to do) and the stock to watch. Everything comes from core; nothing here is a fixed figure.

import Link from 'next/link';
import { useState } from 'react';
import { useLang, useT } from '../../lang';
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
import { openSelly } from '../selly-assistant';
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

const PERIODS: { value: DashboardPeriod; label: [fr: string, en: string] }[] = [
  { value: '7d', label: ['7 derniers jours', 'Last 7 days'] },
  { value: '30d', label: ['30 derniers jours', 'Last 30 days'] },
  { value: 'year', label: ['Cette année', 'This year'] },
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

  const t = useT();
  const lang = useLang();
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
      title: t(
        `${c.customer_label} attend votre réponse`,
        `${c.customer_label} is waiting for you`,
      ),
      text:
        c.last_message.text ??
        t('L’assistant vous a passé la main.', 'The assistant handed over to you.'),
      when: fmtAgo(c.last_message.created_at),
      href: `/app/discussions/${c.id}`,
      cta: t('Répondre', 'Reply'),
    });
  for (const o of orders.data?.data ?? [])
    if (o.attention)
      attention.push({
        icon: TriangleAlert,
        title: t(`Commande ${o.number} : à rembourser`, `Order ${o.number}: to refund`),
        text:
          o.attention === 'paid_twice'
            ? t(
                'Payée deux fois. Remboursez le second paiement depuis votre portefeuille.',
                'Paid twice. Refund the second payment from your wallet.',
              )
            : t(
                'Payée alors que le stock était parti. Remboursez le client depuis votre portefeuille.',
                'Paid after the stock was gone. Refund the customer from your wallet.',
              ),
        when: fmtAgo(o.paid_at ?? o.created_at),
        href: `/app/commandes/${o.id}`,
        cta: t('Voir', 'See'),
      });
  if (drafts.data?.data.length)
    attention.push({
      icon: ImagePlus,
      title: t(
        `${drafts.data.data.length} produit${drafts.data.data.length > 1 ? 's' : ''} à vérifier`,
        `${drafts.data.data.length} product${drafts.data.data.length > 1 ? 's' : ''} to check`,
      ),
      text: t(
        'Confirmés par vous, ils rejoignent le catalogue.',
        'Once you confirm them, they join the catalogue.',
      ),
      when: t('Brouillons photo', 'Photo drafts'),
      href: '/app/catalogue#brouillons',
      cta: t('Vérifier', 'Check'),
    });
  if (wallet.data?.status === 'degraded')
    attention.push({
      icon: WalletIcon,
      title: t('Votre portefeuille ne répond plus', 'Your wallet is not answering'),
      text: t(
        'Les clients ne peuvent pas payer tant qu’il ne répond pas.',
        'Customers cannot pay until it answers.',
      ),
      when: wallet.data.last_error ?? fmtAgo(wallet.data.checked_at),
      href: '/app/portefeuille',
      cta: t('Vérifier', 'Check'),
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
            ? t('Abonnement suspendu', 'Subscription suspended')
            : s.status === 'grace'
              ? t('Abonnement expiré : période de grâce', 'Subscription expired: grace period')
              : t(
                  `${s.trial ? 'Votre essai' : 'Votre formule'} se termine dans ${left} jour${left > 1 ? 's' : ''}`,
                  `${s.trial ? 'Your trial' : 'Your plan'} ends in ${left} day${left > 1 ? 's' : ''}`,
                ),
        text:
          s.status === 'suspended'
            ? t(
                'La boutique est fermée et son lien ne s’ouvre plus. Choisissez une formule pour la rouvrir.',
                'The shop is closed and its link no longer opens. Choose a plan to reopen it.',
              )
            : t(
                'Le renouvellement n’est jamais automatique : réglez une facture quand vous voulez.',
                'Renewal is never automatic: pay an invoice whenever you like.',
              ),
        when: `${sub.data?.plan?.name ?? ''} · ${t('renouvellement manuel', 'manual renewal')}`,
        href: '/app/abonnement',
        cta: t('Renouveler', 'Renew'),
      });
  }
  for (const c of unread.slice(0, 2))
    attention.push({
      icon: MessageCircle,
      title: t(`Nouveau message de ${c.customer_label}`, `New message from ${c.customer_label}`),
      text: c.last_message.text ?? '',
      when: fmtAgo(c.last_message.created_at),
      href: `/app/discussions/${c.id}`,
      cta: t('Voir', 'See'),
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
            {t('Bonjour', 'Hello')}
            {firstName ? ', ' : ''}
            {firstName && <em>{firstName}</em>}.
          </h1>
          <p>
            {shipCount
              ? t(
                  `${shipCount} commande${shipCount > 1 ? 's' : ''} payée${shipCount > 1 ? 's' : ''} à expédier. Voici ce qui mérite votre attention.`,
                  `${shipCount} paid order${shipCount > 1 ? 's' : ''} to ship. Here is what needs your attention.`,
                )
              : t(
                  'Votre boutique tourne. Voici ce qui mérite votre attention.',
                  'Your shop is running. Here is what needs your attention.',
                )}
          </p>
        </div>
        <button type="button" className="button primary" onClick={() => openSelly({ photo: true })}>
          <ImagePlus size={15} /> {t('Ajouter depuis une photo', 'Add from a photo')}
        </button>
      </div>

      <div className="stats">
        <Stat
          label={t('Commandes à expédier', 'Orders to ship')}
          value={shipCount ?? '—'}
          icon={ShoppingBag}
          note={
            <>
              <b>{unpaid.data?.data.length ?? 0}</b>{' '}
              {t('en attente de paiement', 'awaiting payment')}
            </>
          }
        />
        <Stat
          label={t('Ventes · 30 jours', 'Sales · 30 days')}
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
                  {trend.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', {
                    maximumFractionDigits: 1,
                  })}{' '}
                  %
                </b>{' '}
                {t('vs les 30 jours d’avant', 'vs the previous 30 days')}
              </>
            )
          }
        />
        <Stat
          label={t('Discussions en attente', 'Chats waiting')}
          value={chats.data ? waiting.length : '—'}
          icon={MessageCircle}
          note={
            <>
              {unread.length}{' '}
              {t(
                `non lue${unread.length > 1 ? 's' : ''} avec l’assistant`,
                'unread with the assistant',
              )}
            </>
          }
        />
        <Stat
          label={t('Articles disponibles', 'Items available')}
          value={products.data ? fmtInt(available) : '—'}
          icon={Package}
          note={
            <>
              {t(
                `sur ${active.length} produit${active.length > 1 ? 's' : ''} en ligne`,
                `across ${active.length} product${active.length > 1 ? 's' : ''} online`,
              )}
            </>
          }
        />
      </div>

      <section className="content-grid">
        <div className="panel">
          <PanelHead
            title={t('Activité des ventes', 'Sales activity')}
            sub={t('Évolution de vos ventes payées', 'How your paid sales are going')}
            action={
              <select
                className="period"
                aria-label={t('Période', 'Period')}
                value={period}
                onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(...p.label)}
                  </option>
                ))}
              </select>
            }
          />
          <div className="chart-wrap">
            <div className="chart-total">
              <div>
                <b>{chart.data ? fmtXof(chart.data.revenue.xof) : '—'}</b>
                <span>{t('Ventes payées', 'Paid sales')}</span>
              </div>
              <div>
                <b>
                  {chart.data ? fmtInt(chart.data.series.reduce((n, p) => n + p.orders, 0)) : '—'}
                </b>
                <span>{t('Commandes', 'Orders')}</span>
              </div>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-dot" />
                {t('Ventes (FCFA)', 'Sales (FCFA)')}
              </span>
              <span>
                <i className="legend-dot sats" />
                {t('Commandes', 'Orders')}
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
            title={t('Mon portefeuille', 'My wallet')}
            sub={
              wallet.data
                ? t('Votre wallet Lightning connecté', 'Your connected Lightning wallet')
                : t('Aucun portefeuille lié', 'No wallet linked')
            }
            action={
              <Link
                href="/app/portefeuille"
                className="row-action"
                aria-label={t('Détails du portefeuille', 'Wallet details')}
              >
                <ArrowUpRight size={16} />
              </Link>
            }
          />
          <div className="wallet-inner">
            <div className="wallet-label">{t('Solde disponible', 'Available balance')}</div>
            <div className="wallet-balance">
              {balance !== null ? fmtInt(balance) : '—'} <small>sats</small>
            </div>
            <div className="wallet-xof">
              {balance !== null && rate.data
                ? `≈ ${fmtXof(Math.round(balance * rate.data.xof_per_sat))} · ${t('estimation', 'estimate')}`
                : wallet.data
                  ? t(
                      'Solde non communiqué par ce portefeuille',
                      'This wallet does not share its balance',
                    )
                  : t(
                      'Liez un portefeuille pour recevoir les paiements',
                      'Link a wallet to receive payments',
                    )}
            </div>
            <div
              className={`wallet-status ${!wallet.data ? 'off' : wallet.data.status !== 'active' ? 'degraded' : ''}`}
            >
              <i className="status-dot" />
              {!wallet.data
                ? t('Non connecté', 'Not connected')
                : wallet.data.status === 'active'
                  ? t('Connecté · Réception activée', 'Connected · Receiving on')
                  : t('Ne répond plus', 'Not answering')}
            </div>
            <div className="wallet-detail">
              <span>
                {t('Ventes encaissées', 'Sales received')} ·{' '}
                {t(...(PERIODS.find((p) => p.value === period)?.label ?? ['', ''])).toLowerCase()}
              </span>
              <b>{chart.data ? `+ ${fmtXof(chart.data.revenue.xof)}` : '—'}</b>
            </div>
            <div className="wallet-detail">
              <span>{t('Mode de réception', 'Receiving with')}</span>
              <b>
                {wallet.data?.kind === 'lightning_address'
                  ? t('Adresse Lightning', 'Lightning address')
                  : 'Lightning (NWC)'}
              </b>
            </div>
          </div>
          <div className="wallet-note">
            {t(
              'Les paiements clients arrivent directement dans votre portefeuille. Selly ne détient pas vos fonds.',
              'Customer payments land straight in your wallet. Selly never holds your funds.',
            )}
          </div>
        </div>
      </section>

      <div className="overview-grid">
        <section className="panel">
          <PanelHead
            title={t('À ne pas laisser passer', 'Don’t miss these')}
            sub={t('Vos commandes récentes', 'Your recent orders')}
            action={
              <Link href="/app/commandes" className="text-link">
                {t('Toutes les commandes', 'All orders')} <ArrowRight size={13} />
              </Link>
            }
          />
          {recent.length === 0 ? (
            <Empty
              icon={ShoppingBag}
              title={t('Pas encore de commande', 'No orders yet')}
              text={t(
                'Partagez le lien de votre boutique : l’assistant prend les commandes pour vous.',
                'Share your shop link: the assistant takes the orders for you.',
              )}
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
                              t(
                                `Commande ${o.number} marquée expédiée.`,
                                `Order ${o.number} marked shipped.`,
                              ),
                            ).catch(() => {})
                          }
                        >
                          <Truck size={12} /> {t('Expédiée', 'Shipped')}
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
            title={t('À votre attention', 'For your attention')}
            sub={t('Un petit point sur la boutique', 'A quick look at the shop')}
            action={
              attention.length > 0 ? (
                <Badge tone="pending">
                  {attention.length}{' '}
                  {t(
                    `chose${attention.length > 1 ? 's' : ''}`,
                    `thing${attention.length > 1 ? 's' : ''}`,
                  )}
                </Badge>
              ) : undefined
            }
          />
          <div className="activity">
            {attention.length === 0 ? (
              <p className="activity-empty">
                {t(
                  'Rien ne vous attend. L’assistant s’occupe du reste.',
                  'Nothing is waiting. The assistant takes care of the rest.',
                )}
              </p>
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
            title={t('Stock à surveiller', 'Stock to watch')}
            sub={t(
              'Les articles les plus bas : disponibles, et déjà réservés par des commandes en attente',
              'The lowest items: available, and already held by pending orders',
            )}
            action={
              <Link href="/app/catalogue" className="text-link">
                {t('Gérer le stock', 'Manage the stock')} <ArrowRight size={13} />
              </Link>
            }
          />
          {stock.length === 0 ? (
            <Empty
              icon={Package}
              title={t('Catalogue vide', 'Empty catalogue')}
              text={t(
                'Ajoutez un produit pour suivre son stock ici.',
                'Add a product to follow its stock here.',
              )}
            />
          ) : (
            <div className="stock-list">
              {stock.map(({ p, v }) => {
                const opts = formatOptions(v.options);
                return (
                  <div className="stock-line" key={v.id}>
                    <div>
                      <b>{p.title}</b>
                      <small>{opts || t('Article unique', 'Single item')}</small>
                    </div>
                    <div className={`stock-number ${v.available <= 3 ? 'low' : ''}`}>
                      {v.available} {t(`disponible${v.available > 1 ? 's' : ''}`, 'available')}
                      <em>
                        {v.reserved} {t(`réservé${v.reserved > 1 ? 's' : ''}`, 'held')}
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
