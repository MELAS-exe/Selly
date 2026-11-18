'use client';

// The dashboard frame: access guard (GET /vendors/me), header, navigation (bottom tabs on phones, a sidebar on
// large screens), live-blocker banners, and the providers every page uses (data, live stream, the vendor).

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { ApiError } from '@/lib/browser-api';
import { ResourceProvider, useResource } from '@/lib/dashboard/resource';
import type { Metrics, VendorMe } from '@/lib/dashboard/types';
import { dash } from '@/lib/i18n/dashboard';
import type { LiveBlocker } from '@/lib/vendor-types';
import { LiveProvider, useLive } from './live';
import { btn, ErrorState, Skeleton } from './ui';

const VendorContext = createContext<{ vendor: VendorMe; refresh: () => Promise<void> } | null>(
  null,
);

/** The signed-in vendor. Only used under the shell, which waits for it. */
export function useVendor() {
  const v = useContext(VendorContext);
  if (!v) throw new Error('useVendor outside the dashboard shell');
  return v;
}

type IconName = 'home' | 'orders' | 'chats' | 'catalog' | 'more';

function Icon({ name }: { name: IconName }) {
  const p = {
    home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
    orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
    chats: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
    catalog: 'M3 12l9-9h8v8l-9 9zM15.5 8.5h.01',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  }[name];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3.5 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={p} />
    </svg>
  );
}

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/app', label: dash.nav.home, icon: 'home' },
  { href: '/app/commandes', label: dash.nav.orders, icon: 'orders' },
  { href: '/app/discussions', label: dash.nav.chats, icon: 'chats' },
  { href: '/app/catalogue', label: dash.nav.catalog, icon: 'catalog' },
  { href: '/app/plus', label: dash.nav.more, icon: 'more' },
];

/** Sub-pages of "More" that have their own top-level paths (core's alerts link to them). */
const MORE_PATHS = ['/app/plus', '/app/portefeuille', '/app/abonnement'];

function isActive(pathname: string, href: string) {
  if (href === '/app') return pathname === '/app';
  if (href === '/app/plus') return MORE_PATHS.some((p) => pathname.startsWith(p));
  return pathname.startsWith(href);
}

const BLOCKER_LINK: Record<LiveBlocker, string> = {
  wallet_missing: '/app/portefeuille',
  wallet_degraded: '/app/portefeuille',
  subscription_required: '/app/abonnement',
  subscription_suspended: '/app/abonnement',
};

function Banners({ blockers }: { blockers: LiveBlocker[] }) {
  if (!blockers.length) return null;
  return (
    <div className="space-y-px">
      {blockers.map((b) => (
        <div
          key={b}
          role="alert"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-d-alert-soft px-4 py-2 text-d-alert lg:px-8"
        >
          <p>{dash.blockers[b].text}</p>
          <Link
            href={BLOCKER_LINK[b]}
            className="min-h-11 content-center font-medium underline underline-offset-4"
          >
            {dash.blockers[b].action}
          </Link>
        </div>
      ))}
    </div>
  );
}

function LivePill({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
        live ? 'bg-d-paid-soft text-d-paid' : 'bg-d-cancelled-soft text-d-cancelled'
      }`}
      title={live ? dash.shell.onlineHint : dash.shell.offlineHint}
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${live ? 'bg-d-paid' : 'bg-d-cancelled'}`}
      />
      {live ? dash.shell.online : dash.shell.offline}
    </span>
  );
}

/** "You are offline" and "live updates paused", in one quiet line. */
function ConnectionNotice() {
  const { status } = useLive();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  if (!online)
    return (
      <p role="status" className="bg-d-paper-deep px-4 py-2 lg:px-8">
        <strong className="font-medium">{dash.offline.title}</strong> {dash.offline.text}
      </p>
    );
  if (status === 'down')
    return (
      <p role="status" className="bg-d-paper-deep px-4 py-2 text-d-ink-soft lg:px-8">
        {dash.shell.reconnecting}
      </p>
    );
  return null;
}

