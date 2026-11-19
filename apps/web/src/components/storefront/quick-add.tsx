'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { addLine, readCart, writeCart } from '@/lib/cart';
import type { ProductDetail } from '@/lib/types';
import { useT } from '../lang';
import { flyToCart } from '../motion/fly-to-cart';
import { Check, Plus } from './draft-icons';

/**
 * The "+" of a product card. A product with options (sizes, colours) needs a choice: the button leads to its page.
 * Without options, it adds the single variant right here (read from core, so price and stock are current), and the
 * photo flies to the cart.
 */
export function QuickAdd({
  slug,
  productSlug,
  title,
  hasOptions,
  soldOut,
}: {
  slug: string;
  productSlug: string;
  title: string;
  hasOptions: boolean;
  soldOut: boolean;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle');
  const t = useT();
  const button = useRef<HTMLButtonElement>(null);

  if (hasOptions && !soldOut)
    return (
      <Link
        href={`/s/${slug}/p/${productSlug}`}
        className="sf-icon-btn shrink-0"
        aria-label={t(`Choisir une option pour ${title}`, `Choose an option for ${title}`)}
      >
        <Plus size={18} />
      </Link>
    );

  return (
    <button
      ref={button}
      type="button"
      disabled={soldOut || state === 'busy'}
      aria-label={
        state === 'added'
          ? t(`${title} ajouté au panier`, `${title} added to the cart`)
          : t(`Ajouter ${title} au panier`, `Add ${title} to the cart`)
      }
      className={`sf-icon-btn shrink-0 disabled:opacity-35 ${state === 'added' ? '!border-[var(--sf-ink)] !bg-[var(--sf-ink)] !text-d-paper' : ''}`}
      onClick={async () => {
        setState('busy');
        try {
          const res = await fetch(
            `/api/v1/stores/${encodeURIComponent(slug)}/products/${encodeURIComponent(productSlug)}`,
          );
          const product = (await res.json()) as ProductDetail;
          const variant = product.variants.find((v) => v.availability !== 'out_of_stock');
          if (!variant) return setState('idle');
          writeCart(
            slug,
            addLine(readCart(slug), {
              variant_id: variant.id,
              product_slug: product.slug,
              title: product.title,
              options: variant.options,
              unit_price: variant.price,
              quantity: 1,
            }),
          );
          setState('added');
          flyToCart(
            button.current?.closest('article')?.querySelector<HTMLElement>('.card-media') ?? null,
            button.current,
          );
          setTimeout(() => setState('idle'), 1800);
        } catch {
          setState('idle');
        }
      }}
    >
      {state === 'added' ? <Check size={18} /> : <Plus size={18} />}
    </button>
  );
}
