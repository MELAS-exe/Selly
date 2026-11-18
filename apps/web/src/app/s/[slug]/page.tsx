import type { Metadata } from 'next';
import Link from 'next/link';
import { type CSSProperties, ViewTransition } from 'react';
import { Availability } from '@/components/availability';
import { CategoryNav } from '@/components/category-nav';
import { ProductVisual } from '@/components/product-visual';
import { getStore } from '@/lib/core';
import { formatMoney } from '@/lib/format';
import type { StorePublic } from '@/lib/types';

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { store, products } = await getStore(slug);
  const description = `${products.length} article${products.length > 1 ? 's' : ''}, livraison à Dakar, paiement en bitcoin.`;
  return {
    title: store.display_name,
    description,
    openGraph: { title: store.display_name, description, type: 'website' },
  };
}

function deliverySummary(store: StorePublic): string[] {
  const out: string[] = [];
  const zones = store.delivery.zones;
  if (zones.length > 0) {
    const fees = zones.map((z) => z.fee.amount);
    const min = Math.min(...fees);
    out.push(
      `Livraison ${zones.map((z) => z.label).join(', ')}, dès ${formatMoney({ amount: min, currency: 'XOF' })}`,
    );
  }
  if (store.delivery.pickup.available) {
    out.push(
      store.delivery.pickup.address_text
        ? `Retrait gratuit : ${store.delivery.pickup.address_text}`
        : 'Retrait gratuit en boutique',
    );
  }
  return out;
}

const days: Record<string, string> = {
  'lun-sam': 'Du lundi au samedi',
  'lun-ven': 'Du lundi au vendredi',
};

export default async function StorePage({ params, searchParams }: Params) {
  const { slug } = await params;
  const { category } = await searchParams;
  const { store, products } = await getStore(slug, { category });

  return (
    <main>
      <section className="loom">
        {[0, 1, 2, 3, 4, 5].map((r) => (
          <span
            key={r}
            aria-hidden="true"
            className="wax loom-strip"
            style={{ '--r': r } as CSSProperties}
          />
        ))}
        <div className="relative mx-auto max-w-3xl px-4 pt-16 pb-5">
          <div className="card-rise rounded-[var(--radius-tile)] bg-paper p-5">
            <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">
              {store.display_name}
            </h1>
            <ul className="mt-3 space-y-1 text-muted">
              {deliverySummary(store).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {store.hours.map((h) => (
                <li key={h.days}>
                  {days[h.days] ?? h.days}, de {h.open} à {h.close}
                </li>
              ))}
            </ul>
            {store.whatsapp_link && (
              <a
                href={store.whatsapp_link}
                rel="noopener"
                className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line px-4 font-semibold text-ink"
              >
                Écrire sur WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="catalogue" className="mx-auto max-w-3xl px-4 pt-6">
        <h2 id="catalogue" className="sr-only">
          Articles
        </h2>
        <div className="mb-4">
          <CategoryNav slug={slug} categories={store.categories ?? []} active={category} />
        </div>
        {products.length === 0 ? (
          <p className="rounded-[var(--radius-tile)] bg-mist p-6 text-muted">
            {category
              ? 'Aucun article dans cette catégorie pour le moment.'
              : 'Aucun article en ligne pour le moment. Revenez bientôt, ou écrivez au vendeur.'}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3">
            {products.map((p, i) => (
              <li
                key={p.id}
                className={i < 6 ? 'tile-in' : undefined}
                style={i < 6 ? ({ '--i': i } as CSSProperties) : undefined}
              >
                <Link href={`/s/${slug}/p/${p.slug}`} className="tile-press group block">
                  <div className="overflow-hidden rounded-[var(--radius-tile)]">
                    <ViewTransition name={`product-${p.slug}`} share="morph" default="none">
                      <ProductVisual
                        image={p.image}
                        title={p.title}
                        seed={p.slug}
                        sizes="(min-width: 640px) 240px, 50vw"
                        priority={i < 2}
                      />
                    </ViewTransition>
                  </div>
                  <h3 className="mt-2 leading-snug font-semibold group-hover:underline">
                    {p.title}
                  </h3>
                  <p className="tnum text-lg font-bold">{formatMoney(p.price)}</p>
                  <p>
                    <Availability value={p.availability} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
