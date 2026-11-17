import Link from 'next/link';
import type { ReactNode } from 'react';
import { CartButton } from '@/components/cart-button';
import { Woven } from '@/components/motion/woven';
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

  return (
    <div className="min-h-dvh bg-paper">
      <div aria-hidden="true" className="wax h-1.5" />
      <header
        className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur"
        style={{ viewTransitionName: 'shop-header' }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-1.5">
          <Link
            href={`/s/${slug}`}
            className="flex min-h-11 items-center truncate text-lg font-bold"
          >
            {store.display_name}
          </Link>
          <CartButton slug={slug} />
        </div>
      </header>
      <Woven />
      {children}
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
