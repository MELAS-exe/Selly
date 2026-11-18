import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DraftStore } from '@/components/storefront/draft-store';

export const metadata: Metadata = { title: 'Storefront draft', robots: { index: false } };

/** The Replit storefront draft, ported 1:1, for side-by-side comparison. Development only. */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DraftStore />;
}
