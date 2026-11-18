import type { Metadata } from 'next';
import { Subscription } from '@/components/dashboard/pages/subscription';

export const metadata: Metadata = { title: 'Abonnement' };

export default function Page() {
  return <Subscription />;
}
