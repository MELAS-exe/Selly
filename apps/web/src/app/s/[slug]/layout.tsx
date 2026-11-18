import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { CartButton } from '@/components/cart-button';
import { AskSelly } from '@/components/chat/ask-selly';
import { Woven } from '@/components/motion/woven';
import { brandStyle } from '@/lib/brand-colors';
import { getStore } from '@/lib/core';

export default async function ShopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { store } = await getStore(slug);
  // A store response cached before branding existed has none: fall back to the default look.
  const branding = store.branding ?? {
    logo_url: null,
    primary_color: '',
    accent_color: '',
    banner: null,
  };
  const { banner } = branding;

  return (
    <div className="min-h-dvh bg-paper" style={brandStyle(branding) as CSSProperties}>
      <div aria-hidden="true" className="wax h-1.5" />
      {banner?.text && (
        <div className="bg-ochre px-4 py-2 text-center text-sm font-semibold text-paper">
          {banner.href ? (
            <a href={banner.href} className="underline underline-offset-2">
              {banner.text}
            </a>
          ) : (
            banner.text
          )}
        </div>
      )}
      <header
        className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur"
        style={{ viewTransitionName: 'shop-header' }}
      >
        <span aria-hidden="true" className="header-shade" />
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-1.5">
          <Link
            href={`/s/${slug}`}
            className="flex min-h-11 min-w-0 items-center gap-2 truncate text-lg font-bold"
          >
            {branding.logo_url && (
              // The shop's own logo: no width/height from the API (one size), so this stays a plain img.
              <img
                src={branding.logo_url}
                alt=""
                className="size-8 shrink-0 rounded-full object-cover"
              />
            )}
            <span className="truncate">{store.display_name}</span>
          </Link>
          <CartButton slug={slug} />
        </div>
      </header>
      <Woven />
      {children}
      <AskSelly slug={slug} storeName={store.display_name} whatsappLink={store.whatsapp_link} />
      <footer className="mx-auto max-w-3xl px-4 pt-10 pb-8 text-muted">
        <p>
          Paiement en bitcoin, directement au vendeur.{' '}
          <Link href="/aide/payer-en-bitcoin" className="font-medium text-indigo underline">
            Comment payer
          </Link>
        </p>
        {store.powered_by_badge && <p className="mt-1">Boutique créée avec Selly</p>}
      </footer>
    </div>
  );
}
