// The cart lives in localStorage, one per shop (architecture.md 3.4). The server re-prices it with a
// cart quote before showing a total: the prices kept here are only for display while the quote loads.

import type { Money, Options } from './types';

export interface CartLine {
  variant_id: string;
  product_slug: string;
  title: string;
  options: Options;
  unit_price: Money;
  quantity: number;
}

export const MAX_QTY = 50;
export const MAX_LINES = 20;

const key = (slug: string) => `selly:cart:${slug}`;

export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  const existing = lines.find((l) => l.variant_id === line.variant_id);
  if (existing) {
    return lines.map((l) =>
      l.variant_id === line.variant_id
        ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + line.quantity) }
        : l,
    );
  }
  if (lines.length >= MAX_LINES) return lines;
  return [...lines, { ...line, quantity: Math.min(MAX_QTY, Math.max(1, line.quantity)) }];
}

export function setQuantity(lines: CartLine[], variantId: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.variant_id !== variantId);
  return lines.map((l) =>
    l.variant_id === variantId ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l,
  );
}

export const countItems = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);

function isLine(x: unknown): x is CartLine {
  if (typeof x !== 'object' || x === null) return false;
  const l = x as Record<string, unknown>;
  return (
    typeof l.variant_id === 'string' &&
    typeof l.title === 'string' &&
    typeof l.quantity === 'number' &&
    Number.isInteger(l.quantity) &&
    l.quantity > 0
  );
}

/** Reads the cart. Anything malformed (an old version, a hand edit) is dropped, never trusted. */
export function readCart(slug: string, storage: Storage | undefined = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key(slug));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isLine).slice(0, MAX_LINES) : [];
  } catch {
    return [];
  }
}

export function writeCart(
  slug: string,
  lines: CartLine[],
  storage: Storage | undefined = globalThis.localStorage,
) {
  try {
    if (lines.length === 0) storage?.removeItem(key(slug));
    else storage?.setItem(key(slug), JSON.stringify(lines));
    globalThis.dispatchEvent?.(new CustomEvent('selly:cart', { detail: { slug } }));
  } catch {
    // Private mode or full storage: the cart just does not persist.
  }
}
