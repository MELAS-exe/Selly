'use client';

import { type ReactNode, useState } from 'react';

/** Shares the shop (Web Share API), or copies its link, and says so. */
export function ShareButton({
  url,
  title,
  className,
  children,
}: {
  url: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const [said, setSaid] = useState('');
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={async () => {
          const full = new URL(url, window.location.origin).href;
          try {
            if (navigator.share) await navigator.share({ title, url: full });
            else {
              await navigator.clipboard.writeText(full);
              setSaid('Lien de la boutique copié');
              setTimeout(() => setSaid(''), 2400);
            }
          } catch {}
        }}
      >
        {children}
      </button>
      {said && (
        <span
          role="status"
          className="d-arrive fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 bg-d-ink px-5 py-3 font-medium text-d-paper"
        >
          {said}
        </span>
      )}
    </>
  );
}
