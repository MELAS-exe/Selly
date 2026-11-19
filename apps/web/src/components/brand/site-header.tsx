'use client';

import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The header used on every public page (landing, pricing, sign-in, onboarding, the bitcoin guide): the wordmark on the
 * left, the links on the right (Home, Pricing, Sign in, Create your shop). Kept in one place so the links and styling
 * never drift between pages.
 *
 * Under md the links fold into a menu button: its three lines turn into an X and a panel covers the screen with the
 * links. The panel is rendered in the body, beside the header: the header's backdrop blur would otherwise clip it to
 * the bar.
 *
 * `onDark` switches to the light wordmark and a dark translucent bar, for the landing page's header while it overlaps
 * a dark section. Pages without dark sections never pass it.
 */

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/tarifs', label: 'Pricing' },
  { href: '/aide/payer-en-bitcoin', label: 'Pay with bitcoin', menuOnly: true },
  { href: '/app/login', label: 'Sign in' },
] as const;

const link =
  'pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors';

function Arrow({ size = 13 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline ml-1"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function SiteHeader({
  onDark = false,
  sticky = false,
}: {
  onDark?: boolean;
  sticky?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // The panel is paper: while it is open, the bar is the light one, whatever section it sits on.
  const dark = onDark && !open;

  useEffect(() => setMounted(true), []);

  // While open: the page behind does not scroll, Escape closes, and the menu closes if the screen grows past md.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const wide = matchMedia('(min-width: 768px)');
    const onWide = () => wide.matches && setOpen(false);
    window.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      root.style.overflow = before;
      window.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
      button.current?.focus();
    };
  }, [open]);

  return (
    <>
      <header
        data-dark={dark}
        className={`${sticky ? 'sticky' : 'fixed'} top-0 left-0 right-0 z-50 transition-colors duration-(--dur-ui) py-5 backdrop-blur-xl backdrop-saturate-150 border-b ${dark ? 'bg-[#111]/45 border-white/10' : 'bg-[#F6F4F0]/55 border-[#1111111f]'}`}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex justify-between items-center gap-6">
          <a
            href="/"
            aria-label="Selly, home"
            className="pv-serif text-2xl font-bold tracking-widest uppercase flex items-center"
          >
            <span className="relative block">
              <img
                src="/brand/selly-wordmark.png"
                alt="Selly"
                className={`h-7 md:h-8 w-auto transition-opacity duration-(--dur-ui) ${dark ? 'opacity-0' : 'opacity-100'}`}
              />
              <img
                src="/brand/selly-wordmark-light.png"
                alt=""
                aria-hidden="true"
                className={`absolute inset-0 h-7 md:h-8 w-auto transition-opacity duration-(--dur-ui) ${dark ? 'opacity-100' : 'opacity-0'}`}
              />
            </span>
          </a>

          <nav aria-label="Main" className="hidden md:flex items-center gap-8">
            {LINKS.filter((l) => !('menuOnly' in l)).map((l) => (
              <a key={l.label} href={l.href} className={link}>
                {l.label}
              </a>
            ))}
            <a href="/app/login" className={link}>
              Create your shop <Arrow />
            </a>
          </nav>

          <button
            ref={button}
            type="button"
            aria-label={open ? 'Close the menu' : 'Open the menu'}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="site-burger md:hidden relative -mr-2 grid size-11 place-items-center"
            data-open={open}
          >
            <span aria-hidden="true" className="site-burger-line" />
            <span aria-hidden="true" className="site-burger-line" />
            <span aria-hidden="true" className="site-burger-line" />
          </button>
        </div>
      </header>

      {mounted &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            data-open={open}
            inert={!open}
            className="site-menu md:hidden fixed inset-0 z-40 flex flex-col bg-[#F6F4F0] text-[#173B32] px-6 pt-28 pb-10 overflow-y-auto"
          >
            <nav aria-label="Menu" className="flex-1">
              <ol className="border-t border-[#173B32]/15">
                {LINKS.map((l, i) => (
                  <li
                    key={l.label}
                    className="site-menu-item border-b border-[#173B32]/15"
                    style={{ '--i': i } as CSSProperties}
                  >
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="flex items-baseline gap-4 py-5 pv-serif text-[2.5rem] leading-none font-light hover:text-[#719541] transition-colors"
                    >
                      <span className="pv-sans text-xs tracking-widest text-[#719541] tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <a
              href="/app/login"
              onClick={() => setOpen(false)}
              className="site-menu-item mt-10 flex items-center justify-center gap-2 bg-[#173B32] px-6 py-5 pv-sans text-xs uppercase tracking-[0.2em] font-medium text-[#F6F4F0]"
              style={{ '--i': LINKS.length } as CSSProperties}
            >
              Create your shop <Arrow size={14} />
            </a>
            <p
              className="site-menu-item mt-6 text-center pv-sans text-[10px] uppercase tracking-widest text-[#173B32]/50"
              style={{ '--i': LINKS.length + 1 } as CSSProperties}
            >
              Your shop · Your assistant · More sales
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
