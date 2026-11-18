import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard/shell';
import '@/components/dashboard/dashboard.css';

export const metadata: Metadata = {
  title: { default: 'Dashboard', template: '%s | Selly' },
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: '#f6f4f0' };

/** The vendor dashboard: a client-side app behind the session cookie (architecture.md 3.4). */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
