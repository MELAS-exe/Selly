import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Selly',
  description: 'Boutiques en ligne payées en bitcoin, avec un assistant de vente.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="font-sans text-base text-neutral-900">{children}</body>
    </html>
  );
}
