import type { Metadata } from 'next';
import { WalletPage } from '@/components/dashboard/pages/wallet';

export const metadata: Metadata = { title: 'Portefeuille' };

export default function Page() {
  return <WalletPage />;
}
