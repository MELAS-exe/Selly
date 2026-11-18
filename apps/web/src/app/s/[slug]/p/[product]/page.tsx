import type { Metadata } from 'next';
import Link from 'next/link';
import { ViewTransition } from 'react';
import { AddToCart } from '@/components/add-to-cart';
import { Availability } from '@/components/availability';
import { AskSelly } from '@/components/chat/ask-selly';
import { ProductVisual } from '@/components/product-visual';
import { getProduct, getStore } from '@/lib/core';
import { formatMoney } from '@/lib/format';

type Params = { params: Promise<{ slug: string; product: string }> };

// OpenGraph tags so a link pasted in WhatsApp shows the photo, the name and the price (architecture.md 3.4).
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, product: p } = await params;
  const [{ store }, product] = await Promise.all([getStore(slug), getProduct(slug, p)]);
  const title = `${product.title}, ${formatMoney(product.price)}`;
  const image = product.images[0];
  return {
    title: `${product.title} | ${store.display_name}`,
    description: product.description,
    openGraph: {
      title,
      description: product.description,
      siteName: store.display_name,
      url: product.url,
      images: image ? [{ url: image.url, width: image.width, height: image.height }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug, product: p } = await params;
  const [{ store }, product] = await Promise.all([getStore(slug), getProduct(slug, p)]);
  const [first, ...rest] = product.images;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-4 sm:grid sm:grid-cols-2 sm:gap-8">
      <nav aria-label="Fil d'Ariane" className="mb-3 sm:col-span-2">
        <Link
          href={`/s/${slug}`}
          className="inline-flex min-h-11 items-center font-medium text-indigo"
        >
          ← Tous les articles
        </Link>
      </nav>

      <div>
        <div data-hero-visual className="overflow-hidden rounded-[var(--radius-tile)]">
          <ViewTransition name={`product-${product.slug}`} share="morph" default="none">
            <ProductVisual
              image={first ?? null}
              title={product.title}
              seed={product.slug}
              sizes="(min-width: 640px) 360px, 100vw"
              priority
            />
          </ViewTransition>
        </div>
        {rest.length > 0 && (
          <ul className="mt-2 grid grid-cols-4 gap-2">
            {rest.map((img) => (
              <li key={img.url} className="overflow-hidden rounded-[var(--radius-control)]">
                <ProductVisual image={img} title={product.title} seed={product.slug} sizes="90px" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 sm:mt-0">
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">
          {product.title}
        </h1>
        <p className="tnum mt-1 text-2xl font-bold">{formatMoney(product.price)}</p>
        <p className="mt-1">
          <Availability value={product.availability} />
        </p>
        {product.description && (
          <p className="mt-4 max-w-prose text-muted">{product.description}</p>
        )}

        <div className="mt-6">
          <AddToCart slug={slug} product={product} />
        </div>

        <div className="mt-4">
          <AskSelly
            slug={slug}
            storeName={store.display_name}
            whatsappLink={store.whatsapp_link}
            productId={product.id}
            productTitle={product.title}
            variant="inline"
          />
        </div>
      </div>
    </main>
  );
}
