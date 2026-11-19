'use client';

import { useEffect, useState } from 'react';
import { SellyMark } from '@/components/brand/selly-mark';
import { useT } from '../lang';
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
  const t = useT();
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
          variant === 'floating'
            ? t(
                'Parler à Selly, votre conseillère de boutique',
                'Talk to Selly, your shop assistant',
              )
            : undefined
        }
        className={
          variant === 'floating'
            ? 'ask-float press fixed right-4 bottom-4 z-40 flex min-h-14 items-center gap-3 bg-[var(--sf-ink,#173b32)] px-4 text-d-paper sm:right-8 sm:bottom-7 sm:px-5'
            : 'sf-btn sf-btn-ghost'
        }
      >
        {variant === 'floating' ? (
          <>
            <SellyMark className="w-6 text-[var(--sf-accent,#8aae4a)]" />
            <span className="hidden text-left sm:block">
              <span className="block font-semibold">{t('Parler à Selly', 'Talk to Selly')}</span>
              <span className="block text-sm text-d-paper/75">
                {t('Votre conseillère de boutique', 'Your shop assistant')}
              </span>
            </span>
          </>
        ) : (
          <>
            <SellyMark className="w-4 text-[var(--sf-accent-text,#173b32)]" />
            {t('Poser une question à Selly', 'Ask Selly a question')}
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
