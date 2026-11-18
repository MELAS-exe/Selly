import type { Metadata } from 'next';
import { Discussions } from '@/components/dashboard/pages/discussions';

export const metadata: Metadata = { title: 'Discussions' };

export default function Page() {
  return <Discussions />;
}
