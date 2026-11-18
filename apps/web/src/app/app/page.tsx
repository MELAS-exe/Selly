import type { Metadata } from 'next';
import { DraftDashboard } from '@/components/dashboard/draft-app';

export const metadata: Metadata = {
  title: 'Tableau de bord',
  robots: { index: false },
};

export default function DashboardPage() {
  return <DraftDashboard />;
}
