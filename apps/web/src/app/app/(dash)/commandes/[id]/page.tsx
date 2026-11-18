'use client';

import { useParams } from 'next/navigation';
import { Orders } from '@/components/dashboard/orders';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return <Orders selectedId={id} />;
}
