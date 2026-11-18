import type { Metadata } from 'next';
import { Drafts } from '@/components/dashboard/pages/drafts';

export const metadata: Metadata = { title: 'Brouillons photo' };

export default function Page() {
  return <Drafts />;
}
