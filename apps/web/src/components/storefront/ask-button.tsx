'use client';

import type { ReactNode } from 'react';

/** Detail of the "selly:ask" event: opens the shop's chat (AskSelly), about a product or not. */
export interface AskDetail {
  productId?: string;
  productTitle?: string;
}

export function askSelly(detail: AskDetail = {}) {
  window.dispatchEvent(new CustomEvent<AskDetail>('selly:ask', { detail }));
}

/**
 * Any "Demander à Selly" on the shop: a button that asks the one chat of the page (AskSelly, in the layout) to open.
 * Lets server components place the action anywhere without each mounting a chat.
 */
export function AskButton({
  children,
  className,
  productId,
  productTitle,
  label,
}: {
  children: ReactNode;
  className?: string;
  productId?: string;
  productTitle?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={className}
      onClick={() => askSelly({ productId, productTitle })}
    >
      {children}
    </button>
  );
}
