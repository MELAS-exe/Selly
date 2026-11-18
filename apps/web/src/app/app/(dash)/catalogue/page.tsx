import type { Metadata } from 'next';
import { Catalogue } from '@/components/dashboard/pages/catalogue';

export const metadata: Metadata = { title: 'Catalogue' };

export default function Page() {
  return <Catalogue />;
}
