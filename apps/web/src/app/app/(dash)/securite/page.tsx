import type { Metadata } from 'next';
import { Security } from '@/components/dashboard/pages/security';

export const metadata: Metadata = { title: 'Sécurité' };

export default function Page() {
  return <Security />;
}
