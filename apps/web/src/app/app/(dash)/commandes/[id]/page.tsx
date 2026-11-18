import type { Metadata } from 'next';
import { OrderDetail } from '@/components/dashboard/pages/orders';

export const metadata: Metadata = { title: 'Commande' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}
