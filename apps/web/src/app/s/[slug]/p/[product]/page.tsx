import type { Metadata } from 'next';
import Link from 'next/link';
import { ViewTransition } from 'react';
import { AddToCart } from '@/components/add-to-cart';
import { Availability } from '@/components/availability';
import { AskSelly } from '@/components/chat/ask-selly';
import { PhotoZoom } from '@/components/storefront/photo-viewer';
import { Visual } from '@/components/storefront/visual';
import { getProduct, getStore } from '@/lib/core';
import { formatMoney } from '@/lib/format';

type Params = { params: Promise<{ slug: string; product: string }> };

// OpenGraph tags so a link pasted in WhatsApp shows the photo, the name and the price (architecture.md 3.4).
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, product: p } = await params;
  const { store, preview } = await getStore(slug);
  // A closed shop shows no product, not even in a pasted link preview.
  if (store.status !== 'active' && !preview) return { title: store.display_name };
  const product = await getProduct(slug, p);
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
  const { store, preview } = await getStore(slug);
  // The layout shows the closed notice; core refuses the product anyway (except to the owner, in preview).
  if (store.status !== 'active' && !preview) return null;
  const product = await getProduct(slug, p);
  const [first, ...rest] = product.images;
  const category = store.categories?.find((c) => c.id === product.category_id);

  return (
    <main className="mx-auto max-w-[1260px] border-x border-d-hairline px-5 pt-6 pb-20 sm:px-8 lg:pt-10">
      <nav
        aria-label="Fil d’Ariane"
        className="mb-6 flex flex-wrap items-center gap-2 text-[0.9375rem] text-d-ink-soft"
      >
        <Link
          href={`/s/${slug}#catalogue`}
          className="inline-flex min-h-11 items-center gap-2 font-medium text-[var(--sf-ink)] hover:underline"
        >
          ← La sélection
        </Link>
        {category && (
          <>
            <span aria-hidden="true">/</span>
            <Link
              href={`/s/${slug}?category=${category.slug}#catalogue`}
              className="min-h-11 content-center hover:underline"
            >
              {category.name}
            </Link>
          </>
        )}
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.05fr_.95fr] lg:gap-16">
        <div>
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute inset-0 translate-x-3 translate-y-3 border border-d-hairline"
            />
            <div
              data-hero-visual
              className="relative overflow-clip border border-d-hairline bg-d-paper-deep"
            >
              <ViewTransition name={`product-${product.slug}`} share="morph" default="none">
                <PhotoZoom images={product.images} index={0} title={product.title}>
                  <Visual
                    image={first ?? null}
                    title={product.title}
                    sizes="(min-width: 1024px) 620px, 100vw"
                    priority
                  />
                </PhotoZoom>
              </ViewTransition>
            </div>
          </div>
          {rest.length > 0 && (
            <ul className="mt-6 grid grid-cols-4 gap-3">
              {rest.map((img, i) => (
                <li key={img.url} className="overflow-clip border border-d-hairline">
                  <PhotoZoom images={product.images} index={i + 1} title={product.title}>
                    <Visual image={img} title={product.title} sizes="140px" ratio="aspect-square" />
                  </PhotoZoom>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pd-in lg:pt-4">
          <p className="sf-eyebrow mb-5">{category?.name ?? store.display_name}</p>
          <h1 className="sf-serif text-[2.75rem] leading-[1] tracking-[-0.01em] sm:text-[3.5rem]">
            {product.title}
          </h1>
          <p className="sf-figure mt-4 text-[2rem] leading-none">{formatMoney(product.price)}</p>
          <p className="mt-3">
            <Availability value={product.availability} />
          </p>
          {product.description && (
            <p className="mt-6 max-w-prose text-[1.0625rem] leading-relaxed text-d-ink-soft">
              {product.description}
            </p>
          )}

          <div className="mt-8 border-t border-d-hairline pt-8">
            <AddToCart slug={slug} product={product} />
          </div>

          {store.chat.enabled && (
            <div className="mt-6 border-t border-d-hairline pt-6">
              <p className="mb-3 text-d-ink-soft">
                Une question sur la matière, la taille ou la livraison ?
              </p>
              <AskSelly
                slug={slug}
                storeName={store.display_name}
                whatsappLink={store.whatsapp_link}
                productId={product.id}
                productTitle={product.title}
                variant="inline"
              />
            </div>
          )}

          <ul className="mt-8 grid gap-3 border-t border-d-hairline pt-6 text-[0.9375rem] text-d-ink-soft">
            <li>Paiement en bitcoin, directement à {store.display_name}.</li>
            {store.delivery.pickup.available && (
              <li>Retrait gratuit : {store.delivery.pickup.address_text ?? 'à la boutique'}.</li>
            )}
            {store.delivery.zones.length > 0 && (
              <li>Livraison : {store.delivery.zones.map((z) => z.label).join(', ')}.</li>
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}
