import type { Metadata } from 'next';
import { Discussions } from '@/components/dashboard/pages/discussions';

export const metadata: Metadata = { title: 'Discussion' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Discussions id={id} />;
}
