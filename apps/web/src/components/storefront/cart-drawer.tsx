'use client';

// The shop's cart, in a drawer: the real cart of this shop (lib/cart.ts, localStorage), with quantities and an
// indicative subtotal. The exact total (delivery, rate in sats) comes from core when the order is made; until the
// cart page exists, "Commander" hands the cart to Selly in the chat, which creates orders (architecture.md 6.2).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CartLine, countItems, readCart, setQuantity, writeCart } from '@/lib/cart';
import { formatMoney, formatOptions } from '@/lib/format';
import { durationToken, motionToken, prefersReducedMotion } from '../motion/tokens';
import { askSelly } from './ask-button';
import { MessageCircle, Minus, Plus, ShoppingBag, X } from './draft-icons';

export function CartDrawer({ slug }: { slug: string }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const badge = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const count = countItems(lines);
  const subtotal = lines.reduce((s, l) => s + l.unit_price.amount * l.quantity, 0);
  const currency = lines[0]?.unit_price.currency ?? 'XOF';

  useEffect(() => {
    const sync = () => setLines(readCart(slug));
    const changed = () => {
      sync();
      // Bounce when the flying photo lands (fly-to-cart), or at once.
      setTimeout(() => {
        if (prefersReducedMotion()) return;
        const bounce = () =>
          badge.current?.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }], {
            duration: durationToken('--dur-ui'),
            easing: motionToken('--ease-snap'),
          });
        const flight = document.querySelector('[data-cart-flight]')?.getAnimations()[0];
        if (flight) flight.finished.then(bounce, bounce);
        else bounce();
      });
    };
    sync();
    window.addEventListener('selly:cart', changed);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('selly:cart', changed);
      window.removeEventListener('storage', sync);
    };
  }, [slug]);

  // Escape closes; focus goes into the drawer and back to the cart button.
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener.current?.focus();
    };
  }, [open]);

  const change = (line: CartLine, quantity: number) =>
    writeCart(slug, setQuantity(readCart(slug), line.variant_id, quantity));

  return (
    <>
      <button
        ref={opener}
        type="button"
        data-cart-target
        className="sf-icon-btn relative"
        onClick={() => setOpen(true)}
        aria-label={
          count > 0
            ? `Ouvrir le panier, ${count} article${count > 1 ? 's' : ''}`
            : 'Ouvrir le panier'
        }
      >
        <ShoppingBag size={19} strokeWidth={1.6} />
        {count > 0 && (
          <span
            ref={badge}
            className="tnum absolute -top-2 -right-2 grid h-5 min-w-5 place-items-center bg-[var(--sf-accent)] px-1 text-xs font-bold text-d-ink"
          >
            {count}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            className="sf-backdrop fixed inset-0 z-[70] flex justify-end bg-d-ink/35"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cart-title"
              className="sf-drawer flex h-full w-full max-w-[440px] flex-col border-l border-d-hairline bg-d-paper text-[var(--sf-ink)]"
            >
              <header className="flex items-center justify-between border-b border-d-hairline px-5 py-5">
                <div>
                  <p className="sf-eyebrow">Votre sélection</p>
                  <h2 id="cart-title" className="sf-serif mt-1 text-3xl">
                    Le panier <span className="tnum text-xl text-d-ink-soft">({count})</span>
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fermer le panier"
                  className="sf-icon-btn"
                >
                  <X size={19} />
                </button>
              </header>
              {count === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
                  <img
                    src="/brand/selly-mascot.webp"
                    alt=""
                    width={800}
                    height={800}
                    className="size-28 object-contain"
                  />
                  <p className="sf-serif mt-5 text-2xl">Votre panier est tout neuf</p>
                  <p className="mt-2 max-w-64 text-d-ink-soft">
                    Ajoutez une trouvaille de la sélection pour la garder sous la main.
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="sf-btn sf-btn-primary mt-6"
                  >
                    Continuer la visite
                  </button>
                </div>
              ) : (
                <>
                  <ul className="flex-1 overflow-y-auto px-5">
                    {lines.map((l) => (
                      <li key={l.variant_id} className="flex gap-4 border-b border-d-hairline py-4">
                        <div className="min-w-0 flex-1">
                          <a
                            href={`/s/${slug}/p/${l.product_slug}`}
                            className="sf-serif text-xl font-semibold hover:underline"
                          >
                            {l.title}
                          </a>
                          {Object.keys(l.options).length > 0 && (
                            <p className="text-d-ink-soft">{formatOptions(l.options)}</p>
                          )}
                          <p className="sf-figure text-lg">{formatMoney(l.unit_price)}</p>
                          <div className="mt-2 flex w-fit items-center border border-d-hairline">
                            <button
                              type="button"
                              aria-label={`Retirer un ${l.title}`}
                              onClick={() => change(l, l.quantity - 1)}
                              className="grid size-11 place-items-center"
                            >
                              <Minus size={15} />
                            </button>
                            <span className="tnum w-8 text-center font-semibold" aria-live="polite">
                              {l.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Ajouter un ${l.title}`}
                              onClick={() => change(l, l.quantity + 1)}
                              disabled={l.quantity >= 50}
                              className="grid size-11 place-items-center disabled:opacity-35"
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Retirer ${l.title} du panier`}
                          onClick={() => change(l, 0)}
                          className="grid size-11 place-items-center self-start text-d-ink-soft hover:text-d-alert"
                        >
                          <X size={17} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-d-hairline p-5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-d-ink-soft">Sous-total</span>
                      <span className="sf-figure text-3xl">
                        {formatMoney({ amount: subtotal, currency })}
                      </span>
                    </div>
                    <p className="mt-2 text-[0.9375rem] text-d-ink-soft">
                      La livraison et le montant en sats sont calculés au moment de commander.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        askSelly();
                      }}
                      className="sf-btn sf-btn-primary mt-4 w-full"
                    >
                      Commander avec Selly <MessageCircle size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          // The header has a backdrop-filter, which would trap a fixed child: render at the shop's root.
          document.querySelector('.sf') ?? document.body,
        )}
    </>
  );
}
