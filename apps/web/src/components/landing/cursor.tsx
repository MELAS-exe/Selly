'use client';

import gsap from 'gsap';
import { useEffect, useRef } from 'react';

/** Radius of the gallery's colour lens, in px; the ring is drawn at this size over the photos (landing.css). */
const LENS = 110;

/**
 * The landing page's cursor, for mouse and trackpad only: a dot on the pointer and a ring that trails it. The ring
 * grows on links, turns light green on the hero titles, and over the gallery becomes the lens that shows the
 * grayscale photos in colour where it passes (each photo's .gal-color copy is masked to the ring).
 */
export function LandingCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const html = document.documentElement;
    html.classList.add('has-cursor');

    gsap.set([dot, ring], { xPercent: -50, yPercent: -50, x: -100, y: -100 });
    const dx = gsap.quickTo(dot, 'x', { duration: 0.1, ease: 'power3' });
    const dy = gsap.quickTo(dot, 'y', { duration: 0.1, ease: 'power3' });
    const rx = gsap.quickTo(ring, 'x', { duration: calm ? 0.01 : 0.45, ease: 'power3' });
    const ry = gsap.quickTo(ring, 'y', { duration: calm ? 0.01 : 0.45, ease: 'power3' });

    const lens = { r: 0 };
    let state = '';
    const setState = (next: string) => {
      if (next === state) return;
      state = next;
      ring.dataset.state = next;
      dot.dataset.state = next;
      gsap.to(lens, { r: next === 'lens' ? LENS : 0, duration: calm ? 0 : 0.5, ease: 'expo.out' });
    };

    const move = (e: PointerEvent) => {
      dx(e.clientX);
      dy(e.clientY);
      rx(e.clientX);
      ry(e.clientY);
      ring.dataset.visible = '';
      dot.dataset.visible = '';
      const t = e.target instanceof Element ? e.target : null;
      setState(
        t?.closest('.gal-tile')
          ? 'lens'
          : t?.closest('[data-cursor="flip"]')
            ? 'flip'
            : t?.closest('a, button')
              ? 'link'
              : '',
      );
      const dark = Boolean(t?.closest('[data-dark-section]'));
      ring.toggleAttribute('data-dark', dark);
      dot.toggleAttribute('data-dark', dark);
    };
    const hide = (e: PointerEvent) => {
      if (e.relatedTarget) return;
      delete ring.dataset.visible;
      delete dot.dataset.visible;
    };

    // The colour follows the ring, not the pointer, so it trails exactly as the ring does. Positions are written in
    // each photo's own pixels: the photos are scaled (hover zoom) and drift (parallax).
    const photos = Array.from(document.querySelectorAll<HTMLElement>('.gal-color'));
    let cleared = true;
    const paint = () => {
      if (lens.r === 0 && cleared) return;
      const x = Number(gsap.getProperty(ring, 'x'));
      const y = Number(gsap.getProperty(ring, 'y'));
      for (const p of photos) {
        const b = p.getBoundingClientRect();
        const k = b.width ? p.offsetWidth / b.width : 1;
        p.style.setProperty('--mx', `${(x - b.left) * k}px`);
        p.style.setProperty('--my', `${(y - b.top) * k}px`);
        p.style.setProperty('--r', `${lens.r * k}px`);
      }
      cleared = lens.r === 0;
    };

    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', hide);
    gsap.ticker.add(paint);
    return () => {
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', hide);
      gsap.ticker.remove(paint);
      html.classList.remove('has-cursor');
    };
  }, []);

  return (
    <>
      <div ref={ringRef} aria-hidden="true" className="cursor-ring" />
      <div ref={dotRef} aria-hidden="true" className="cursor-dot" />
    </>
  );
}
