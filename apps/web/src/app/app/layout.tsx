import { Cormorant_Garamond, DM_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

// The landing page's two typefaces, self-hosted by next/font: the dashboard is an installed app on a mobile
// network, so no request to Google, and no flash of the wrong font.
const sans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-dash-sans',
  display: 'swap',
});
const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-dash-serif',
  display: 'swap',
});

export default function AppLayout({ children }: { children: ReactNode }) {
  return <div className={`${sans.variable} ${serif.variable}`}>{children}</div>;
}
