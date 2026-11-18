import type { CSSProperties, ReactNode } from 'react';
import { AskSelly } from '@/components/chat/ask-selly';
import { AskButton } from '@/components/storefront/ask-button';
import { CartDrawer } from '@/components/storefront/cart-drawer';
import { ArrowUpRight } from '@/components/storefront/draft-icons';
import { deliveryLabel } from '@/components/storefront/facts';
import { storefrontSerif } from '@/components/storefront/fonts';
import { ShareButton } from '@/components/storefront/share-button';
import { ShopMark } from '@/components/storefront/shop-mark';
import { ShopMenu } from '@/components/storefront/shop-menu';
import { storefrontStyle } from '@/lib/brand-colors';
import { getStore } from '@/lib/core';
import '@/components/storefront/storefront.css';
// The turning stamp (pv-spin) lives with the landing page's styles.
import '@/components/landing/landing.css';

export default async function ShopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { store } = await getStore(slug);
  // Trial over or plan suspended: the link opens on this notice only, nothing of the shop behind it.
  if (store.status !== 'active') return <ClosedShop name={store.display_name} />;
  const banner = store.branding?.banner;
  const delivery = deliveryLabel(store);
  const announce =
    banner?.text ??
    (delivery
      ? `${delivery.title}, ${delivery.sub}`
      : 'Paiement en bitcoin, directement à la boutique');

  return (
    <div
      className={`sf ${storefrontSerif.variable} min-h-dvh text-[var(--sf-ink)]`}
      style={storefrontStyle(store.branding) as CSSProperties}
    >
      <div aria-hidden="true" className="sf-progress" />
      <div className="bg-[var(--sf-ink)] px-4 py-2.5 text-center text-[0.9375rem] text-d-paper">
        <span className="inline-flex items-center justify-center gap-2.5">
          <span aria-hidden="true" className="size-1.5 shrink-0 bg-[var(--sf-accent)]" />
          {banner?.href ? (
            <a href={banner.href} className="underline underline-offset-4">
              {announce}
            </a>
          ) : (
            announce
          )}
        </span>
      </div>

      <header
        className="sticky top-0 z-30 border-b border-d-hairline bg-d-paper/90 backdrop-blur-md"
        style={{ viewTransitionName: 'shop-header' }}
      >
        <span aria-hidden="true" className="header-shade" />
        <div className="relative mx-auto flex h-20 max-w-[1260px] items-center justify-between gap-4 px-5 sm:px-8">
          <a
            href={`/s/${slug}`}
            aria-label={`${store.display_name}, accueil de la boutique`}
            className="min-w-0"
          >
            <ShopMark name={store.display_name} logo={store.branding?.logo_url ?? null} />
          </a>
          <nav className="hidden items-center gap-9 md:flex" aria-label="Navigation de la boutique">
            <a
              className="min-h-11 content-center font-medium hover:underline hover:underline-offset-8"
              href={`/s/${slug}#catalogue`}
            >
              La sélection
            </a>
            <a
              className="min-h-11 content-center font-medium hover:underline hover:underline-offset-8"
              href={`/s/${slug}#boutique`}
            >
              La boutique
            </a>
            {store.chat.enabled && (
              <AskButton className="flex min-h-11 items-center gap-1.5 font-medium hover:underline hover:underline-offset-8">
                Parler à Selly <ArrowUpRight size={15} />
              </AskButton>
            )}
          </nav>
          <div className="flex items-center gap-2">
            <ShareButton
              url={`/s/${slug}`}
              title={store.display_name}
              className="sf-btn sf-btn-ghost hidden !min-h-11 sm:inline-flex"
            >
              <ArrowUpRight size={15} /> Partager
            </ShareButton>
            <CartDrawer slug={slug} ordersOpen={store.ordering?.enabled !== false} />
            <ShopMenu />
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-d-hairline">
        <div className="mx-auto flex max-w-[1260px] flex-col gap-5 border-x border-d-hairline px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <ShopMark name={store.display_name} logo={store.branding?.logo_url ?? null} />
          <p className="text-[0.9375rem] text-d-ink-soft">
            Paiement en bitcoin, directement à la boutique.{' '}
            <a
              href="/aide/payer-en-bitcoin"
              className="font-medium text-[var(--sf-ink)] underline underline-offset-4"
            >
              Comment payer
            </a>
          </p>
          {store.powered_by_badge && (
            <a
              href="/"
              className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-d-ink-soft"
            >
              Une boutique portée par{' '}
              <img src="/brand/selly-wordmark.png" alt="Selly" className="h-5 w-auto" />
            </a>
          )}
        </div>
      </footer>

      {store.chat.enabled && (
        <AskSelly slug={slug} storeName={store.display_name} whatsappLink={store.whatsapp_link} />
      )}
    </div>
  );
}

function ClosedShop({ name }: { name: string }) {
  return (
    <div className={`sf ${storefrontSerif.variable} min-h-dvh text-[var(--sf-ink)]`}>
      <main className="mx-auto max-w-xl px-5 pt-24 pb-20">
        <h1 className="text-[1.75rem] leading-tight font-bold">Boutique momentanément fermée</h1>
        <p className="mt-3 text-d-ink-soft">
          {name} ne reçoit pas de visites pour le moment. Revenez un peu plus tard.
        </p>
        <a href="/" className="mt-8 inline-flex min-h-11 items-center gap-2 text-[0.9375rem]">
          Une boutique portée par{' '}
          <img src="/brand/selly-wordmark.png" alt="Selly" className="h-5 w-auto" />
        </a>
      </main>
    </div>
  );
}
