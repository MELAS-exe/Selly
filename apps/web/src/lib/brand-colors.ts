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

/** WCAG relative luminance of a hex colour (0 black to 1 white). */
function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of a colour on the shop's paper (#f6f4f0). */
export function contrastOnPaper(hex: string): number {
  const paper = luminance('#f6f4f0');
  const c = luminance(hex);
  return (paper + 0.05) / (c + 0.05);
}

/**
 * The shop in Selly's design system, in the vendor's colours: --sf-ink (text, buttons, dark sections) is the
 * primary colour when it reads at 7:1 or more on paper, else Selly's ink; --sf-accent (marks, fills) is the accent;
 * --sf-accent-text (accent used as text, labels) is the accent when it reaches 4.5:1, else a darker shade of it.
 * The storefront tokens of brandStyle are set too, for the components that still read them (add to cart, chat).
 */
export function storefrontStyle(branding: Branding | null | undefined): Record<string, string> {
  const primary = branding && parseHex(branding.primary_color) ? branding.primary_color : '#173b32';
  const accent = branding && parseHex(branding.accent_color) ? branding.accent_color : '#8aae4a';
  const ink = contrastOnPaper(primary) >= 7 ? primary : '#173b32';
  let accentText = accent;
  for (let i = 0; i < 8 && contrastOnPaper(accentText) < 4.5; i++)
    accentText = darken(accentText, 0.15);
  return {
    ...brandStyle({ logo_url: null, primary_color: ink, accent_color: accent, banner: null }),
    '--sf-ink': ink,
    '--sf-accent': accent,
    '--sf-accent-text': accentText,
  };
}
