// Output filter (architecture.md section 8.4): links only to our own domain and the vendor's contact,
// no phone numbers except the vendor's, a maximum length, and at most 4 quick replies.

import type { QuickReply } from '../core/types';

export const MAX_REPLY_CHARS = 1000;

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/gi;
// Phone-like runs of 8+ digits, with spaces, dots or dashes, optionally starting with +.
const PHONE_RE = /(?<![\w/])\+?\d[\d .-]{6,}\d(?![\w/])/g;

const digits = (s: string) => s.replace(/\D/g, '');

export interface FilterOptions {
  appBaseUrl: string;
  whatsappLink: string | null;
}

export function filterReply(text: string, opts: FilterOptions): string {
  const allowedHost = safeHost(opts.appBaseUrl);
  const vendorDigits = opts.whatsappLink ? digits(opts.whatsappLink) : '';
  let out = text.replace(URL_RE, (url) => {
    const host = safeHost(url);
    if (host && host === allowedHost) return url;
    if (opts.whatsappLink && url.startsWith(opts.whatsappLink)) return url;
    return '';
  });
  out = out.replace(PHONE_RE, (m) => {
    const d = digits(m);
    // Amounts such as "15 000" are short; a phone number has at least 8 digits.
    if (d.length < 8) return m;
    if (vendorDigits && (vendorDigits.endsWith(d) || d.endsWith(vendorDigits.slice(-9)))) return m;
    return '';
  });
  out = out
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (out.length > MAX_REPLY_CHARS) out = `${out.slice(0, MAX_REPLY_CHARS - 1).trimEnd()}…`;
  return out;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Splits a trailing « Boutons: A | B » line into quick replies. */
export function extractQuickReplies(text: string): { text: string; quickReplies: QuickReply[] } {
  const lines = text.trimEnd().split('\n');
  const last = lines.at(-1) ?? '';
  const m = /^\s*(?:boutons|buttons)\s*:\s*(.+)$/i.exec(last);
  if (!m?.[1]) return { text, quickReplies: [] };
  const labels = m[1]
    .split('|')
    .map((l) => l.trim().replace(/^["«]\s*|\s*["»]$/g, ''))
    .filter((l) => l.length > 0 && l.length <= 40)
    .slice(0, 4);
  return {
    text: lines.slice(0, -1).join('\n').trim(),
    quickReplies: labels.map((label) => ({ id: slugify(label), label })),
  };
}

export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 32) || 'reply'
  );
}

/**
 * Amounts written in the reply (« 15 000 FCFA », « 27 103 sats ») that no tool returned this turn.
 * Used for property P5 of section 13 and as a runtime guard.
 */
export function unbackedAmounts(text: string, allowed: Set<number>): number[] {
  const re = /(\d{1,3}(?:[   .]\d{3})+|\d+)\s*(?:fcfa|f cfa|xof|francs?|sats?)\b/gi;
  const bad: number[] = [];
  for (const m of text.matchAll(re)) {
    const n = Number((m[1] ?? '').replace(/[   .]/g, ''));
    if (!allowed.has(n)) bad.push(n);
  }
  return bad;
}

/** « 15 000 FCFA » with a narrow no-break space (section 8.5). */
export function formatXof(amount: number): string {
  return `${amount.toLocaleString('fr-FR').replace(/[\s ]/g, ' ')} FCFA`;
}