function Frame({ vendor, children }: { vendor: VendorMe; children: ReactNode }) {
  const pathname = usePathname();
  // Chats waiting for the vendor, as a count on the Chats entry.
  const { data: metrics } = useResource<Metrics>(
    'metrics?nav',
    '/vendors/dashboard/metrics?period=today',
  );
  const waiting = metrics?.chats_waiting ?? 0;

  const link = (n: (typeof NAV)[number], mobile: boolean) => {
    const on = isActive(pathname, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={on ? 'page' : undefined}
        className={
          mobile
            ? `relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.8125rem] font-medium ${on ? 'text-d-ink' : 'text-d-ink-soft'}`
            : `relative flex min-h-11 items-center gap-3 rounded-[6px] px-3 font-medium ${on ? 'bg-d-paper-deep text-d-ink' : 'text-d-ink-soft hover:text-d-ink'}`
        }
      >
        {mobile && on && (
          <span
            aria-hidden="true"
            className="absolute top-0 h-0.5 w-8 rounded-full bg-d-lime-deep"
          />
        )}
        <Icon name={n.icon} />
        <span>{n.label}</span>
        {n.icon === 'chats' && waiting > 0 && (
          <span
            className={`tnum grid min-w-5 place-items-center rounded-full bg-d-ink px-1 text-xs text-d-paper ${mobile ? 'absolute top-1.5 left-1/2 ml-2' : 'ml-auto'}`}
          >
            {waiting}
            <span className="sr-only"> waiting</span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-d-hairline px-4 py-6 lg:flex">
        <Link href="/app" className="mb-8 block px-3">
          <img src="/brand/selly-wordmark.png" alt="Selly" className="h-7 w-auto" />
        </Link>
        <nav aria-label={dash.nav.main} className="flex flex-col gap-1">
          {NAV.map((n) => link(n, false))}
        </nav>
        <div className="mt-auto space-y-3 px-3">
          <p className="font-display text-xl leading-tight">{vendor.display_name}</p>
          <LivePill live={vendor.live} />
          <a href={vendor.store_url} target="_blank" rel="noopener" className={btn.quiet}>
            {dash.shell.viewShop}
          </a>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-d-hairline bg-d-paper/90 px-4 py-2 backdrop-blur lg:hidden">
          <p className="truncate font-display text-xl">{vendor.display_name}</p>
          <LivePill live={vendor.live} />
        </header>
        <Banners blockers={vendor.live_blockers} />
        <ConnectionNotice />
        <main className="flex-1 px-4 pt-5 pb-28 lg:px-8 lg:pt-8 lg:pb-10">{children}</main>
        <nav
          aria-label={dash.nav.main}
          className="fixed inset-x-0 bottom-0 z-20 flex border-t border-d-hairline bg-d-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          {NAV.map((n) => link(n, true))}
        </nav>
      </div>
    </div>
  );
}

function Guard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: vendor, error, refresh } = useResource<VendorMe>('vendor', '/vendors/me');
  const status = error instanceof ApiError ? error.problem.status : null;

  useEffect(() => {
    if (status === 401) router.replace(`/app/login?next=${encodeURIComponent(pathname)}`);
    else if (status === 404) router.replace('/app/onboarding');
  }, [status, router, pathname]);

  if (vendor)
    return (
      <VendorContext.Provider value={{ vendor, refresh }}>
        <LiveProvider>
          <Frame vendor={vendor}>{children}</Frame>
        </LiveProvider>
      </VendorContext.Provider>
    );

  if (error && status !== 401 && status !== 404)
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorState error={error} onRetry={refresh} />
      </div>
    );

  return (
    <div role="status" className="lg:grid lg:grid-cols-[15rem_1fr]">
      <span className="sr-only">{dash.shell.loading}</span>
      <div className="hidden h-dvh border-r border-d-hairline lg:block" />
      <div className="space-y-6 px-4 py-8 lg:px-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-24 w-full max-w-md" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div lang={dash.lang} className="dash min-h-dvh">
      <ResourceProvider>
        <Guard>{children}</Guard>
      </ResourceProvider>
    </div>
  );
}
