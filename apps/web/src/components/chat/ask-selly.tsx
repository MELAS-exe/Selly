'use client';

import { useState } from 'react';
import { ChatPanel } from './chat-panel';

/**
 * The "Ask Selly" entry point (architecture.md 3.8): a floating button on every shop and product
 * page, and an inline "Ask a question" button on each product page that opens the same chat with
 * the product attached.
 */
export function AskSelly({
  slug,
  storeName,
  whatsappLink,
  productId,
  productTitle,
  variant = 'floating',
}: {
  slug: string;
  storeName: string;
  whatsappLink: string | null;
  productId?: string;
  productTitle?: string;
  variant?: 'floating' | 'inline';
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-ask-selly-trigger
        aria-label={variant === 'floating' ? 'Demander à Selly' : undefined}
        className={
          variant === 'floating'
            ? 'press fixed right-4 bottom-4 z-20 flex min-h-12 items-center gap-2 rounded-full bg-indigo px-5 font-semibold text-paper shadow-[0_8px_24px_rgb(22_26_51_/_0.28)]'
            : 'press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line px-4 font-semibold text-ink'
        }
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
          <path
            d="M12 3c-4.97 0-9 3.5-9 7.8 0 2.2 1.1 4.17 2.87 5.6L5 21l4.1-1.42c.93.24 1.9.37 2.9.37 4.97 0 9-3.5 9-7.8S16.97 3 12 3Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="8.5" cy="11" r="1" fill="currentColor" />
          <circle cx="12" cy="11" r="1" fill="currentColor" />
          <circle cx="15.5" cy="11" r="1" fill="currentColor" />
        </svg>
        {variant === 'floating' ? (
          <span className="hidden sm:inline">Demander à Selly</span>
        ) : (
          'Poser une question à Selly'
        )}
      </button>

      {open && (
        <ChatPanel
          slug={slug}
          storeName={storeName}
          whatsappLink={whatsappLink}
          productId={productId}
          productTitle={productTitle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
