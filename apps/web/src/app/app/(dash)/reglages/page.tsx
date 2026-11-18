import type { Metadata } from 'next';
import { Settings } from '@/components/dashboard/pages/settings';

export const metadata: Metadata = { title: 'Réglages' };

export default function Page() {
  return <Settings />;
}
