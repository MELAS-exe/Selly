import type { Availability, Money, Options } from './types';

// fr-SN everywhere (architecture.md 3.4). Intl prints XOF as "20 000 F CFA".
const xof = new Intl.NumberFormat('fr-SN', { style: 'currency', currency: 'XOF' });
const int = new Intl.NumberFormat('fr-SN');

export function formatMoney(m: Money): string {
  return m.currency === 'SAT' ? formatSats(m.amount) : xof.format(m.amount);
}

export function formatSats(sats: number): string {
  return `${int.format(sats)} sats`;
}

export const availabilityLabel: Record<Availability, string> = {
  in_stock: 'Disponible',
  low: 'Plus que quelques pièces',
  out_of_stock: 'Épuisé',
};

const optionNames: Record<string, string> = { size: 'Taille', color: 'Couleur' };
export const optionName = (key: string) => optionNames[key] ?? key;

/** { size: "42", color: "noir" } to "Taille 42, noir". */
export function formatOptions(options: Options): string {
  return Object.entries(options)
    .map(([k, v]) => (k === 'size' ? `${optionName(k)} ${v}` : v))
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
