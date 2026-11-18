// The shop's practical facts, in words, from the public store payload (GET /stores/{slug}).

import { formatMoney } from '@/lib/format';
import type { StorePublic } from '@/lib/types';

const DAYS: Record<string, string> = {
  'lun-sam': 'Lun – sam',
  'lun-ven': 'Lun – ven',
  'lun-dim': 'Tous les jours',
  'mar-sam': 'Mar – sam',
};

/** "Lun – sam · 09:00 – 19:00", or null without hours. */
export function hoursLabel(store: StorePublic): string | null {
  const h = store.hours[0];
  if (!h) return null;
  return `${DAYS[h.days] ?? h.days} · ${h.open.replace(':', ' h ')} – ${h.close.replace(':', ' h ')}`.replace(
    / h 00/g,
    ' h',
  );
}

/** Delivery in one line: the zones and the cheapest fee. */
export function deliveryLabel(store: StorePublic): { title: string; sub: string } | null {
  const zones = store.delivery.zones;
  if (!zones.length) return null;
  const min = Math.min(...zones.map((z) => z.fee.amount));
  return {
    title: 'Livraison à domicile',
    sub: `${zones.map((z) => z.label).join(', ')} · dès ${formatMoney({ amount: min, currency: zones[0]?.fee.currency ?? 'XOF' })}`,
  };
}

/** The pickup address, when customers can collect at the shop. */
export function pickupAddress(store: StorePublic): string | null {
  return store.delivery.pickup.available ? store.delivery.pickup.address_text : null;
}

/** A map search for an address (core has no coordinates). */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
