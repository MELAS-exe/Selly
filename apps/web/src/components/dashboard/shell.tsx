'use client';

// The dashboard frame: the side bar (desktop), the top bar, the bottom bar (phone), the shop's status banner and
// the bell. Pages render inside. The routes are the ones core's alerts open (apps/web/AGENTS.md).

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { DashboardProvider, useDashboard, useResource } from './data';
import { fmtAgo, initials } from './format';
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

  const waiting = (chats.data?.data ?? []).filter((c) => c.mode === 'human' || c.unread_count > 0);
  const nav: NavItem[] = [
    { href: '/app', label: 'Accueil', icon: LayoutDashboard },
    {
      href: '/app/commandes',
      label: 'Commandes',
      icon: ShoppingBag,
      count: toShip.data?.data.length,
    },
    { href: '/app/discussions', label: 'Discussions', icon: MessageCircle, count: waiting.length },
    { href: '/app/catalogue', label: 'Catalogue', icon: Package },
    {
      href: '/app/brouillons',
      label: 'Brouillons',
      icon: ImagePlus,
      count: drafts.data?.data.length,
    },
    { href: '/app/portefeuille', label: 'Portefeuille', icon: Wallet },
    { href: '/app/abonnement', label: 'Abonnement', icon: Zap },
    { href: '/app/assistant', label: 'Assistant', icon: Bot },
  ];
  const settings: NavItem = { href: '/app/reglages', label: 'Réglages', icon: Settings2 };
  const security: NavItem = { href: '/app/securite', label: 'Sécurité', icon: KeyRound };
  const isActive = (href: string) =>
    href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);
  const current = [...nav, settings, security].find((n) => isActive(n.href))?.label ?? 'Accueil';
  const unseen = notes.length - seen;

  useEffect(() => registerServiceWorker(), []);
  const paidLive = notes.some((n) => n.type === 'order.paid');

  // Close the menus on navigation.
  useEffect(() => {
    setMenuOpen(false);
    setBellOpen(false);
  }, [pathname]);

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
        <span>{item.label}</span>
        {kind !== 'mobile' && item.count ? <span className="nav-count">{item.count}</span> : null}
        {kind === 'mobile' && item.count ? (
          <i className="dot" aria-label={`${item.count} en attente`} />
        ) : null}
      </Link>
    );
  };

  return (
    <div className="selly-shell theme-paper-vermilion">
      <aside className="side">
        <Link href="/app" className="brand" aria-label="Selly, accueil du tableau de bord">
          <img src="/brand/selly-wordmark-light.png" alt="Selly" />
        </Link>
        <div className="side-caption">Votre boutique</div>
        <nav className="nav-list" aria-label="Navigation principale">
          {nav.map((item) => link(item, 'side'))}
        </nav>
        <div className="side-spacer" />
        <div className="store-card">
          <small>Mini-boutique</small>
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
          <Settings2 size={16} /> Réglages
        </Link>
        <Link
          href={security.href}
          className={`nav-item settings ${isActive(security.href) ? 'active' : ''}`}
          style={{ borderTop: 0 }}
        >
          <KeyRound size={16} /> Sécurité
        </Link>
        <div className="profile">
          <div className="avatar">{initials(name)}</div>
          <div style={{ minWidth: 0 }}>
            <strong>{name}</strong>
            <span>
              {demo ? 'Boutique de démonstration' : vendor?.live ? 'En ligne' : 'Hors ligne'}
            </span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Se déconnecter"
            title="Se déconnecter"
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
            {demo && <span className="demo-chip">Mode démo</span>}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="icon-button"
                aria-label={unseen > 0 ? `Notifications, ${unseen} nouvelles` : 'Notifications'}
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
                    {notes.length > 0 && (
                      <button type="button" className="text-link" onClick={clearNotes}>
                        Effacer
                      </button>
                    )}
                  </div>
                  {notes.length === 0 ? (
                    <p className="popover-empty">
                      Rien de neuf depuis l’ouverture du tableau de bord. Les commandes payées et
                      les discussions qui vous attendent s’afficheront ici.
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
              aria-label="Aide : payer et recevoir en bitcoin"
              title="Aide"
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

      <nav className="mobile-nav" aria-label="Navigation rapide">
        {nav.slice(0, 4).map((item) => link(item, 'mobile'))}
        <button
          type="button"
          className={`mobile-nav-item ${menuOpen ? 'active' : ''}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
          <span>Plus</span>
          {drafts.data?.data.length ? <i className="dot" /> : null}
        </button>
      </nav>
      {menuOpen && (
        <div className="sheet" role="dialog" aria-label="Plus">
          {[nav[4], nav[5], nav[6], nav[7], settings, security].map(
            (item) => item && link(item, 'sheet'),
          )}
          <button type="button" className="nav-item" onClick={signOut}>
            <LogOut size={16} /> Se déconnecter
          </button>
        </div>
      )}
    </div>
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
            'Votre boutique est en ligne, mais les clients ne peuvent pas encore commander : liez un portefeuille pour recevoir les paiements.',
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
