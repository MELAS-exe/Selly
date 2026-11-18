// Numbers, dates and labels of the dashboard, in French for Senegal (architecture.md 3.4). Senegal is UTC all year.
import { formatOptions } from '@/lib/format';
import type { ConversationMode, OrderStatus, VendorOrder } from './types';

const TZ = 'Africa/Dakar';
const int = new Intl.NumberFormat('fr-FR');

export const fmtInt = (n: number) => int.format(n);
export const fmtXof = (n: number) => `${int.format(n)} FCFA`;
export const fmtSats = (n: number) => `${int.format(n)} sats`;
export { formatOptions };

/** "28,5k" for chart axes. */
export function fmtShort(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}M`;
  if (n >= 1000) return `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}k`;
  return String(n);
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});
const longFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const weekdayFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

export const fmtDay = (iso: string) => dayFmt.format(new Date(iso));
export const fmtMonth = (iso: string) => monthFmt.format(new Date(`${iso}T00:00:00Z`));
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtLongDate = (iso: string) => longFmt.format(new Date(iso));
export const fmtToday = (now = new Date()) => {
  const s = weekdayFmt.format(now);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function sameDay(a: Date, b: Date) {
  return dayFmt.format(a) === dayFmt.format(b) && a.getUTCFullYear() === b.getUTCFullYear();
}

/** "Aujourd'hui, 10:42", "Hier, 17:36", "12 nov., 09:18". */
export function fmtWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const day = sameDay(d, now) ? 'Aujourd’hui' : sameDay(d, yesterday) ? 'Hier' : fmtDay(iso);
  return `${day}, ${fmtTime(iso)}`;
}

/** "à l'instant", "il y a 4 min", "il y a 3 h", then the date. */
export function fmtAgo(iso: string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  return fmtWhen(iso, now);
}

/** Whole days from now to a date, rounded up ("encore 3 jours"). */
export function daysUntil(iso: string, now = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '·';

/** Badge class and label of an order, attention first: a double or stockless payment needs a refund. */
export function orderBadge(o: Pick<VendorOrder, 'status' | 'attention'>): {
  tone: 'paid' | 'pending' | 'ready' | 'alert' | 'muted';
  label: string;
} {
  if (o.attention === 'paid_twice') return { tone: 'alert', label: 'Payée deux fois' };
  if (o.attention === 'paid_without_stock') return { tone: 'alert', label: 'Payée sans stock' };
  return ORDER_STATUS[o.status];
}

export const ORDER_STATUS: Record<
  OrderStatus,
  { tone: 'paid' | 'pending' | 'ready' | 'alert' | 'muted'; label: string }
> = {
  pending_payment: { tone: 'pending', label: 'Attente paiement' },
  paid: { tone: 'paid', label: 'Payée · à expédier' },
  fulfilled: { tone: 'ready', label: 'Expédiée' },
  expired: { tone: 'muted', label: 'Expirée' },
  cancelled: { tone: 'muted', label: 'Annulée' },
};

export const MODE_LABEL: Record<ConversationMode, string> = {
  bot: 'L’assistant répond',
  human: 'Vous avez la main',
  paused: 'Assistant en pause',
};

export function itemsLine(o: Pick<VendorOrder, 'items'>): string {
  const [first, ...rest] = o.items;
  if (!first) return '';
  const opts = formatOptions(first.options);
  const head = `${first.title}${opts ? ` · ${opts}` : ''}${first.quantity > 1 ? ` × ${first.quantity}` : ''}`;
  return rest.length ? `${head} + ${rest.length} autre${rest.length > 1 ? 's' : ''}` : head;
}
