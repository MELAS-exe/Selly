/**
 * Motion tokens for the Web Animations API. The values live in globals.css (@theme static);
 * this only reads them, so CSS and JS animations always share the same curves and durations.
 */

export function motionToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A duration token in milliseconds. The CSS minifier may rewrite "600ms" as ".6s": both work. */
export function durationToken(name: '--dur-tap' | '--dur-ui' | '--dur-hero'): number {
  const raw = motionToken(name);
  const n = Number.parseFloat(raw) || 0;
  return raw.endsWith('ms') ? n : n * 1000;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
