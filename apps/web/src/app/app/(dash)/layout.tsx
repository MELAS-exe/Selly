import type { Metadata } from 'next';
import { type ReactNode, Suspense } from 'react';
import { DashboardShell } from '@/components/dashboard/shell';

export const metadata: Metadata = {
  title: { default: 'Tableau de bord', template: '%s · Tableau de bord' },
  robots: { index: false },
};

// The dashboard reads ?demo (useSearchParams), so it renders in the browser under a Suspense boundary.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="selly-shell theme-paper-vermilion" />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
