'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { countItems, readCart } from '@/lib/cart';

/** Cart link with a live count. Renders without the count on the server, then fills it in. */
export function CartButton({ slug }: { slug: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(countItems(readCart(slug)));
    sync();
    window.addEventListener('selly:cart', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('selly:cart', sync);
      window.removeEventListener('storage', sync);
    };
  }, [slug]);

  return (
    <Link
      href={`/s/${slug}/cart`}
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
        <span className="tnum grid min-w-6 place-items-center rounded-full bg-bissap px-1.5 text-sm text-paper">
          {count}
        </span>
      )}
    </Link>
  );
}
