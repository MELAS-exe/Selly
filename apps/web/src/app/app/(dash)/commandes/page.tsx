import type { Metadata } from 'next';
import { Orders } from '@/components/dashboard/pages/orders';

export const metadata: Metadata = { title: 'Commandes' };

export default function Page() {
  return <Orders />;
}
