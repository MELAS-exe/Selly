'use client';

import { type CSSProperties, Fragment, useEffect, useId, useRef, useState } from 'react';
import { SiteHeader } from '../brand/site-header';
import { LandingCursor } from './cursor';
import { landingMotion } from './motion';
import './landing.css';

/** Text on a circle. Each instance gets its own path id: three copies used to share id="circlePath". */
function CircleText({ className, d, text }: { className: string; d: string; text: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <path id={id} d={d} fill="none" />
      <text className="pv-sans text-[10px] uppercase tracking-[0.3em] pv-ink fill-current">
        <textPath href={`#${id}`} startOffset="0%">
          {text}
        </textPath>
      </text>
    </svg>
  );
}

/** Splits a sentence into words that light up one after the other while the quote scrolls by. */
function Lit({ text, from = 0 }: { text: string; from?: number }) {
  return text.split(' ').map((w, i) => (
    <Fragment key={i}>
      <span className="lit" style={{ '--w': from + i } as CSSProperties}>
        {w}
      </span>{' '}
    </Fragment>
  ));
}

/** A hero title line, with its light green copy on top: the line rolls over to it under the cursor (motion.ts). */
function FlipLine({ text, i, className = '' }: { text: string; i: number; className?: string }) {
  return (
    <span
      data-cursor="flip"
      className={`hero-line flip-line pointer-events-auto ${className}`}
      style={{ '--i': i } as CSSProperties}
    >
      <span className="flip-face">{text}</span>
      <span className="flip-face flip-alt" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}

const TOOLKIT = [
  {
    title: 'Your storefront',
    sub: 'A link made for sharing',
    text: 'Bring your products together in a clean shop customers can browse from any phone.',
    img: 'storefront',
  },
  {
    title: 'Live catalog',
    sub: 'Products and availability',
    text: 'Show what you sell and keep product details and stock easy to understand.',
    img: 'catalog',
  },
  {
    title: 'Sales assistant',
    sub: 'Helpful answers, instantly',
    text: 'Help customers find the right item and answer common questions while they shop.',
    img: 'assistant',
  },
  {
    title: 'Easy ordering',
    sub: 'From browse to order',
    text: 'Give shoppers a straightforward way to choose products and send you their order.',
    img: 'ordering',
  },
  {
    title: 'Stock-aware',
    sub: 'Availability at a glance',
    text: 'Keep customers informed about what is ready to order, so fewer conversations hit a dead end.',
    img: 'stock',
  },
  {
    title: 'Direct payments',
    sub: 'Lightning to your wallet',
    text: 'Accept fast Lightning payments directly to your wallet, without adding another step for your customers.',
    img: 'payments',
  },
];

/** A gallery photo in grayscale, with its colour copy that the cursor's lens uncovers (cursor.tsx). */
function GalleryPhoto({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="gal-par absolute inset-x-0 -inset-y-[6%] transition-[scale] duration-(--dur-ui) ease-(--ease-out-expo) group-hover:scale-105">
      <img alt={alt} className="gal-img w-full h-full object-cover" src={src} />
      <img alt="" aria-hidden="true" className="gal-color" src={src} />
    </div>
  );
}

const TICKER = [
  'One link to share',
  'Paid in bitcoin',
  'Stock that keeps itself',
  'An assistant that answers',
  'Straight to your wallet',
  'Made for Dakar',
];

export function Landing() {
  const [onDark, setOnDark] = useState(false);

  // Switch the header to its light variant while it overlaps a dark section.
  useEffect(() => {
    const update = () => {
      const probe = 44;
      const dark = Array.from(document.querySelectorAll<HTMLElement>('[data-dark-section]')).some(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.top <= probe && r.bottom >= probe;
        },
      );
      setOnDark(dark);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  // Hero products start their entrance once their picture has arrived (no pop-in on slow networks).
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const img of document.querySelectorAll<HTMLImageElement>('.hero-prop img')) {
      const ready = () => img.parentElement?.setAttribute('data-loaded', '');
      if (img.complete) ready();
      else {
        img.addEventListener('load', ready, { once: true });
        img.addEventListener('error', ready, { once: true });
        cleanups.push(() => img.removeEventListener('load', ready));
      }
    }
    return () => {
      for (const c of cleanups) c();
    };
  }, []);

  // Circular texts only turn while on screen.
  useEffect(() => {
    const spinners = Array.from(document.querySelectorAll<HTMLElement>('.pv-spin, .marquee-track'));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.toggleAttribute('data-offscreen', !e.isIntersecting);
    });
    for (const el of spinners) io.observe(el);
    return () => io.disconnect();
  }, []);

  // Every entrance and hover of the page (motion.ts).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => (rootRef.current ? landingMotion(rootRef.current) : undefined), []);

  return (
    <div
      ref={rootRef}
      className="theme-paper-vermilion min-h-screen w-full overflow-clip flex flex-col selection:bg-[#E3342F] selection:text-[#F6F4F0]"
    >
      <LandingCursor />
      <div aria-hidden="true" className="scroll-progress" />
      <SiteHeader onDark={onDark} />
      <section className="relative pt-64 pb-56 md:pt-32 md:pb-24 px-6 md:px-12 max-w-7xl mx-auto w-full min-h-[85vh] flex flex-col items-center justify-center border-x border-[#1111111f]">
        <div className="absolute inset-0 z-30 pointer-events-none overflow-clip">
          <div
            className="absolute inset-0 mix-blend-multiply opacity-[0.06]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='washi1'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23washi1)'/%3E%3C/svg%3E\")",
            }}
          ></div>
          <div
            className="absolute inset-0 mix-blend-multiply opacity-[0.04]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='washi2'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23washi2)'/%3E%3C/svg%3E\")",
            }}
          ></div>
          <div className="absolute bottom-0 left-0 right-0 h-12 md:h-48 bg-gradient-to-t from-[#F6F4F0] to-transparent"></div>
        </div>
        <div className="absolute inset-0 w-full h-full pointer-events-none overflow-clip md:overflow-visible">
          <div className="absolute top-24 md:top-[11%] left-2 md:left-[4%] w-36 h-36 md:w-56 md:h-56 hero-prop [--side:-1] [--d:300ms] [--float:7s] z-0 pointer-events-auto">
            <img
              alt="Leather handbag"
              className="w-full h-full object-contain drop-shadow-[0_20px_25px_rgba(0,0,0,0.15)] -rotate-12 hover:-rotate-[6deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/handbag.webp"
            />
          </div>
          <div className="absolute top-24 md:top-[13%] right-4 md:right-[6%] w-36 h-36 md:w-48 md:h-48 hero-prop [--side:1] [--d:380ms] [--float:6s] z-0 pointer-events-auto">
            <img
              alt="Smartphone"
              className="w-full h-full object-contain drop-shadow-[0_25px_35px_rgba(0,0,0,0.2)] rotate-15 hover:rotate-[21deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/smartphone.webp"
            />
          </div>
          <div className="absolute bottom-6 md:bottom-auto md:top-[60%] lg:top-[56%] left-0 md:left-[2%] w-36 h-28 md:w-40 md:h-40 lg:w-56 lg:h-56 hero-prop [--side:-1] [--d:460ms] [--float:8s] z-0 pointer-events-auto">
            <img
              alt="Sneaker"
              className="w-full h-full object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.25)] -rotate-[25deg] hover:-rotate-[19deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/sneaker.webp"
            />
          </div>
          <div className="absolute bottom-8 md:bottom-auto md:top-[59%] lg:top-[52%] right-3 md:right-[5%] w-20 h-20 md:w-28 md:h-28 lg:w-36 lg:h-36 hero-prop [--side:1] [--d:620ms] [--float:7.5s] z-0 pointer-events-auto">
            <img
              alt="Perfume bottle"
              className="w-full h-full object-contain drop-shadow-[0_10px_15px_rgba(0,0,0,0.05)] rotate-[35deg] hover:rotate-[41deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/perfume.webp"
            />
          </div>
        </div>
        <div className="relative z-10 w-full flex flex-col items-center text-center -mt-8 md:-mt-16 pointer-events-none">
          <div className="hero-circle hero-circle-in mb-8 relative w-24 h-24 md:w-32 md:h-32">
            <CircleText
              className="w-full h-full pv-spin motion-loop"
              d="M 60, 60 m -45, 0 a 45,45 0 1,1 90,0 a 45,45 0 1,1 -90,0"
              text="SELL ONLINE • YOUR SHOP • SELLY • "
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src="/brand/selly-s.png"
                alt=""
                className="w-9 md:w-12 h-auto animate-pv-stamp [--d:1000ms]"
              />
            </div>
          </div>
          <h1 className="split-wait pv-serif text-6xl md:text-8xl lg:text-[11rem] leading-[0.9] font-light tracking-[-0.02em] mb-8 mix-blend-normal">
            <FlipLine i={0} text="Your shop." />
            <FlipLine i={1} text="Your assistant." className="italic" />
            <FlipLine i={2} text="More sales." />
          </h1>
          <p className="hero-lede split-wait pv-sans text-sm md:text-base max-w-md leading-relaxed text-black/70 uppercase tracking-widest mb-16">
            Selly puts your catalog, a sales assistant, and direct payments in one simple link.
          </p>
          <div className="split-wait flex flex-col items-center gap-4">
            <div className="hero-rule w-px h-16 bg-[#111]"></div>
            <a
              href="/app/login"
              className="pv-sans text-xs uppercase tracking-[0.2em] font-medium pointer-events-auto hover:text-[#8AAE4A] transition-colors"
            >
              <span className="hero-cta-text">Create your shop</span>{' '}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-arrow-right inline ml-2 nudge motion-loop"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </a>
          </div>
        </div>
      </section>
      <div
        aria-hidden="true"
        className="marquee w-full max-w-7xl mx-auto overflow-clip border-x border-t border-[#1111111f] py-5"
      >
        <div className="marquee-track motion-loop flex w-max items-center gap-10 pv-serif italic text-3xl md:text-4xl">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="flex items-center gap-10 whitespace-nowrap">
              {t}
              <span className="not-italic text-[#8AAE4A] text-2xl">✦</span>
            </span>
          ))}
        </div>
      </div>
      <div className="w-full max-w-7xl mx-auto h-px bg-[#1111111f] relative">
        <div className="absolute top-0 left-0 w-full h-full bg-[#E3342F] animate-pv-line"></div>
      </div>
      <section className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f]">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-4">
            <h2 className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-4 flex items-center gap-4">
              <span data-anim="rule" className="w-8 h-px bg-[#E3342F]"></span>
              <span data-anim="chars">Why Selly</span>
            </h2>
          </div>
          <div className="md:col-span-8">
            <h3
              data-anim="lit"
              className="lit-quote pv-serif text-4xl md:text-6xl leading-tight font-light mb-12"
            >
              <Lit text='"A ready-to-share storefront, a helpful sales assistant, and' />
              <span className="italic text-[#8AAE4A]">
                <Lit text="payment" from={10} />
              </span>
              <Lit text='direct to your wallet."' from={11} />
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pv-sans text-sm leading-relaxed text-black/70">
              <p data-anim="lines">
                Set up a simple online shop for the products you already sell. Share one link on
                WhatsApp, Instagram, or wherever your customers find you.
              </p>
              <p data-anim="lines">
                Selly keeps your catalog and stock visible, helps customers choose what to order,
                and sends Lightning payments straight to your wallet.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section
        data-dark-section
        data-meet
        className="relative overflow-clip py-16 md:py-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-y border-[#1111111f] bg-[#111]"
      >
        {/* Selly's name, huge and outlined, sliding both ways behind the section as it scrolls by. */}
        <div
          aria-hidden="true"
          className="meet-ghost pointer-events-none absolute inset-0 flex flex-col justify-center gap-4 select-none"
        >
          <div className="meet-ghost-track pv-serif italic whitespace-nowrap">
            Selly · Selly · Selly · Selly ·
          </div>
          <div className="meet-ghost-track pv-serif whitespace-nowrap">
            Ask · Answer · Sell · Ask · Answer · Sell ·
          </div>
        </div>
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div className="order-2 md:order-1">
            <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-white/50 mb-8 flex items-center gap-4">
              <span data-anim="rule" className="w-8 h-px bg-white/50"></span>
              <span data-anim="chars">Your sales assistant</span>
            </div>
            <h2
              data-anim="words"
              className="pv-serif text-5xl md:text-7xl font-light text-white mb-6"
            >
              Meet <span className="italic text-[#a3c651]">Selly</span>
            </h2>
            <p
              data-anim="lines"
              className="pv-sans text-white/70 leading-relaxed mb-8 max-w-md text-sm"
            >
              Selly helps customers discover your products, check what is in stock, and place an
              order. You stay focused on your business while every conversation makes buying easier.
            </p>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-4 text-white hover:text-[#E3342F] transition-colors group"
            >
              <span data-anim="chars" className="pv-sans text-xs uppercase tracking-widest">
                See how it works
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-arrow-right group-hover:translate-x-2 transition-transform nudge motion-loop"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </a>
          </div>
          <div className="meet-panel order-1 md:order-2 h-[50vh] md:h-[80vh] relative bg-[#F6F4F0] overflow-clip">
            <span aria-hidden="true" className="meet-spark top-[14%] left-[16%] text-3xl">
              ✦
            </span>
            <span aria-hidden="true" className="meet-spark top-[22%] right-[14%] text-xl">
              ✦
            </span>
            <span aria-hidden="true" className="meet-spark bottom-[18%] left-[22%] text-2xl">
              ✦
            </span>
            <div className="meet-tilt w-full h-full">
              <div className="meet-float w-full h-full">
                <img
                  alt="Selly, your sales assistant"
                  className="meet-mascot w-full h-full object-contain p-8 md:p-12"
                  src="/brand/selly-mascot.webp"
                  width={800}
                  height={800}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
      <section
        id="how-it-works"
        className="py-20 md:py-40 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f] relative overflow-clip"
      >
        <img
          src="/brand/selly-s.png"
          alt=""
          className="absolute -left-24 top-1/2 -translate-y-1/2 w-[34rem] h-auto opacity-[0.04] pointer-events-none select-none"
        />
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16 md:mb-32">
            <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-6 flex items-center justify-center gap-4">
              <span data-anim="rule" className="w-8 h-px bg-[#E3342F]"></span>
              <span data-anim="chars">The Selly toolkit</span>
              <span data-anim="rule" className="w-8 h-px bg-[#E3342F]"></span>
            </div>
            <h2 data-anim="words" className="pv-serif text-5xl md:text-7xl font-light mb-6">
              Everything to sell
            </h2>
            <p
              data-anim="chars"
              className="pv-sans text-sm uppercase tracking-[0.2em] text-black/60"
            >
              One link. A smoother way to shop.
            </p>
          </div>
          <div className="flex flex-col relative md:min-h-[50vh] max-w-4xl mx-auto">
            {TOOLKIT.map((k, i) => (
              <div
                key={k.img}
                data-kit-row
                className="group flex flex-row gap-4 md:gap-10 items-start border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0"
              >
                <div className="flex items-start gap-3 md:gap-8 shrink-0 w-auto">
                  <div className="pt-2">
                    <span className="pv-sans text-[10px] uppercase tracking-[0.2em] kit-num tabular-nums inline-block text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-(--dur-ui)">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="kit-media relative overflow-clip aspect-[4/5] transition-[rotate] duration-(--dur-ui) ease-(--ease-out-expo) group-hover:-rotate-2 w-24 md:w-32 lg:w-40 shrink-0 bg-[#EAE7E0]">
                    <img
                      alt={k.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-[scale] duration-(--dur-ui) ease-(--ease-out-expo)"
                      src={`/landing/features/${k.img}.webp`}
                    />
                    <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                  <div className="lg:w-[40%]">
                    <h4 className="kit-title pv-serif text-xl md:text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-(--dur-ui)">
                      {k.title}
                    </h4>
                    <div className="kit-sub overflow-clip pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                      {k.sub}
                    </div>
                  </div>
                  <div className="lg:w-[60%]">
                    <p className="kit-text pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                      {k.text}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 md:mt-24 pt-10 md:pt-12 border-t border-[#1111111f] flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-4">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E3342F] pv-pulse motion-loop"></span>
              <span
                data-anim="chars"
                className="pv-sans text-[9px] uppercase tracking-[0.2em] font-medium"
              >
                Made for small businesses
              </span>
            </div>
            <p
              data-anim="lines"
              className="pv-sans text-xs text-black/60 uppercase tracking-widest text-center md:text-left"
            >
              Share your shop wherever your customers are. <br className="hidden md:block" /> No
              complicated setup required.
            </p>
            <p data-anim="words" className="pv-serif italic text-2xl">
              One simple link
            </p>
          </div>
        </div>
      </section>
      <section className="pb-20 pt-16 md:pb-32 md:pt-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-[#1111111f]">
        <div className="mb-16">
          <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-4 flex items-center gap-4">
            <span data-anim="rule" className="w-8 h-px bg-[#E3342F]"></span>
            <span data-anim="chars">A shop that is yours</span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
          <div className="md:col-span-12 h-[50vh] md:h-[70vh] gal-tile relative overflow-clip group">
            <GalleryPhoto alt="Art gallery hall" src="/landing/gallery/gallery.jpg" />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
            <div className="gal-card absolute bottom-6 left-6 bg-[#F6F4F0] bg-opacity-95 p-5 pr-12 border border-black/10 transition-transform duration-(--dur-ui) ease-(--ease-out-expo) group-hover:translate-x-2">
              <h3 className="pv-serif text-3xl mb-1 group-hover:text-[#8AAE4A] transition-colors duration-(--dur-ui)">
                Your online shop
              </h3>
              <p className="pv-sans text-[10px] uppercase tracking-[0.2em] text-black/60">
                A storefront customers can trust
              </p>
            </div>
          </div>
          <div className="md:col-span-8 h-[350px] md:h-[450px] gal-tile relative overflow-clip group">
            <GalleryPhoto alt="Seller packing an order" src="/landing/gallery/packaging.jpg" />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] gal-tile relative overflow-clip group">
            <GalleryPhoto alt="Boutique interior" src="/landing/gallery/boutique.jpg" />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] gal-tile relative overflow-clip group">
            <GalleryPhoto alt="Sneaker store" src="/landing/gallery/sneakers.jpg" />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-clip group">
            <div className="w-full h-full bg-[#EAE7E0] flex flex-col items-center justify-center p-6 md:p-8 text-center border border-[#1111111f] relative group-hover:bg-[#EAE7E0]/80 transition-colors duration-(--dur-ui) ease-(--ease-out-expo)">
              <div className="absolute top-0 left-0 w-full h-1 bg-[#E3342F] scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"></div>
              <img
                src="/brand/selly-mascot.webp"
                width={800}
                height={800}
                loading="lazy"
                decoding="async"
                alt=""
                className="w-20 h-20 md:w-28 md:h-28 object-contain mb-4 md:mb-8 opacity-90 group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              />
              <p data-anim="words" className="pv-serif text-2xl md:text-3xl italic leading-snug">
                "Simple to share. Easy to order."
              </p>
            </div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] gal-tile relative overflow-clip group">
            <GalleryPhoto alt="Wax-print fabric market" src="/landing/gallery/market.jpg" />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
        </div>
      </section>
      <section
        id="signup"
        className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-[#1111111f] relative overflow-clip bg-[#F6F4F0]"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8 items-start relative z-10">
          <div className="lg:col-span-5 flex flex-col justify-between h-full">
            <div>
              <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-8 flex items-center gap-4">
                <span data-anim="rule" className="w-8 h-px bg-[#E3342F]"></span>
                <span data-anim="chars">Get started</span>
              </div>
              <h2
                data-anim="words"
                className="pv-serif text-5xl md:text-7xl font-light leading-[1.1] mb-8"
              >
                Start your <br />
                <span className="italic text-[#8AAE4A]">Selly shop</span>
              </h2>
            </div>
            <div className="space-y-8 pv-sans text-xs uppercase tracking-widest text-black/70 mt-12 lg:mt-32">
              <div className="flex gap-6 group">
                <span className="step-line w-4 h-px bg-[#E3342F] mt-2 origin-left group-hover:scale-x-200 transition-transform duration-(--dur-ui)"></span>
                <div>
                  <div data-anim="chars" className="text-black font-medium mb-1">
                    Set up
                  </div>
                  <div>Start with your products</div>
                </div>
              </div>
              <div className="flex gap-6 group">
                <span className="step-line w-4 h-px bg-[#E3342F] mt-2 origin-left group-hover:scale-x-200 transition-transform duration-(--dur-ui)"></span>
                <div>
                  <div data-anim="chars" className="text-black font-medium mb-1">
                    Share
                  </div>
                  <div>WhatsApp, Instagram, anywhere</div>
                </div>
              </div>
              <div className="flex gap-6 group">
                <span className="step-line w-4 h-px bg-[#E3342F] mt-2 origin-left group-hover:scale-x-200 transition-transform duration-(--dur-ui)"></span>
                <div>
                  <div data-anim="chars" className="text-black font-medium mb-1">
                    Get paid
                  </div>
                  <div>Lightning payments to your wallet</div>
                </div>
              </div>
            </div>
          </div>
          <div className="hidden lg:flex lg:col-span-2 justify-center relative min-h-[400px]">
            <div className="w-px h-full bg-[#1111111f] absolute top-0 bottom-0"></div>
            <div className="w-32 h-32 absolute top-1/2 -translate-y-1/2 bg-[#F6F4F0] z-10 flex items-center justify-center">
              <CircleText
                className="w-full h-full pv-spin motion-loop"
                d="M 60, 60 m -42, 0 a 42,42 0 1,1 84,0 a 42,42 0 1,1 -84,0"
                text="START SELLING • YOUR SHOP • SELLY • "
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <img src="/brand/selly-s.png" alt="" className="w-9 h-auto" />
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 flex flex-col justify-center lg:pl-8 pt-4 lg:pt-0">
            <div className="mb-12">
              <p data-anim="lines" className="pv-sans text-sm leading-relaxed text-black/60 mb-6">
                Sign in with a Nostr key, name your shop and connect your wallet. Your shop is live
                in a few minutes, with a 14-day free trial.
              </p>
              <div className="inline-flex items-center gap-3 pv-sans text-[9px] uppercase tracking-[0.2em] px-4 py-2 border border-[#1111111f]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8AAE4A] pv-pulse motion-loop"></span>
                Built for sellers in Senegal
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <a
                href="/app/login"
                className="mt-6 relative overflow-clip group pv-sans text-xs uppercase tracking-[0.2em] font-medium border border-[#173B32] py-5 px-8 text-[#173B32] hover:text-[#F6F4F0] transition-colors duration-(--dur-ui) w-full text-center cursor-pointer"
              >
                <span className="relative z-10">
                  Create my shop{' '}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-arrow-right inline ml-2 nudge motion-loop"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14"></path>
                    <path d="m12 5 7 7-7 7"></path>
                  </svg>
                </span>
                <div className="absolute inset-0 bg-[#173B32] translate-y-[100%] group-hover:translate-y-0 transition-transform duration-(--dur-ui) ease-(--ease-out-expo) z-0"></div>
              </a>
              <p className="pv-sans text-xs text-black/50 text-center">
                Nothing to pay now.{' '}
                <a href="/tarifs" className="underline underline-offset-4 hover:text-[#173B32]">
                  See pricing
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>
      <footer className="py-12 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-b border-[#1111111f] flex flex-col md:flex-row justify-between items-center gap-8">
        <img src="/brand/selly-wordmark.png" alt="Selly" className="foot-mark h-9 w-auto" />
        <div className="flex gap-8 pv-sans text-[10px] uppercase tracking-widest text-black/50">
          <a href="/app/login" className="hover:text-[#173B32] transition-colors">
            Get started
          </a>
          <a href="/tarifs" className="hover:text-[#173B32] transition-colors">
            Pricing
          </a>
          <a href="#how-it-works" className="hover:text-[#173B32] transition-colors">
            How it works
          </a>
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
