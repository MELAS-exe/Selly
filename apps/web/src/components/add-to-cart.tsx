'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { addLine, readCart, writeCart } from '@/lib/cart';
import { formatMoney, optionName } from '@/lib/format';
import type { ProductDetail, PublicVariant } from '@/lib/types';

function findVariant(variants: PublicVariant[], picked: Record<string, string>) {
  return variants.find((v) => Object.entries(v.options).every(([k, val]) => picked[k] === val));
}

/** Option picker, quantity and the add button. The only client JavaScript on a product page. */
export function AddToCart({ slug, product }: { slug: string; product: ProductDetail }) {
  const keys = Object.keys(product.options);
  // Options with a single value are chosen for the customer.
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const preset: Record<string, string> = {};
    for (const k of keys) {
      const values = product.options[k] ?? [];
      if (values.length === 1 && values[0]) preset[k] = values[0];
    }
    return preset;
  });
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const variant = useMemo(
    () =>
      keys.every((k) => picked[k])
        ? findVariant(product.variants, picked)
        : product.variants.length === 1
          ? product.variants[0]
          : undefined,
    [keys, picked, product.variants],
  );
  const missing = keys.filter((k) => !picked[k]);
  const soldOut = variant?.availability === 'out_of_stock';

  /** A value is offered if at least one variant with it, and with the other picks, is in stock. */
  const valueInStock = (key: string, value: string) =>
    product.variants.some(
      (v) =>
        v.options[key] === value &&
        v.availability !== 'out_of_stock' &&
        Object.entries(picked).every(([k, val]) => k === key || v.options[k] === val),
    );

  function add() {
    if (!variant || soldOut) return;
    writeCart(
      slug,
      addLine(readCart(slug), {
        variant_id: variant.id,
        product_slug: product.slug,
        title: product.title,
        options: variant.options,
        unit_price: variant.price,
        quantity,
      }),
    );
    setAdded(true);
  }

  return (
    <div className="space-y-5">
      {keys
        .filter((k) => (product.options[k]?.length ?? 0) > 1)
        .map((k) => (
          <fieldset key={k}>
            <legend className="mb-2 font-semibold">
              {optionName(k)}
              {picked[k] && <span className="font-normal text-muted"> : {picked[k]}</span>}
            </legend>
            <div className="flex flex-wrap gap-2">
              {product.options[k]?.map((value) => {
                const on = picked[k] === value;
                const ok = valueInStock(k, value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    disabled={!ok}
                    onClick={() => {
                      setPicked((p) => ({ ...p, [k]: value }));
                      setAdded(false);
                    }}
                    className={`tnum min-h-11 min-w-12 rounded-[var(--radius-control)] border px-3 font-semibold transition-colors ${
                      on ? 'border-ink bg-ink text-paper' : 'border-line bg-paper text-ink'
                    } disabled:border-dashed disabled:text-muted disabled:line-through`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

      <div className="flex items-center gap-3">
        <span id="qty-label" className="font-semibold">
          Quantité
        </span>
        <div
          role="group"
          aria-labelledby="qty-label"
          className="flex items-center rounded-[var(--radius-control)] border border-line"
        >
          <button
            type="button"
            aria-label="Retirer un"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="size-11 text-xl disabled:text-line"
          >
            −
          </button>
          <output aria-live="polite" className="tnum w-8 text-center font-semibold">
            {quantity}
          </output>
          <button
            type="button"
            aria-label="Ajouter un"
            disabled={quantity >= 50}
            onClick={() => setQuantity((q) => Math.min(50, q + 1))}
            className="size-11 text-xl disabled:text-line"
          >
            +
          </button>
        </div>
      </div>

      {added ? (
        <div role="status" className="rounded-[var(--radius-tile)] bg-leaf-soft p-4">
          <p className="font-semibold text-leaf">Ajouté au panier.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/s/${slug}/cart`}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-indigo px-5 font-semibold text-paper"
            >
              Voir le panier
            </Link>
            <Link
              href={`/s/${slug}`}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-paper px-5 font-semibold"
            >
              Continuer mes achats
            </Link>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={add}
          disabled={!variant || soldOut}
          className="tnum min-h-12 w-full rounded-[var(--radius-control)] bg-indigo px-5 text-lg font-semibold text-paper disabled:bg-mist disabled:text-muted"
        >
          {soldOut
            ? 'Épuisé dans cette option'
            : missing.length > 0
              ? `Choisissez : ${missing.map(optionName).join(', ').toLowerCase()}`
              : `Ajouter au panier, ${formatMoney({ amount: (variant?.price.amount ?? 0) * quantity, currency: variant?.price.currency ?? 'XOF' })}`}
        </button>
      )}
    </div>
  );
}
