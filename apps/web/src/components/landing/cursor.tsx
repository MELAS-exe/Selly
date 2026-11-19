'use client';

import gsap from 'gsap';
import { useEffect, useRef } from 'react';

/** Radius of the gallery's colour lens, in px; the ring is drawn at this size over the photos (landing.css). */
const LENS = 110;
/** The colour the lens leaves behind stays this long (ms), then fades over TRAIL_FADE. */
const TRAIL_HOLD = 1000;
const TRAIL_FADE = 600;

/**
 * The landing page's cursor, for mouse and trackpad only: a dot on the pointer and a ring that trails it. The ring
 * grows on links, turns light green on the hero titles, and over the gallery becomes the lens that shows the
 * grayscale photos in colour where it passes, leaving a liquid trail that fades after a second (each photo's .gal-paint).
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

    // The ring is liquid: it stretches along the way it moves, and settles round when it stops.
    let px = -100;
    let py = -100;
    const stretch = gsap.quickTo(ring, 'scaleX', { duration: 0.35, ease: 'power3' });
    const squash = gsap.quickTo(ring, 'scaleY', { duration: 0.35, ease: 'power3' });
    const flow = () => {
      const x = Number(gsap.getProperty(ring, 'x'));
      const y = Number(gsap.getProperty(ring, 'y'));
      const v = Math.min(Math.hypot(x - px, y - py) / 40, 1);
      if (v > 0.02) gsap.set(ring, { rotate: (Math.atan2(y - py, x - px) * 180) / Math.PI });
      stretch(calm ? 1 : 1 + v * 0.35);
      squash(calm ? 1 : 1 - v * 0.22);
      px = x;
      py = y;
    };

    // Over the gallery the ring leaves drops of colour behind it: each grows in, holds for TRAIL_HOLD, then shrinks
    // away as it fades. Drops are soft-edged, so the ones that touch run together like a liquid. Each photo keeps its
    // own drops, in its own pixels (the photos zoom on hover and drift with the scroll), and is redrawn while it has any.
    type Drop = { x: number; y: number; r: number; t: number; seed: number };
    const photos = Array.from(document.querySelectorAll<HTMLCanvasElement>('.gal-paint')).map(
      (canvas) => ({
        canvas,
        mask: document.createElement('canvas'),
        drops: [] as Drop[],
        painted: false,
      }),
    );
    let last: { x: number; y: number } | null = null;
    const paint = () => {
      const now = performance.now();
      const x = Number(gsap.getProperty(ring, 'x'));
      const y = Number(gsap.getProperty(ring, 'y'));
      const from = lens.r > 0 ? (last ?? { x, y }) : null;
      last = lens.r > 0 ? { x, y } : null;
      const dist = from ? Math.hypot(x - from.x, y - from.y) : 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      for (const ph of photos) {
        const { canvas: c } = ph;
        ph.drops = ph.drops.filter((d) => now - d.t < TRAIL_HOLD + TRAIL_FADE);
        const b = c.getBoundingClientRect();
        if (from && b.width) {
          const reach = lens.r + dist;
          if (
            !(
              x + reach < b.left ||
              x - reach > b.right ||
              y + reach < b.top ||
              y - reach > b.bottom
            )
          ) {
            const k = c.offsetWidth / b.width;
            // A drop every quarter radius along the way, and one where the ring rests (a still ring keeps its drop
            // fresh rather than piling them up).
            const steps = Math.max(1, Math.ceil(dist / (lens.r / 4)));
            const still = dist < 0.5;
            if (still && ph.drops.length) {
              const top = ph.drops[ph.drops.length - 1];
              if (top) top.t = Math.max(top.t, now - 200);
            } else
              for (let i = 1; i <= steps; i++) {
                const f = i / steps;
                ph.drops.push({
                  x: (from.x + (x - from.x) * f - b.left) * k,
                  y: (from.y + (y - from.y) * f - b.top) * k,
                  r: lens.r * k,
                  t: now,
                  seed: Math.random() * 6.28,
                });
              }
          }
        }
        if (!ph.drops.length) {
          if (ph.painted) {
            c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
            ph.painted = false;
          }
          continue;
        }
        const img = c.previousElementSibling;
        if (!(img instanceof HTMLImageElement) || !img.naturalWidth) continue;
        const w = Math.round(c.offsetWidth * dpr);
        const h = Math.round(c.offsetHeight * dpr);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        // The mask at a quarter of the size: cheap, and scaling it up softens the edges further.
        const m = ph.mask;
        const mw = Math.max(1, Math.round(c.offsetWidth / 4));
        const mh = Math.max(1, Math.round(c.offsetHeight / 4));
        if (m.width !== mw || m.height !== mh) {
          m.width = mw;
          m.height = mh;
        }
        const mc = m.getContext('2d');
        const ctx = c.getContext('2d');
        if (!mc || !ctx) continue;
        mc.clearRect(0, 0, mw, mh);
        for (const d of ph.drops) {
          const age = now - d.t;
          const grow = Math.min(1, age / 220);
          const fade = age < TRAIL_HOLD ? 1 : 1 - (age - TRAIL_HOLD) / TRAIL_FADE;
          const wobble = 1 + Math.sin(now / 260 + d.seed) * 0.06;
          const r = (d.r / 4) * (0.5 + 0.5 * (1 - (1 - grow) ** 3)) * (0.55 + 0.45 * fade) * wobble;
          const g = mc.createRadialGradient(d.x / 4, d.y / 4, 0, d.x / 4, d.y / 4, r);
          g.addColorStop(0, `rgba(0,0,0,${fade})`);
          g.addColorStop(0.62, `rgba(0,0,0,${fade})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          mc.fillStyle = g;
          mc.beginPath();
          mc.arc(d.x / 4, d.y / 4, r, 0, Math.PI * 2);
          mc.fill();
        }
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(m, 0, 0, w, h);
        // The photo as object-fit: cover draws it, kept only where the mask is.
        ctx.globalCompositeOperation = 'source-in';
        const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const sw = w / s;
        const sh = h / s;
        ctx.drawImage(
          img,
          (img.naturalWidth - sw) / 2,
          (img.naturalHeight - sh) / 2,
          sw,
          sh,
          0,
          0,
          w,
          h,
        );
        ctx.globalCompositeOperation = 'source-over';
        ph.painted = true;
      }
    };
    const tick = () => {
      flow();
      paint();
    };

    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', hide);
    gsap.ticker.add(tick);
    return () => {
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', hide);
      gsap.ticker.remove(tick);
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
