// Turns a vendor's two brand colours into the shop's CSS custom properties (app/globals.css
// @theme), so the wax band, buttons and accents use their colours instead of Selly's defaults.
import type { Branding } from './types';

function clamp(n: number) {
  return Math.max(0, Math.min(255, n));
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map((c) => clamp(Math.round(c)).toString(16).padStart(2, '0')).join('')}`;

/** The same hue, darker by `amount` (0 to 1): for a pressed or "deep" variant of a brand colour. */
function darken(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex(rgb.map((c) => c * (1 - amount)) as [number, number, number]);
}

/**
 * CSS variables for the shop layout's inline `style`. Falls back to Selly's own indigo/ochre wax
 * palette (app/globals.css) when a vendor has not set colours, which the defaults already match.
 * `--color-bissap` is left alone: it marks low stock and the cart badge, a status colour, not a
 * brand one.
 */
export function brandStyle(branding: Branding): Record<string, string> {
  const primary = parseHex(branding.primary_color) ? branding.primary_color : '#2c3ba8';
  const accent = parseHex(branding.accent_color) ? branding.accent_color : '#c8902e';
  return {
    '--color-indigo': primary,
    '--color-indigo-deep': darken(primary, 0.22),
    '--color-ochre': accent,
  };
}
