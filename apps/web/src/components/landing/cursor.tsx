'use client';

import gsap from 'gsap';
import { useEffect, useRef } from 'react';

/** Radius of the gallery's colour lens, in px; the ring is drawn at this size over the photos (landing.css). */
const LENS = 80;
/** The colour the lens leaves behind stays this long (ms), then fades over TRAIL_FADE. */
const TRAIL_HOLD = 2000;
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

    // Over the gallery the ring leaves a liquid of colour behind it: drops along its path, droplets shed at its tail
    // that drift away, and now and then a drip running down from the trail. Each grows in, holds for TRAIL_HOLD, then
    // shrinks away. Drops are soft-edged and the canvas goes through a threshold (#gal-goo, Landing.tsx), so the ones
    // that touch melt into one shape with a clean edge. Each photo keeps its own drops, in its own pixels (the photos
    // zoom on hover and drift with the scroll), and is redrawn while it has any.
    type Drop = {
      x: number;
      y: number;
      r: number;
      t: number;
      seed: number;
      vx: number;
      vy: number;
      g: number;
    };
    const photos = Array.from(document.querySelectorAll<HTMLCanvasElement>('.gal-paint')).map(
      (canvas) => ({
        canvas,
        mask: document.createElement('canvas'),
        drops: [] as Drop[],
        painted: false,
      }),
    );
    let last: { x: number; y: number } | null = null;
    let then = performance.now();
    const paint = () => {
      const now = performance.now();
      const dt = Math.min((now - then) / 1000, 0.05);
      then = now;
      const x = Number(gsap.getProperty(ring, 'x'));
      const y = Number(gsap.getProperty(ring, 'y'));
      const from = lens.r > 0 ? (last ?? { x, y }) : null;
      last = lens.r > 0 ? { x, y } : null;
      const dist = from ? Math.hypot(x - from.x, y - from.y) : 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      for (const ph of photos) {
        const { canvas: c } = ph;
        ph.drops = ph.drops.filter((d) => now - d.t < TRAIL_HOLD + TRAIL_FADE);
        // Droplets drift off and slow down, drips slide down; both sink a little.
        for (const d of ph.drops) {
          if (!d.vx && !d.vy && !d.g) continue;
          const drag = 0.95 ** (dt * 60);
          d.vx *= drag;
          d.vy *= drag;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.vy += d.g * dt;
        }
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
            // A drop every half radius along the way, and one where the ring rests (a still ring keeps its drop
            // fresh rather than piling them up).
            const steps = Math.max(1, Math.ceil(dist / (lens.r / 2)));
            const still = dist < 0.5;
            const at = (f: number) => ({
              x: (from.x + (x - from.x) * f - b.left) * k,
              y: (from.y + (y - from.y) * f - b.top) * k,
            });
            const drop = (o: Partial<Drop> & { x: number; y: number; r: number }) =>
              ph.drops.push({ t: now, seed: Math.random() * 6.28, vx: 0, vy: 0, g: 0, ...o });
            if (still && ph.drops.length) {
              const top = ph.drops.findLast((d) => !d.g);
              if (top) top.t = Math.max(top.t, now - 200);
            } else {
              for (let i = 1; i <= steps; i++) {
                const p = at(i / steps);
                drop({ ...p, r: lens.r * k });
                // A drip: a small drop that slides down from the bottom of the trail.
                if (Math.random() < 0.025)
                  drop({
                    x: p.x + (Math.random() - 0.5) * lens.r * k,
                    y: p.y + lens.r * k * 0.55,
                    r: lens.r * k * (0.18 + Math.random() * 0.12),
                    vy: 30 + Math.random() * 40,
                    g: 90,
                  });
              }
              // Droplets at the tail: they shed from the sides of the stroke behind the ring and drift away, backwards
              // and outwards, slowing down, so the liquid stretches into a thread and lets them go. Mostly small, now
              // and then a big one. The faster the ring, the more of them.
              if (dist > 1) {
                const ux = (x - from.x) / dist;
                const uy = (y - from.y) / dist;
                const speed = dist / Math.max(dt, 1 / 120);
                let chance = Math.min(0.95, dist / (lens.r * 0.5));
                while (Math.random() < chance) {
                  chance -= 0.6;
                  const p = at(Math.random() * 0.5);
                  const side = Math.random() < 0.5 ? -1 : 1;
                  const size = Math.random() ** 2.2;
                  const out = (170 + Math.random() * 200) * side * k;
                  const back = Math.min(speed, 1800) * (0.08 + Math.random() * 0.14) * k;
                  drop({
                    x: p.x - ux * lens.r * k * 0.45 - uy * side * lens.r * k * 0.55,
                    y: p.y - uy * lens.r * k * 0.45 + ux * side * lens.r * k * 0.55,
                    r: lens.r * k * (0.13 + size * 0.3),
                    vx: -ux * back - uy * out,
                    vy: -uy * back + ux * out,
                    g: 40 + Math.random() * 60,
                  });
                }
              }
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
          // A soft falloff: the threshold cuts it at about half, where neighbouring drops add up into a bridge.
          const g = mc.createRadialGradient(d.x / 4, d.y / 4, 0, d.x / 4, d.y / 4, r);
          g.addColorStop(0, `rgba(0,0,0,${fade})`);
          g.addColorStop(0.55, `rgba(0,0,0,${fade * 0.85})`);
          g.addColorStop(0.8, `rgba(0,0,0,${fade * 0.25})`);
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
