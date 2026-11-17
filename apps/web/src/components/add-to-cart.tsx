'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addLine, readCart, writeCart } from '@/lib/cart';
import { formatMoney, optionName } from '@/lib/format';
import type { ProductDetail, PublicVariant } from '@/lib/types';
import { flyToCart } from './motion/fly-to-cart';
import { durationToken } from './motion/tokens';

/** Brings the confirmation into view once it has opened, if the add button sat at the bottom. */
function revealStatus(el: HTMLDivElement | null) {
  if (!el) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = setTimeout(
    () => el.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' }),
    durationToken('--dur-ui'),
  );
  return () => clearTimeout(t);
}

function findVariant(variants: PublicVariant[], picked: Record<string, string>) {
  return variants.find((v) => Object.entries(v.options).every(([k, val]) => picked[k] === val));
}

/**
 * One option's values, with a bar that slides under the chosen one. The bar is absolutely
 * placed and moved with a transform measured from the button (offsetLeft/Top/Width), so
 * choosing never shifts the layout.
 */
function OptionValues({
  values,
  selected,
  inStock,
  onPick,
}: {
  values: string[];
  selected: string | undefined;
  inStock: (value: string) => boolean;
  onPick: (value: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const place = (instant: boolean) => {
      const on = box.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      const b = bar.current;
      if (!b) return;
      if (!on) {
        b.style.opacity = '0';
        return;
      }
      const first = b.style.opacity !== '1';
      b.style.transition = instant || first ? 'none' : '';
      b.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop + on.offsetHeight + 3}px) scaleX(${on.offsetWidth})`;
      b.style.opacity = '1';
    };
    place(false);
    const onResize = () => place(true);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selected]);

  return (
    <div ref={box} className="relative flex flex-wrap gap-2">
      {values.map((value) => {
        const on = selected === value;
        const ok = inStock(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            disabled={!ok}
            onClick={() => onPick(value)}
            className={`opt tnum min-h-11 min-w-12 rounded-[var(--radius-control)] border px-3 font-semibold transition-colors ${
              on ? 'border-ink bg-ink text-paper' : 'border-line bg-paper text-ink'
            } disabled:border-dashed disabled:text-muted disabled:line-through`}
          >
            {value}
          </button>
        );
      })}
      <span aria-hidden="true" ref={bar} className="opt-bar" />
    </div>
  );
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
  // The previous value and the direction, for the rolling digit (purely visual).
  const [roll, setRoll] = useState<{ from: number; dir: 1 | -1 } | null>(null);
  const [added, setAdded] = useState(false);
  // Bumped on every add, so the check mark draws again.
  const [adds, setAdds] = useState(0);
  // The button says "Ajouté" for a moment, then offers to add again; the confirmation stays.
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 1800);
    return () => clearTimeout(t);
  }, [flash, adds]);
  const button = useRef<HTMLButtonElement>(null);

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

  function changeQuantity(dir: 1 | -1) {
    const next = Math.min(50, Math.max(1, quantity + dir));
    if (next === quantity) return;
    setRoll({ from: quantity, dir });
    setQuantity(next);
    setAdded(false);
  }

  function add() {
    if (!variant || soldOut) return;
    // State first: the cart is written and the counter updated before any animation starts.
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
    setFlash(true);
    setAdds((n) => n + 1);
    flyToCart(document.querySelector<HTMLElement>('[data-hero-visual]'), button.current);
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
            <OptionValues
              values={product.options[k] ?? []}
              selected={picked[k]}
              inStock={(value) => valueInStock(k, value)}
              onPick={(value) => {
                setPicked((p) => ({ ...p, [k]: value }));
                setAdded(false);
              }}
            />
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
            onClick={() => changeQuantity(-1)}
            className="size-11 text-xl disabled:text-line"
          >
            −
          </button>
          <output aria-live="polite" className="sr-only">
            {quantity}
          </output>
          {/* Two digits: the old one leaves, the new one arrives, in the button's direction. */}
          <span
            aria-hidden="true"
            className="tnum grid h-11 w-8 place-items-center overflow-hidden font-semibold"
          >
            {roll && (
              <span
                key={`from-${quantity}`}
                className={`col-start-1 row-start-1 ${roll.dir > 0 ? 'roll-out-up' : 'roll-out-down'}`}
              >
                {roll.from}
              </span>
            )}
            <span
              key={`to-${quantity}`}
              className={`col-start-1 row-start-1 ${roll ? (roll.dir > 0 ? 'roll-up' : 'roll-down') : ''}`}
            >
              {quantity}
            </span>
          </span>
          <button
            type="button"
            aria-label="Ajouter un"
            disabled={quantity >= 50}
            onClick={() => changeQuantity(1)}
            className="size-11 text-xl disabled:text-line"
          >
            +
          </button>
        </div>
      </div>

      <button
        ref={button}
        type="button"
        onClick={add}
        disabled={!variant || soldOut}
        className={`press tnum inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-5 text-lg font-semibold text-paper disabled:bg-mist disabled:text-muted ${
          flash ? 'bg-leaf' : 'bg-indigo'
        }`}
      >
        {flash ? (
          <>
            <svg
              key={adds}
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="check-draw size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path pathLength={1} d="M4.5 12.5l5 5 10-11" />
            </svg>
            Ajouté
          </>
        ) : soldOut ? (
          'Épuisé dans cette option'
        ) : missing.length > 0 ? (
          `Choisissez : ${missing.map(optionName).join(', ').toLowerCase()}`
        ) : (
          <span key={adds} className={adds > 0 ? 'swap-in' : undefined}>
            {`Ajouter au panier, ${formatMoney({ amount: (variant?.price.amount ?? 0) * quantity, currency: variant?.price.currency ?? 'XOF' })}`}
          </span>
        )}
      </button>

      {added && (
        <div className="open-rows" ref={revealStatus}>
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
        </div>
      )}
    </div>
  );
}
