'use client';

import { useEffect, useId, useState } from 'react';
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
    const spinners = Array.from(document.querySelectorAll<HTMLElement>('.pv-spin'));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.toggleAttribute('data-offscreen', !e.isIntersecting);
    });
    for (const el of spinners) io.observe(el);
    return () => io.disconnect();
  }, []);

  // Scroll reveals: CSS scroll-driven animations where supported (landing.css), else this.
  useEffect(() => {
    if (CSS.supports('animation-timeline: view()')) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal-on-scroll'));
    const hidden = 'opacity-0 translate-y-8'.split(' ');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.remove(...hidden);
          entry.target.classList.add('opacity-100', 'translate-y-0');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );
    for (const el of els) {
      if (el.getBoundingClientRect().top < window.innerHeight) continue;
      el.classList.remove('opacity-100');
      el.classList.add(...hidden);
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="theme-paper-vermilion min-h-screen w-full overflow-hidden flex flex-col selection:bg-[#E3342F] selection:text-[#F6F4F0]">
      <header
        data-dark={onDark}
        className="fixed top-0 left-0 right-0 z-50 transition-colors duration-(--dur-ui) py-8"
      >
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex justify-between items-center">
          <div className="pv-serif text-2xl font-bold tracking-widest uppercase flex items-center gap-2">
            <span className="relative block">
              <img
                src="/brand/selly-wordmark.png"
                alt="Selly"
                className={`h-7 md:h-8 w-auto transition-opacity duration-(--dur-ui) ${onDark ? 'opacity-0' : 'opacity-100'}`}
              />
              <img
                src="/brand/selly-wordmark-light.png"
                alt=""
                aria-hidden="true"
                className={`absolute inset-0 h-7 md:h-8 w-auto transition-opacity duration-(--dur-ui) ${onDark ? 'opacity-100' : 'opacity-0'}`}
              />
            </span>
          </div>
          <a
            href="#signup"
            className="pv-sans text-xs uppercase tracking-widest font-medium hover:text-[#719541] transition-colors"
          >
            Create your shop{' '}
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
              className="lucide lucide-arrow-right inline ml-1"
              aria-hidden="true"
            >
              <path d="M5 12h14"></path>
              <path d="m12 5 7 7-7 7"></path>
            </svg>
          </a>
        </div>
      </header>
      <section className="relative pt-24 pb-20 md:pt-32 md:pb-24 px-6 md:px-12 max-w-7xl mx-auto w-full min-h-[85vh] flex flex-col items-center justify-center border-x border-[#1111111f]">
        <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
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
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#F6F4F0] to-transparent"></div>
        </div>
        <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden md:overflow-visible">
          <div className="absolute top-[6%] left-[-5%] md:left-[10%] w-48 h-48 md:w-64 md:h-64 hero-prop [--side:-1] [--d:300ms] [--float:7s] z-0 pointer-events-auto">
            <img
              alt="Leather handbag"
              className="w-full h-full object-contain drop-shadow-[0_20px_25px_rgba(0,0,0,0.15)] -rotate-12 hover:-rotate-[6deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/handbag.webp"
            />
          </div>
          <div className="absolute top-[12%] right-[-5%] md:right-[15%] w-40 h-40 md:w-56 md:h-56 hero-prop [--side:1] [--d:380ms] [--float:6s] z-20 pointer-events-auto">
            <img
              alt="Smartphone"
              className="w-full h-full object-contain drop-shadow-[0_25px_35px_rgba(0,0,0,0.2)] rotate-15 hover:rotate-[21deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/smartphone.webp"
            />
          </div>
          <div className="absolute bottom-[20%] left-0 md:left-[15%] w-56 h-56 md:w-72 md:h-72 hero-prop [--side:-1] [--d:460ms] [--float:8s] z-20 pointer-events-auto">
            <img
              alt="Sneaker"
              className="w-full h-full object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.25)] -rotate-[25deg] hover:-rotate-[19deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/sneaker.webp"
            />
          </div>
          <div className="absolute bottom-[10%] right-[10%] w-32 h-32 md:w-48 md:h-48 hero-prop [--side:1] [--d:540ms] [--float:6.5s] z-0 pointer-events-auto">
            <img
              alt="Folded shirt"
              className="w-full h-full object-contain drop-shadow-[0_15px_20px_rgba(0,0,0,0.1)] rotate-6 hover:rotate-[12deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/garment.webp"
            />
          </div>
          <div className="absolute top-[45%] right-[-10%] md:right-[5%] w-32 h-32 md:w-40 md:h-40 hero-prop [--side:1] [--d:620ms] [--float:7.5s] z-0 pointer-events-auto">
            <img
              alt="Perfume bottle"
              className="w-full h-full object-contain drop-shadow-[0_10px_15px_rgba(0,0,0,0.05)] rotate-[35deg] hover:rotate-[41deg] hover:scale-[1.03] transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              src="/landing/products/perfume.webp"
            />
          </div>
        </div>
        <div className="relative z-10 w-full flex flex-col items-center text-center -mt-8 md:-mt-16 pointer-events-none">
          <div className="mb-8 relative w-24 h-24 md:w-32 md:h-32 animate-pv-fade-up">
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
          <h1 className="pv-serif text-6xl md:text-8xl lg:text-[11rem] leading-[0.9] font-light tracking-[-0.02em] mb-8 mix-blend-normal">
            <span className="hero-line [--i:0]">Your shop.</span>
            <span className="hero-line italic [--i:1]">Your assistant.</span>
            <span className="hero-line [--i:2]">More sales.</span>
          </h1>
          <p className="pv-sans text-sm md:text-base max-w-md leading-relaxed text-black/70 uppercase tracking-widest mb-16 animate-pv-fade-up [--d:420ms]">
            Selly puts your catalog, a sales assistant, and direct payments in one simple link.
          </p>
          <div className="flex flex-col items-center gap-4 animate-pv-fade-up [--d:520ms]">
            <div className="w-px h-16 bg-[#111]"></div>
            <a
              href="#signup"
              className="pv-sans text-xs uppercase tracking-[0.2em] font-medium pointer-events-auto hover:text-[#8AAE4A] transition-colors"
            >
              Create your shop{' '}
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
                className="lucide lucide-arrow-right inline ml-2"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </a>
          </div>
        </div>
      </section>
      <div className="w-full max-w-7xl mx-auto h-px bg-[#1111111f] relative">
        <div className="absolute top-0 left-0 w-full h-full bg-[#E3342F] animate-pv-line"></div>
      </div>
      <section className="py-32 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f]">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-4 reveal-on-scroll opacity-100">
            <h2 className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-4 flex items-center gap-4">
              <span className="w-8 h-px bg-[#E3342F]"></span>Why Selly
            </h2>
          </div>
          <div className="md:col-span-8 reveal-on-scroll [--d:75ms] opacity-100">
            <h3 className="pv-serif text-4xl md:text-6xl leading-tight font-light mb-12">
              "A ready-to-share storefront, a helpful sales assistant, and{' '}
              <span className="italic text-[#8AAE4A]">payment</span> direct to your wallet."
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pv-sans text-sm leading-relaxed text-black/70">
              <p>
                Set up a simple online shop for the products you already sell. Share one link on
                WhatsApp, Instagram, or wherever your customers find you.
              </p>
              <p>
                Selly keeps your catalog and stock visible, helps customers choose what to order,
                and sends Lightning payments straight to your wallet.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section
        data-dark-section
        className="py-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-y border-[#1111111f] bg-[#111]"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div className="order-2 md:order-1 reveal-on-scroll opacity-100">
            <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-white/50 mb-8 flex items-center gap-4">
              <span className="w-8 h-px bg-white/50"></span>Your sales assistant
            </div>
            <h2 className="pv-serif text-5xl md:text-7xl font-light text-white mb-6">
              Meet <span className="italic">Selly</span>
            </h2>
            <p className="pv-sans text-white/70 leading-relaxed mb-8 max-w-md text-sm">
              Selly helps customers discover your products, check what is in stock, and place an
              order. You stay focused on your business while every conversation makes buying easier.
            </p>
            <div className="inline-flex items-center gap-4 text-white hover:text-[#E3342F] transition-colors cursor-pointer group">
              <span className="pv-sans text-xs uppercase tracking-widest">See how it works</span>
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
                className="lucide lucide-arrow-right group-hover:translate-x-2 transition-transform"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </div>
          </div>
          <div className="order-1 md:order-2 h-[50vh] md:h-[80vh] relative bg-[#F6F4F0] reveal-on-scroll [--d:75ms] opacity-100">
            <img
              alt="Selly, your sales assistant"
              className="w-full h-full object-contain p-8 md:p-12"
              src="/brand/selly-mascot.webp"
              width={800}
              height={800}
              loading="lazy"
              decoding="async"
            />
            <div className="absolute top-0 right-0 w-32 h-32 md:w-48 md:h-48 translate-x-1/2 -translate-y-1/2 hidden md:block">
              <CircleText
                className="w-full h-full pv-spin motion-loop"
                d="M 60, 60 m -45, 0 a 45,45 0 1,1 90,0 a 45,45 0 1,1 -90,0"
                text="YOUR SALES ASSISTANT • READY TO HELP • "
              />
            </div>
          </div>
        </div>
      </section>
      <section className="py-40 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f] relative overflow-hidden">
        <img
          src="/brand/selly-s.png"
          alt=""
          className="absolute -left-24 top-1/2 -translate-y-1/2 w-[34rem] h-auto opacity-[0.04] pointer-events-none select-none"
        />
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-32 reveal-on-scroll opacity-100">
            <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-6 flex items-center justify-center gap-4">
              <span className="w-8 h-px bg-[#E3342F]"></span>The Selly toolkit
              <span className="w-8 h-px bg-[#E3342F]"></span>
            </div>
            <h2 className="pv-serif text-5xl md:text-7xl font-light mb-6">Everything to sell</h2>
            <p className="pv-sans text-sm uppercase tracking-[0.2em] text-black/60">
              One link. A smoother way to shop.
            </p>
          </div>
          <div className="flex flex-col relative min-h-[50vh] max-w-4xl mx-auto">
            <div className="group flex flex-col md:flex-row gap-6 md:gap-10 items-start reveal-on-scroll border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0 opacity-100">
              <div className="flex items-start gap-6 md:gap-8 shrink-0 w-full md:w-auto">
                <div className="pt-2">
                  <span className="pv-sans text-[10px] uppercase tracking-[0.2em] kit-num inline-block text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-(--dur-ui)">
                    01
                  </span>
                </div>
                <div className="kit-media relative overflow-hidden aspect-[4/5] w-24 md:w-32 lg:w-40 shrink-0 bg-[#EAE7E0]">
                  <img
                    alt="Your storefront"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-(--ease-out-expo)-expo)"
                    src="/landing/features/storefront.webp"
                  />
                  <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                <div className="lg:w-[40%]">
                  <h4 className="pv-serif text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-(--dur-ui)">
                    Your storefront
                  </h4>
                  <div className="pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                    A link made for sharing
                  </div>
                </div>
                <div className="lg:w-[60%]">
                  <p className="pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                    Bring your products together in a clean shop customers can browse from any
                    phone.
                  </p>
                </div>
              </div>
            </div>
            <div className="group flex flex-col md:flex-row gap-6 md:gap-10 items-start reveal-on-scroll border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0 opacity-100">
              <div className="flex items-start gap-6 md:gap-8 shrink-0 w-full md:w-auto">
                <div className="pt-2">
                  <span className="pv-sans text-[10px] uppercase tracking-[0.2em] kit-num inline-block text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-(--dur-ui)">
                    02
                  </span>
                </div>
                <div className="kit-media relative overflow-hidden aspect-[4/5] w-24 md:w-32 lg:w-40 shrink-0 bg-[#EAE7E0]">
                  <img
                    alt="Live catalog"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-(--ease-out-expo)-expo)"
                    src="/landing/features/catalog.webp"
                  />
                  <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                <div className="lg:w-[40%]">
                  <h4 className="pv-serif text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-(--dur-ui)">
                    Live catalog
                  </h4>
                  <div className="pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                    Products and availability
                  </div>
                </div>
                <div className="lg:w-[60%]">
                  <p className="pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                    Show what you sell and keep product details and stock easy to understand.
                  </p>
                </div>
              </div>
            </div>
            <div className="group flex flex-col md:flex-row gap-6 md:gap-10 items-start reveal-on-scroll border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0 opacity-100">
              <div className="flex items-start gap-6 md:gap-8 shrink-0 w-full md:w-auto">
                <div className="pt-2">
                  <span className="pv-sans text-[10px] uppercase tracking-[0.2em] kit-num inline-block text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-(--dur-ui)">
                    03
                  </span>
                </div>
                <div className="kit-media relative overflow-hidden aspect-[4/5] w-24 md:w-32 lg:w-40 shrink-0 bg-[#EAE7E0]">
                  <img
                    alt="Sales assistant"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-(--ease-out-expo)-expo)"
                    src="/landing/features/assistant.webp"
                  />
                  <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                <div className="lg:w-[40%]">
                  <h4 className="pv-serif text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-(--dur-ui)">
                    Sales assistant
                  </h4>
                  <div className="pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                    Helpful answers, instantly
                  </div>
                </div>
                <div className="lg:w-[60%]">
                  <p className="pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                    Help customers find the right item and answer common questions while they shop.
                  </p>
                </div>
              </div>
            </div>
            <div className="group flex flex-col md:flex-row gap-6 md:gap-10 items-start reveal-on-scroll border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0 opacity-100">
              <div className="flex items-start gap-6 md:gap-8 shrink-0 w-full md:w-auto">
                <div className="pt-2">
                  <span className="pv-sans text-[10px] uppercase tracking-[0.2em] kit-num inline-block text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-(--dur-ui)">
                    04
                  </span>
                </div>
                <div className="kit-media relative overflow-hidden aspect-[4/5] w-24 md:w-32 lg:w-40 shrink-0 bg-[#EAE7E0]">
                  <img
                    alt="Easy ordering"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-(--ease-out-expo)-expo)"
                    src="/landing/features/ordering.webp"
                  />
                  <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                <div className="lg:w-[40%]">
                  <h4 className="pv-serif text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-(--dur-ui)">
                    Easy ordering
                  </h4>
                  <div className="pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                    From browse to order
                  </div>
                </div>
                <div className="lg:w-[60%]">
                  <p className="pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                    Give shoppers a straightforward way to choose products and send you their order.
                  </p>
                </div>
              </div>
            </div>
            <div className="group flex flex-col md:flex-row gap-6 md:gap-10 items-start reveal-on-scroll border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0 opacity-100">
              <div className="flex items-start gap-6 md:gap-8 shrink-0 w-full md:w-auto">
                <div className="pt-2">
                  <span className="pv-sans text-[10px] uppercase tracking-[0.2em] kit-num inline-block text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-(--dur-ui)">
                    05
                  </span>
                </div>
                <div className="kit-media relative overflow-hidden aspect-[4/5] w-24 md:w-32 lg:w-40 shrink-0 bg-[#EAE7E0]">
                  <img
                    alt="Stock-aware"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-(--ease-out-expo)-expo)"
                    src="/landing/features/stock.webp"
                  />
                  <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                <div className="lg:w-[40%]">
                  <h4 className="pv-serif text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-(--dur-ui)">
                    Stock-aware
                  </h4>
                  <div className="pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                    Availability at a glance
                  </div>
                </div>
                <div className="lg:w-[60%]">
                  <p className="pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                    Keep customers informed about what is ready to order, so fewer conversations hit
                    a dead end.
                  </p>
                </div>
              </div>
            </div>
            <div className="group flex flex-col md:flex-row gap-6 md:gap-10 items-start reveal-on-scroll border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0 opacity-100">
              <div className="flex items-start gap-6 md:gap-8 shrink-0 w-full md:w-auto">
                <div className="pt-2">
                  <span className="pv-sans text-[10px] uppercase tracking-[0.2em] kit-num inline-block text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-(--dur-ui)">
                    06
                  </span>
                </div>
                <div className="kit-media relative overflow-hidden aspect-[4/5] w-24 md:w-32 lg:w-40 shrink-0 bg-[#EAE7E0]">
                  <img
                    alt="Direct payments"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-(--ease-out-expo)-expo)"
                    src="/landing/features/payments.webp"
                  />
                  <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                <div className="lg:w-[40%]">
                  <h4 className="pv-serif text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-(--dur-ui)">
                    Direct payments
                  </h4>
                  <div className="pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                    Lightning to your wallet
                  </div>
                </div>
                <div className="lg:w-[60%]">
                  <p className="pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                    Accept fast Lightning payments directly to your wallet, without adding another
                    step for your customers.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-24 pt-12 border-t border-[#1111111f] flex flex-col md:flex-row justify-between items-center gap-8 reveal-on-scroll [--d:150ms] opacity-100">
            <div className="flex items-center gap-4">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E3342F] pv-pulse motion-loop"></span>
              <span className="pv-sans text-[9px] uppercase tracking-[0.2em] font-medium">
                Made for small businesses
              </span>
            </div>
            <p className="pv-sans text-xs text-black/60 uppercase tracking-widest text-center md:text-left">
              Share your shop wherever your customers are. <br className="hidden md:block" /> No
              complicated setup required.
            </p>
            <p className="pv-serif italic text-2xl">One simple link</p>
          </div>
        </div>
      </section>
      <section className="pb-32 pt-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-[#1111111f]">
        <div className="mb-16 reveal-on-scroll opacity-100">
          <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-4 flex items-center gap-4">
            <span className="w-8 h-px bg-[#E3342F]"></span>A shop that is yours
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
          <div className="md:col-span-12 h-[50vh] md:h-[70vh] relative overflow-hidden group reveal-on-scroll opacity-100">
            <img
              alt="Boutique interior"
              className="gal-par w-full h-full object-cover transition-transform duration-(--dur-ui) ease-(--ease-out-expo) group-hover:scale-105"
              src="/landing/gallery/boutique.jpg"
            />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
            <div className="absolute bottom-6 left-6 bg-[#F6F4F0] p-5 pr-12 border border-[#1111111f] transition-transform duration-(--dur-ui) ease-(--ease-out-expo) group-hover:translate-x-2">
              <h3 className="pv-serif text-3xl mb-1 group-hover:text-[#8AAE4A] transition-colors duration-(--dur-ui)">
                Your online shop
              </h3>
              <p className="pv-sans text-[10px] uppercase tracking-[0.2em] text-black/60">
                A storefront customers can trust
              </p>
            </div>
          </div>
          <div className="md:col-span-8 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll [--d:100ms] opacity-100">
            <img
              alt="Seller packing an order"
              className="gal-par w-full h-full object-cover transition-transform duration-(--dur-ui) ease-(--ease-out-expo) group-hover:scale-105"
              src="/landing/gallery/packing.jpg"
            />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll [--d:75ms] opacity-100">
            <img
              alt="Market stall"
              className="gal-par w-full h-full object-cover transition-transform duration-(--dur-ui) ease-(--ease-out-expo) group-hover:scale-105"
              src="/landing/gallery/market.jpg"
            />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll [--d:100ms] opacity-100">
            <img
              alt="Sneaker store"
              className="gal-par w-full h-full object-cover transition-transform duration-(--dur-ui) ease-(--ease-out-expo) group-hover:scale-105"
              src="/landing/gallery/sneakers.jpg"
            />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll [--d:75ms] opacity-100">
            <div className="w-full h-full bg-[#EAE7E0] flex flex-col items-center justify-center p-8 text-center border border-[#1111111f] relative group-hover:bg-[#EAE7E0]/80 transition-colors duration-(--dur-ui) ease-(--ease-out-expo)">
              <div className="absolute top-0 left-0 w-full h-1 bg-[#E3342F] scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"></div>
              <img
                src="/brand/selly-mascot.webp"
                width={800}
                height={800}
                loading="lazy"
                decoding="async"
                alt=""
                className="w-28 h-28 object-contain mb-8 opacity-90 group-hover:scale-105 transition-transform duration-(--dur-ui) ease-(--ease-out-expo)"
              />
              <p className="pv-serif text-3xl italic leading-snug">
                "Simple to share. Easy to order."
              </p>
            </div>
          </div>
          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll [--d:100ms] opacity-100">
            <img
              alt="Art gallery"
              className="gal-par w-full h-full object-cover transition-transform duration-(--dur-ui) ease-(--ease-out-expo) group-hover:scale-105"
              src="/landing/gallery/gallery.jpg"
            />
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
        </div>
      </section>
      <section
        id="signup"
        className="py-32 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-[#1111111f] relative overflow-hidden bg-[#F6F4F0]"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8 items-start relative z-10">
          <div className="lg:col-span-5 flex flex-col justify-between h-full reveal-on-scroll opacity-100">
            <div>
              <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-8 flex items-center gap-4">
                <span className="w-8 h-px bg-[#E3342F]"></span>Get started
              </div>
              <h2 className="pv-serif text-5xl md:text-7xl font-light leading-[1.1] mb-8">
                Start your <br />
                <span className="italic text-[#8AAE4A]">Selly shop</span>
              </h2>
            </div>
            <div className="space-y-8 pv-sans text-xs uppercase tracking-widest text-black/70 mt-12 lg:mt-32">
              <div className="flex gap-6 group">
                <span className="w-4 h-px bg-[#E3342F] mt-2 origin-left group-hover:scale-x-200 transition-transform duration-(--dur-ui)"></span>
                <div>
                  <div className="text-black font-medium mb-1">Set up</div>
                  <div>Start with your products</div>
                </div>
              </div>
              <div className="flex gap-6 group">
                <span className="w-4 h-px bg-[#E3342F] mt-2 origin-left group-hover:scale-x-200 transition-transform duration-(--dur-ui)"></span>
                <div>
                  <div className="text-black font-medium mb-1">Share</div>
                  <div>WhatsApp, Instagram, anywhere</div>
                </div>
              </div>
              <div className="flex gap-6 group">
                <span className="w-4 h-px bg-[#E3342F] mt-2 origin-left group-hover:scale-x-200 transition-transform duration-(--dur-ui)"></span>
                <div>
                  <div className="text-black font-medium mb-1">Get paid</div>
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
          <div className="lg:col-span-5 flex flex-col justify-center reveal-on-scroll [--d:75ms] lg:pl-8 pt-4 lg:pt-0 opacity-100">
            <div className="mb-12">
              <p className="pv-sans text-sm leading-relaxed text-black/60 mb-6">
                Tell us a little about your business and we’ll help you get your shop ready to
                share.
              </p>
              <div className="inline-flex items-center gap-3 pv-sans text-[9px] uppercase tracking-[0.2em] px-4 py-2 border border-[#1111111f]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8AAE4A] pv-pulse motion-loop"></span>
                Built for sellers in Senegal
              </div>
            </div>
            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-10">
              <div className="relative group">
                <input
                  id="name"
                  placeholder=" "
                  className="peer w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#E3342F] transition-colors rounded-none"
                  type="text"
                />
                <label
                  htmlFor="name"
                  className="absolute left-0 top-2 pv-sans text-xs uppercase tracking-widest text-black/40 peer-focus:-translate-y-6 peer-focus:scale-75 peer-focus:text-[#E3342F] peer-[:not(:placeholder-shown)]:-translate-y-6 peer-[:not(:placeholder-shown)]:scale-75 origin-left transition-[translate,scale,color] duration-(--dur-ui) cursor-text pointer-events-none"
                >
                  Your name
                </label>
              </div>
              <div className="relative group">
                <input
                  id="email"
                  placeholder=" "
                  className="peer w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#E3342F] transition-colors rounded-none"
                  type="email"
                />
                <label
                  htmlFor="email"
                  className="absolute left-0 top-2 pv-sans text-xs uppercase tracking-widest text-black/40 peer-focus:-translate-y-6 peer-focus:scale-75 peer-focus:text-[#E3342F] peer-[:not(:placeholder-shown)]:-translate-y-6 peer-[:not(:placeholder-shown)]:scale-75 origin-left transition-[translate,scale,color] duration-(--dur-ui) cursor-text pointer-events-none"
                >
                  Email address
                </label>
              </div>
              <div className="relative group">
                <select
                  id="party"
                  className="w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#E3342F] transition-colors appearance-none rounded-none cursor-pointer"
                >
                  <option value="Fashion &amp; accessories">Fashion &amp; accessories</option>
                  <option value="Food &amp; drink">Food &amp; drink</option>
                  <option value="Beauty &amp; care">Beauty &amp; care</option>
                  <option value="Other products">Other products</option>
                </select>
                <div className="absolute right-0 top-2 pointer-events-none text-black/40">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-chevron-down"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6"></path>
                  </svg>
                </div>
                <label
                  htmlFor="party"
                  className="absolute left-0 -translate-y-6 text-[9px] pv-sans uppercase tracking-widest text-black/40 pointer-events-none"
                >
                  What do you sell?
                </label>
              </div>
              <button
                type="submit"
                className="mt-6 relative overflow-hidden group pv-sans text-xs uppercase tracking-[0.2em] font-medium border border-[#173B32] py-5 px-8 text-[#173B32] hover:text-[#F6F4F0] transition-colors duration-(--dur-ui) w-full text-center cursor-pointer"
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
                    className="lucide lucide-arrow-right inline ml-2"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14"></path>
                    <path d="m12 5 7 7-7 7"></path>
                  </svg>
                </span>
                <div className="absolute inset-0 bg-[#173B32] translate-y-[100%] group-hover:translate-y-0 transition-transform duration-(--dur-ui) ease-(--ease-(--ease-out-expo)-expo) z-0"></div>
              </button>
            </form>
          </div>
        </div>
      </section>
      <footer className="py-12 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-b border-[#1111111f] flex flex-col md:flex-row justify-between items-center gap-8">
        <img src="/brand/selly-wordmark.png" alt="Selly" className="h-9 w-auto" />
        <div className="flex gap-8 pv-sans text-[10px] uppercase tracking-widest text-black/50">
          <a href="#signup" className="hover:text-[#173B32] transition-colors">
            Get started
          </a>
          <a href="#signup" className="hover:text-[#173B32] transition-colors">
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
