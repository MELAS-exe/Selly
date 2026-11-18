import type { Metadata } from 'next';
import { Assistant } from '@/components/dashboard/pages/assistant';

export const metadata: Metadata = { title: 'Assistant' };

export default function Page() {
  return <Assistant />;
}
