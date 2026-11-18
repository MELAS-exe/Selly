import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DraftStore } from '@/components/storefront/draft-store';
import { storefrontSerif } from '@/components/storefront/fonts';
// The CircleText spin (pv-spin) lives with the landing page's styles.
import '@/components/landing/landing.css';

export const metadata: Metadata = { title: 'Storefront draft', robots: { index: false } };

/** The Replit storefront draft, ported 1:1, for side-by-side comparison. Development only. */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div className={storefrontSerif.variable}>
      <DraftStore />
    </div>
  );
}
