// Server components only: never import this file from a 'use client' module.
import { notFound } from 'next/navigation';
import type { CheckoutView, ProductDetail, ProductSummary, StorePage } from './types';
import type { PlansResponse } from './vendor-types';

// Server components call core directly. The browser goes through the /api/v1 rewrites in next.config.ts.
const CORE_URL = process.env.CORE_URL ?? 'http://localhost:4000';

export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`core answered ${status}${code ? ` (${code})` : ''}`);
  }
}

async function get<T>(path: string, init: RequestInit & { next?: { revalidate?: number } }) {
  const res = await fetch(`${CORE_URL}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...init.headers },
  });
  if (res.status === 404) notFound();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    throw new CoreError(res.status, body?.code);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

// Storefront: CDN 30 s in production (architecture.md 3.4); here, the Next.js data cache for 30 s.
export const getStore = (slug: string, query?: { category?: string; cursor?: string }) => {
  const qs = new URLSearchParams();
  if (query?.category) qs.set('category', query.category);
  if (query?.cursor) qs.set('cursor', query.cursor);
  const suffix = qs.size > 0 ? `?${qs}` : '';
  return get<StorePage>(`/api/v1/stores/${enc(slug)}${suffix}`, { next: { revalidate: 30 } });
};

/** Catalog search for the storefront (`q`, `category`): GET /stores/{slug}/products. */
export const searchProducts = (slug: string, query: { q?: string; category?: string }) => {
  const qs = new URLSearchParams();
  if (query.q) qs.set('q', query.q);
  if (query.category) qs.set('category', query.category);
  return get<{ data: ProductSummary[]; next_cursor: string | null }>(
    `/api/v1/stores/${enc(slug)}/products?${qs}`,
    { next: { revalidate: 30 } },
  );
};

export const getProduct = (slug: string, product: string) =>
  get<ProductDetail>(`/api/v1/stores/${enc(slug)}/products/${enc(product)}`, {
    next: { revalidate: 30 },
  });

// Pricing: prices live in the database and the rate moves, so the pricing page asks core every 5 minutes.
export const getPlans = () => get<PlansResponse>('/api/v1/plans', { next: { revalidate: 300 } });

// Checkout: never cached.
export const getCheckout = (token: string) =>
  get<CheckoutView>(`/api/v1/checkout/${enc(token)}`, { cache: 'no-store' });
