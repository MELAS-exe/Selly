'use client';

// The dashboard frame: the side bar (desktop), the top bar, the bottom bar (phone), the shop's status banner and
// the bell. Pages render inside. The routes are the ones core's alerts open (apps/web/AGENTS.md).

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { langOf, translator } from '@/lib/i18n';
import { LangProvider } from '../lang';
import { DashboardProvider, useDashboard, useResource } from './data';
import { fmtAgo, initials, setDashboardLang } from './format';
import {
  Bell,
  Bot,
  CircleHelp,
  type IconComponent,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Settings2,
  ShoppingBag,
  TriangleAlert,
  Wallet,
  X,
  Zap,
} from './icons';
import { PushOffer, registerServiceWorker } from './push';
import { SellyAssistant } from './selly-assistant';
import type { ConversationSummary, Draft, Page, VendorOrder } from './types';
import '../landing/landing.css';
import './dashboard.css';

interface NavItem {
  href: string;
  label: string;
  icon: IconComponent;
  count?: number;
}

const DEMO_KEY = 'selly-dashboard-demo';

/** Demo mode: ?demo on any dashboard URL (kept for the tab), or NEXT_PUBLIC_DASHBOARD_DEMO=1. */
function useDemo(): boolean | null {
  const params = useSearchParams();
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => {
    let on = process.env.NEXT_PUBLIC_DASHBOARD_DEMO === '1';
    try {
      if (params.has('demo'))
        sessionStorage.setItem(DEMO_KEY, params.get('demo') === '0' ? '0' : '1');
      on = on || sessionStorage.getItem(DEMO_KEY) === '1';
    } catch {}
    setDemo(on);
  }, [params]);
  return demo;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const demo = useDemo();
  if (demo === null) return <div className="selly-shell theme-paper-vermilion" />;
  return (
    <DashboardProvider demo={demo}>
      <Frame>{children}</Frame>
    </DashboardProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { vendor, demo, request, notes, clearNotes } = useDashboard();
  const toShip = useResource<Page<VendorOrder>>('/orders?status=paid');
  const chats = useResource<Page<ConversationSummary>>('/conversations');
  const drafts = useResource<Page<Draft>>('/inventory/drafts?status=needs_review');
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [seen, setSeen] = useState(0);

  // The vendor's language (lib/i18n.ts): for the format helpers, and for every page through LangProvider.
  const lang = langOf(vendor?.locale);
  setDashboardLang(lang);
  const t = translator(lang);
  const waiting = (chats.data?.data ?? []).filter((c) => c.mode === 'human' || c.unread_count > 0);
  const nav: NavItem[] = [
    { href: '/app', label: t('Accueil', 'Home'), icon: LayoutDashboard },
    {
      href: '/app/commandes',
      label: t('Commandes', 'Orders'),
      icon: ShoppingBag,
      count: toShip.data?.data.length,
    },
    {
      href: '/app/discussions',
      label: t('Discussions', 'Chats'),
      icon: MessageCircle,
      count: waiting.length,
    },
    // Drafts left to check (made outside a conversation with Selly) wait at the top of the catalogue.
    {
      href: '/app/catalogue',
      label: t('Catalogue', 'Catalogue'),
      icon: Package,
      count: drafts.data?.data.length,
    },
    { href: '/app/portefeuille', label: t('Portefeuille', 'Wallet'), icon: Wallet },
    { href: '/app/abonnement', label: t('Abonnement', 'Subscription'), icon: Zap },
  ];
  const settings: NavItem = {
    href: '/app/reglages',
    label: t('Réglages', 'Settings'),
    icon: Settings2,
  };
  const security: NavItem = {
    href: '/app/securite',
    label: t('Sécurité', 'Security'),
    icon: KeyRound,
  };
  const isActive = (href: string) =>
    href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);
  const current =
    [...nav, settings, security].find((n) => isActive(n.href))?.label ?? t('Accueil', 'Home');
  const unseen = notes.length - seen;

  useEffect(() => registerServiceWorker(), []);
  const paidLive = notes.some((n) => n.type === 'order.paid');

  // Close the menus on navigation.
  useEffect(() => {
    setMenuOpen(false);
    setBellOpen(false);
  }, [pathname]);

  // The notifications close on a tap or click anywhere else, and on Escape.
  const bell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bellOpen) return;
    const away = (e: PointerEvent) => {
      if (!bell.current?.contains(e.target as Node)) setBellOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setBellOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [bellOpen]);

  async function signOut() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {}
    try {
      sessionStorage.removeItem(DEMO_KEY);
    } catch {}
    router.replace('/app/login');
  }

  const name = vendor?.display_name ?? '…';
  const link = (item: NavItem, kind: 'side' | 'mobile' | 'sheet') => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${kind === 'mobile' ? 'mobile-nav-item' : 'nav-item'} ${active ? 'active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={kind === 'mobile' ? 18 : 16} />
        {/* The bottom bar shows icons only on a phone; the label stays for screen readers. */}
        <span className={kind === 'mobile' ? 'mobile-nav-label' : undefined}>{item.label}</span>
        {kind !== 'mobile' && item.count ? <span className="nav-count">{item.count}</span> : null}
        {kind === 'mobile' && item.count ? (
          <i className="dot" aria-label={`${item.count} en attente`} />
        ) : null}
      </Link>
    );
  };

  return (
    <LangProvider lang={lang}>
      <div className="selly-shell theme-paper-vermilion" lang={lang}>
        <aside className="side">
          <Link
            href="/app"
            className="brand"
            aria-label={t('Selly, accueil du tableau de bord', 'Selly, dashboard home')}
          >
            <img src="/brand/selly-wordmark-light.png" alt="Selly" />
          </Link>
          <div className="side-caption">{t('Votre boutique', 'Your shop')}</div>
          <nav className="nav-list" aria-label={t('Navigation principale', 'Main navigation')}>
            {nav.map((item) => link(item, 'side'))}
          </nav>
          <div className="side-spacer" />
          <div className="store-card">
            <small>{t('Mini-boutique', 'Mini-shop')}</small>
            <div className="store-name">{name}</div>
            {vendor && (
              <a className="store-url" href={vendor.store_url} target="_blank" rel="noreferrer">
                {vendor.store_url.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
          <Link
            href={settings.href}
            className={`nav-item settings ${isActive(settings.href) ? 'active' : ''}`}
          >
            <Settings2 size={16} /> {settings.label}
          </Link>
          <Link
            href={security.href}
            className={`nav-item settings ${isActive(security.href) ? 'active' : ''}`}
            style={{ borderTop: 0 }}
          >
            <KeyRound size={16} /> {security.label}
          </Link>
          <div className="profile">
            <div className="avatar">{initials(name)}</div>
            <div style={{ minWidth: 0 }}>
              <strong>{name}</strong>
              <span>
                {demo
                  ? t('Boutique de démonstration', 'Demo shop')
                  : vendor?.live
                    ? t('En ligne', 'Online')
                    : vendor?.live_blockers.includes('wallet_missing') &&
                        !vendor.live_blockers.some((b) => b.startsWith('subscription_'))
                      ? t('Non publiée', 'Not published')
                      : t('Hors ligne', 'Offline')}
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Se déconnecter', 'Sign out')}
              title={t('Se déconnecter', 'Sign out')}
              style={{ marginLeft: 'auto', color: 'inherit', borderColor: 'transparent' }}
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <img className="topbar-mark" src="/brand/selly-s.png" alt="Selly" />
              <div className="crumb">
                <b>{name}</b>
                <i>/</i>
                {current}
              </div>
            </div>
            <div className="top-actions">
              {demo && <span className="demo-chip">{t('Mode démo', 'Demo mode')}</span>}
              <div style={{ position: 'relative' }} ref={bell}>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    unseen > 0
                      ? t(`Notifications, ${unseen} nouvelles`, `Notifications, ${unseen} new`)
                      : 'Notifications'
                  }
                  aria-expanded={bellOpen}
                  onClick={() => {
                    setBellOpen((o) => !o);
                    setSeen(notes.length);
                  }}
                >
                  <Bell size={17} />
                  {unseen > 0 && <i className="notification-dot" />}
                </button>
                {bellOpen && (
                  <div className="popover" role="dialog" aria-label="Notifications">
                    <div className="popover-head">
                      <span>Notifications</span>
                      <span className="popover-head-actions">
                        {notes.length > 0 && (
                          <button type="button" className="text-link" onClick={clearNotes}>
                            {t('Effacer', 'Clear')}
                          </button>
                        )}
                        <button
                          type="button"
                          className="popover-close"
                          aria-label={t('Fermer les notifications', 'Close the notifications')}
                          onClick={() => setBellOpen(false)}
                        >
                          <X size={15} />
                        </button>
                      </span>
                    </div>
                    {notes.length === 0 ? (
                      <p className="popover-empty">
                        {t(
                          'Rien de neuf depuis l’ouverture du tableau de bord. Les commandes payées et les discussions qui vous attendent s’afficheront ici.',
                          'Nothing new since you opened the dashboard. Paid orders and chats waiting for you will show here.',
                        )}
                      </p>
                    ) : (
                      notes.map((n) =>
                        n.href ? (
                          <Link key={n.id} href={n.href} className="popover-item">
                            {n.text}
                            <small>{fmtAgo(n.at)}</small>
                          </Link>
                        ) : (
                          <div key={n.id} className="popover-item">
                            {n.text}
                            <small>{fmtAgo(n.at)}</small>
                          </div>
                        ),
                      )
                    )}
                  </div>
                )}
              </div>
              <a
                className="icon-button"
                aria-label={t(
                  'Aide : payer et recevoir en bitcoin',
                  'Help: paying and getting paid in bitcoin',
                )}
                title={t('Aide', 'Help')}
                href="/aide/payer-en-bitcoin"
                target="_blank"
                rel="noreferrer"
              >
                <CircleHelp size={17} />
              </a>
            </div>
          </header>
          <div className="content">
            <LiveBanner />
            <PushOffer trigger={paidLive && !demo} />
            {children}
          </div>
        </main>

        <Suspense fallback={null}>
          <SellyAssistant />
        </Suspense>

        <nav className="mobile-nav" aria-label={t('Navigation rapide', 'Quick navigation')}>
          {nav.slice(0, 4).map((item) => link(item, 'mobile'))}
          <button
            type="button"
            className={`mobile-nav-item ${menuOpen ? 'active' : ''}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
            <span className="mobile-nav-label">{t('Plus', 'More')}</span>
            {drafts.data?.data.length ? <i className="dot" /> : null}
          </button>
        </nav>
        {menuOpen && (
          <div className="sheet" role="dialog" aria-label={t('Plus', 'More')}>
            {[nav[4], nav[5], nav[6], nav[7], settings, security].map(
              (item) => item && link(item, 'sheet'),
            )}
            <button type="button" className="nav-item" onClick={signOut}>
              <LogOut size={16} /> {t('Se déconnecter', 'Sign out')}
            </button>
          </div>
        )}
      </div>
    </LangProvider>
  );
}

/** Why the shop is offline or not taking orders, with the way to fix it (Vendor.live_blockers). */
function LiveBanner() {
  const { vendor } = useDashboard();
  if (!vendor || (vendor.live && vendor.live_blockers.length === 0)) return null;
  const b = vendor.live_blockers;
  // The plan comes first: a closed shop is closed, with or without a wallet.
  const [text, href, cta] = b.includes('subscription_suspended')
    ? [
        'Votre essai ou votre formule est terminé : la boutique est fermée et son lien ne s’ouvre plus. Tout reste ici, choisissez une formule pour la rouvrir.',
        '/app/abonnement',
        'Choisir une formule',
      ]
    : b.includes('subscription_required')
      ? [
          'Choisissez une formule pour mettre la boutique en ligne.',
          '/app/abonnement',
          'Voir les formules',
        ]
      : b.includes('wallet_missing')
        ? [
            'Votre boutique n’est pas encore publiée : liez un portefeuille pour l’ouvrir aux clients. En attendant, préparez-la et ouvrez-la en aperçu.',
            '/app/portefeuille',
            'Lier un portefeuille',
          ]
        : b.includes('wallet_degraded')
          ? [
              'Votre portefeuille ne répond plus : les clients ne peuvent pas payer.',
              '/app/portefeuille',
              'Vérifier',
            ]
          : ['Votre boutique est momentanément hors ligne.', '/app/reglages', 'Réglages'];
  return (
    <div className="banner alert" role="status">
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <TriangleAlert size={16} />
        {text}
      </span>
      <Link className="button small" href={href}>
        {cta}
      </Link>
    </div>
  );
}
