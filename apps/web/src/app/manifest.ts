import type { MetadataRoute } from 'next';

/** The vendor dashboard as an installable app (architecture.md 3.4). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Selly, your shop',
    short_name: 'Selly',
    description: 'Orders, chats and stock of your Selly shop.',
    id: '/app',
    start_url: '/app',
    scope: '/app',
    display: 'standalone',
    background_color: '#f6f4f0',
    theme_color: '#f6f4f0',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
