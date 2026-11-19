import type { Lang } from './i18n';
import type { Availability, Money, Options } from './types';

// fr-SN (architecture.md 3.4): Intl prints XOF as "20 000 F CFA". A shop in English shows "20,000 FCFA".
const xof = new Intl.NumberFormat('fr-SN', { style: 'currency', currency: 'XOF' });
const int = { fr: new Intl.NumberFormat('fr-SN'), en: new Intl.NumberFormat('en-US') };

export function formatMoney(m: Money, lang: Lang = 'fr'): string {
  if (m.currency === 'SAT') return formatSats(m.amount, lang);
  return lang === 'en' ? `${int.en.format(m.amount)} FCFA` : xof.format(m.amount);
}

export function formatSats(sats: number, lang: Lang = 'fr'): string {
  return `${int[lang].format(sats)} sats`;
}

/** Money and sats in a shop's language. */
export const moneyIn = (lang: Lang) => ({
  money: (m: Money) => formatMoney(m, lang),
  sats: (n: number) => formatSats(n, lang),
});

export const availabilityLabel: Record<Availability, string> = {
  in_stock: 'Disponible',
  low: 'Plus que quelques pièces',
  out_of_stock: 'Épuisé',
};
const availabilityEn: Record<Availability, string> = {
  in_stock: 'In stock',
  low: 'Only a few left',
  out_of_stock: 'Sold out',
};
/** The availability in the shop's language. */
export const availabilityIn = (lang: Lang) => (lang === 'en' ? availabilityEn : availabilityLabel);

const optionNames: Record<Lang, Record<string, string>> = {
  fr: { size: 'Taille', color: 'Couleur' },
  en: { size: 'Size', color: 'Colour' },
};
export const optionName = (key: string, lang: Lang = 'fr') => optionNames[lang][key] ?? key;

/** { size: "42", color: "noir" } to "Taille 42, noir" ("Size 42, noir" in English). */
export function formatOptions(options: Options, lang: Lang = 'fr'): string {
  return Object.entries(options)
    .map(([k, v]) => (k === 'size' ? `${optionName(k, lang)} ${v}` : v))
    .join(', ');
}

/**
 * Senegalese numbers as people type them ("77 123 45 67", "0771234567", "+221 77...") to E.164.
 * Returns null when the result is not a plausible number.
 */
export function toE164(input: string): string | null {
  let d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (!d.startsWith('+')) {
    d = d.replace(/^0+/, '');
    d = d.length === 9 ? `+221${d}` : `+${d}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
}
