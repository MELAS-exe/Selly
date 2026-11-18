import type { Metadata } from 'next';
import { Overview } from '@/components/dashboard/pages/overview';

export const metadata: Metadata = { title: 'Accueil' };

export default function Page() {
  return <Overview />;
}
