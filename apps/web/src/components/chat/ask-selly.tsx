'use client';

import { useEffect, useState } from 'react';
import type { AskDetail } from '../storefront/ask-button';
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
  // Any "Demander à Selly" of the page (storefront/ask-button.tsx) opens this chat, about a product or not.
  const [about, setAbout] = useState<AskDetail>({ productId, productTitle });
  useEffect(() => {
    if (variant !== 'floating') return;
    const onAsk = (e: Event) => {
      setAbout((e as CustomEvent<AskDetail>).detail ?? {});
      setOpen(true);
    };
    window.addEventListener('selly:ask', onAsk);
    return () => window.removeEventListener('selly:ask', onAsk);
  }, [variant]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // The floating button opens a general chat; the inline one keeps its product.
          if (variant === 'floating') setAbout({});
          setOpen(true);
        }}
        data-ask-selly-trigger
        hidden={variant === 'floating' && open}
        aria-label={
          variant === 'floating' ? 'Parler à Selly, votre conseillère de boutique' : undefined
        }
        className={
          variant === 'floating'
            ? 'ask-float press fixed right-4 bottom-4 z-40 flex min-h-14 items-center gap-3 bg-[var(--sf-ink,#173b32)] px-4 text-d-paper sm:right-8 sm:bottom-7 sm:px-5'
            : 'sf-btn sf-btn-ghost'
        }
      >
        {variant === 'floating' ? (
          <>
            <img src="/brand/selly-s-light.png" alt="" className="w-6" />
            <span className="hidden text-left sm:block">
              <span className="block font-semibold">Parler à Selly</span>
              <span className="block text-sm text-d-paper/75">Votre conseillère de boutique</span>
            </span>
          </>
        ) : (
          <>
            <img src="/brand/selly-s.png" alt="" className="w-4" />
            Poser une question à Selly
          </>
        )}
      </button>

      {open && (
        <ChatPanel
          slug={slug}
          storeName={storeName}
          whatsappLink={whatsappLink}
          productId={about.productId}
          productTitle={about.productTitle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
