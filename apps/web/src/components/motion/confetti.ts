/**
 * A short burst of confetti from an element, in the cloth's colours. Homemade, kept under
 * 2 KB: load it with `import('./confetti')` only when a payment lands. One canvas over the
 * viewport, removed when the last piece has fallen (about 1.4 s). Hidden from assistive tech.
 */
const CLOTH = ['--color-indigo', '--color-bissap', '--color-ochre'];
const CLOTH_FALLBACK = ['#2c3ba8', '#a3214f', '#c8902e'];

/** `palette`: three CSS custom properties to colour the pieces (the dashboard passes its greens). */
export function burst(from: Element, count = 70, palette: string[] = CLOTH) {
  const css = getComputedStyle(document.documentElement);
  const colors = palette.map(
    (v, i) => css.getPropertyValue(v).trim() || CLOTH_FALLBACK[i] || '#173b32',
  );
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:fixed;inset:0;width:${w}px;height:${h}px;pointer-events:none;z-index:70`;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();
  ctx.scale(dpr, dpr);

  const r = from.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  const bits = Array.from({ length: count }, (_, i) => ({
    x: x0,
    y: y0,
    vx: (Math.random() - 0.5) * 11,
    vy: -Math.random() * 11 - 4,
    a: Math.random() * 6,
    va: (Math.random() - 0.5) * 0.4,
    s: 5 + Math.random() * 5,
    c: colors[i % colors.length] as string,
  }));
  const start = performance.now();
  const life = 1400;

  const frame = (t: number) => {
    const age = t - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, (life - age) / 400);
    for (const b of bits) {
      b.vy += 0.38;
      b.vx *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.a += b.va;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      ctx.restore();
    }
    if (age < life) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
