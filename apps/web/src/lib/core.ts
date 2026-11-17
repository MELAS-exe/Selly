// Server components only: never import this file from a 'use client' module.
import { notFound } from 'next/navigation';
import type { CheckoutView, ProductDetail, StorePage } from './types';

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
export const getStore = (slug: string) =>
  get<StorePage>(`/api/v1/stores/${enc(slug)}`, { next: { revalidate: 30 } });

export const getProduct = (slug: string, product: string) =>
  get<ProductDetail>(`/api/v1/stores/${enc(slug)}/products/${enc(product)}`, {
    next: { revalidate: 30 },
  });

// Checkout: never cached.
export const getCheckout = (token: string) =>
  get<CheckoutView>(`/api/v1/checkout/${enc(token)}`, { cache: 'no-store' });
