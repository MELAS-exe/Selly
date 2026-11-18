import { Cormorant_Garamond } from 'next/font/google';

// The landing page's serif, self-hosted by next/font (no request to Google, no layout shift), for the shop's
// titles and prices only. The rest of the shop stays on system fonts, light on a mobile network (architecture.md 3.4).
export const storefrontSerif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-sf-serif',
  display: 'swap',
});
