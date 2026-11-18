import Link from 'next/link';
import type { ReactNode } from 'react';
// The landing page's paper and green design system (fonts, colours, paper grain, the S stamp).
import '../landing/landing.css';

/**
 * The frame for the public and sign-in pages: the same paper background, wordmark and hairlines as the landing page.
 * English content on an app whose root language is French, hence `lang="en"` here.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div
      lang="en"
      className="theme-paper-vermilion min-h-screen w-full flex flex-col selection:bg-[#E3342F] selection:text-[#F6F4F0]"
    >
      <header className="sticky top-0 z-40 py-4 backdrop-blur-xl backdrop-saturate-150 border-b bg-[#F6F4F0]/70 border-[#1111111f]">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex justify-between items-center gap-6">
          <Link href="/" aria-label="Selly, home" className="block">
            <img src="/brand/selly-wordmark.png" alt="Selly" className="h-7 md:h-8 w-auto" />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-6 md:gap-8">
            <Link
              href="/tarifs"
              className="pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/app/login"
              className="pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <div className="flex-1 w-full">{children}</div>
      <footer className="py-12 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-b border-[#1111111f] flex flex-col md:flex-row justify-between items-center gap-8">
        <img src="/brand/selly-wordmark.png" alt="Selly" className="h-9 w-auto" />
        <div className="flex gap-8 pv-sans text-[10px] uppercase tracking-widest text-black/50">
          <Link href="/tarifs" className="hover:text-[#173B32] transition-colors">
            Pricing
          </Link>
          <Link href="/app/login" className="hover:text-[#173B32] transition-colors">
            Get started
          </Link>
          <Link href="/aide/payer-en-bitcoin" className="hover:text-[#173B32] transition-colors">
            Get bitcoin
          </Link>
          <a href="mailto:hello@selly.app" className="hover:text-[#173B32] transition-colors">
            Contact
          </a>
        </div>
        <div className="pv-sans text-[10px] uppercase tracking-widest text-black/30">
          © 2025 SELLY
        </div>
      </footer>
    </div>
  );
}

/** A small label with the hairline in front, as used for section titles on the landing page. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-6 flex items-center gap-4">
      <span className="w-8 h-px bg-[#E3342F]" />
      {children}
    </p>
  );
}
