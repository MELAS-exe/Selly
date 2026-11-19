// The shop's practical facts, in words, from the public store payload (GET /stores/{slug}).

import { formatMoney } from '@/lib/format';
import type { Lang } from '@/lib/i18n';
import type { StorePublic } from '@/lib/types';

const DAYS: Record<Lang, Record<string, string>> = {
  fr: {
    'lun-sam': 'Lun – sam',
    'lun-ven': 'Lun – ven',
    'lun-dim': 'Tous les jours',
    'mar-sam': 'Mar – sam',
  },
  en: {
    'lun-sam': 'Mon – Sat',
    'lun-ven': 'Mon – Fri',
    'lun-dim': 'Every day',
    'mar-sam': 'Tue – Sat',
    sam: 'Saturday',
  },
};

/** "Lun – sam · 09 h – 19 h" ("Mon – Sat · 09:00 – 19:00" in English), or null without hours. */
export function hoursLabel(store: StorePublic, lang: Lang = 'fr'): string | null {
  const h = store.hours[0];
  if (!h) return null;
  const days = DAYS[lang][h.days] ?? h.days;
  if (lang === 'en') return `${days} · ${h.open} – ${h.close}`;
  return `${days} · ${h.open.replace(':', ' h ')} – ${h.close.replace(':', ' h ')}`.replace(
    / h 00/g,
    ' h',
  );
}

/** Delivery in one line: the zones and the cheapest fee. */
export function deliveryLabel(
  store: StorePublic,
  lang: Lang = 'fr',
): { title: string; sub: string } | null {
  const zones = store.delivery.zones;
  if (!zones.length) return null;
  const min = formatMoney(
    {
      amount: Math.min(...zones.map((z) => z.fee.amount)),
      currency: zones[0]?.fee.currency ?? 'XOF',
    },
    lang,
  );
  const names = zones.map((z) => z.label).join(', ');
  return lang === 'en'
    ? { title: 'Home delivery', sub: `${names} · from ${min}` }
    : { title: 'Livraison à domicile', sub: `${names} · dès ${min}` };
}

/** The pickup address, when customers can collect at the shop. */
export function pickupAddress(store: StorePublic): string | null {
  return store.delivery.pickup.available ? store.delivery.pickup.address_text : null;
}

/** A map search for an address (core has no coordinates). */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
