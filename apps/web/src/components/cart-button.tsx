'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { countItems, readCart } from '@/lib/cart';
import { durationToken, motionToken, prefersReducedMotion } from './motion/tokens';

/**
 * Cart link with a live count. Renders without the count on the server, then fills it in.
 * On a change the number rolls, and the badge bounces when the flying photo lands (right away
 * if nothing is flying). The count and the label are always current; only the bounce waits.
 */
export function CartButton({ slug }: { slug: string }) {
  const [count, setCount] = useState(0);
  const [dir, setDir] = useState<1 | -1 | 0>(0);
  const [bump, setBump] = useState(0);
  const badge = useRef<HTMLSpanElement>(null);

  const last = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => {
      const n = countItems(readCart(slug));
      if (last.current !== null && n !== last.current) setDir(n > last.current ? 1 : -1);
      last.current = n;
      setCount(n);
    };
    const changed = () => {
      sync();
      // The add button starts the flight right after writing the cart: look on the next task.
      setTimeout(() => {
        const flight = document.querySelector('[data-cart-flight]')?.getAnimations()[0];
        const land = () => setBump((b) => b + 1);
        if (flight) flight.finished.then(land, land);
        else land();
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

  useEffect(() => {
    if (bump === 0 || prefersReducedMotion()) return;
    badge.current?.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }], {
      duration: durationToken('--dur-ui'),
      easing: motionToken('--ease-snap'),
    });
  }, [bump]);

  return (
    <Link
      href={`/s/${slug}/cart`}
      data-cart-target
      className="relative inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] bg-paper px-3 font-semibold text-ink"
      aria-label={count > 0 ? `Panier, ${count} article${count > 1 ? 's' : ''}` : 'Panier'}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M5 7h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 7Z" />
        <path d="M9 7V6a3 3 0 0 1 6 0v1" />
      </svg>
      Panier
      {count > 0 && (
        <span
          ref={badge}
          className="tnum grid min-w-6 place-items-center overflow-hidden rounded-full bg-bissap px-1.5 text-sm text-paper"
        >
          <span key={count} className={dir > 0 ? 'roll-up' : dir < 0 ? 'roll-down' : undefined}>
            {count}
          </span>
        </span>
      )}
    </Link>
  );
}
