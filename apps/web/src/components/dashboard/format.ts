// Numbers, dates and labels of the dashboard, in the vendor's language (French for Senegal unless the shop is in
// English: lib/i18n.ts). Senegal is UTC all year. The frame sets the language once the vendor is known
// (setDashboardLang); the dashboard runs in the browser only, for one vendor at a time.
import { formatOptions as formatOptionsIn } from '@/lib/format';
import { type Lang, translator } from '@/lib/i18n';
import type { ConversationMode, OrderStatus, VendorOrder } from './types';

const TZ = 'Africa/Dakar';
let lang: Lang = 'fr';
const tag = () => (lang === 'en' ? 'en-GB' : 'fr-FR');
const t = (fr: string, en: string) => translator(lang)(fr, en);

/** The dashboard's language, from the vendor's locale (shell.tsx). */
export function setDashboardLang(next: Lang) {
  lang = next;
}
export const dashboardLang = () => lang;

const int = () => new Intl.NumberFormat(tag());
export const fmtInt = (n: number) => int().format(n);
export const fmtXof = (n: number) => `${int().format(n)} FCFA`;
export const fmtSats = (n: number) => `${int().format(n)} sats`;
export const formatOptions = (o: Parameters<typeof formatOptionsIn>[0]) => formatOptionsIn(o, lang);

/** "28,5k" for chart axes. */
export function fmtShort(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString(tag(), { maximumFractionDigits: 1 })}M`;
  if (n >= 1000) return `${(n / 1000).toLocaleString(tag(), { maximumFractionDigits: 1 })}k`;
  return String(n);
}

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag(), o);
const dayFmt = () => fmt({ timeZone: TZ, day: 'numeric', month: 'short' });

export const fmtDay = (iso: string) => dayFmt().format(new Date(iso));
export const fmtMonth = (iso: string) =>
  fmt({ timeZone: 'UTC', month: 'short' }).format(new Date(`${iso}T00:00:00Z`));
export const fmtTime = (iso: string) =>
  fmt({ timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtLongDate = (iso: string) =>
  fmt({ timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
export const fmtToday = (now = new Date()) => {
  const s = fmt({ timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function sameDay(a: Date, b: Date) {
  return dayFmt().format(a) === dayFmt().format(b) && a.getUTCFullYear() === b.getUTCFullYear();
}

/** "Aujourd'hui, 10:42", "Hier, 17:36", "12 nov., 09:18" ("Today, 10:42"… in English). */
export function fmtWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const day = sameDay(d, now)
    ? t('Aujourd’hui', 'Today')
    : sameDay(d, yesterday)
      ? t('Hier', 'Yesterday')
      : fmtDay(iso);
  return `${day}, ${fmtTime(iso)}`;
}

/** "à l'instant", "il y a 4 min", "il y a 3 h", then the date ("just now", "4 min ago"… in English). */
export function fmtAgo(iso: string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('à l’instant', 'just now');
  if (s < 3600) return t(`il y a ${Math.floor(s / 60)} min`, `${Math.floor(s / 60)} min ago`);
  if (s < 86_400) return t(`il y a ${Math.floor(s / 3600)} h`, `${Math.floor(s / 3600)} h ago`);
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

type Tone = 'paid' | 'pending' | 'ready' | 'alert' | 'muted';

/** Badge class and label of an order, attention first: a double or stockless payment needs a refund. */
export function orderBadge(o: Pick<VendorOrder, 'status' | 'attention'>): {
  tone: Tone;
  label: string;
} {
  if (o.attention === 'paid_twice')
    return { tone: 'alert', label: t('Payée deux fois', 'Paid twice') };
  if (o.attention === 'paid_without_stock')
    return { tone: 'alert', label: t('Payée sans stock', 'Paid without stock') };
  return ORDER_STATUS[o.status];
}

/** An order's status as a badge, in the dashboard's language (read at use, not at load). */
export const ORDER_STATUS = {
  get pending_payment() {
    return { tone: 'pending' as Tone, label: t('Attente paiement', 'Awaiting payment') };
  },
  get paid() {
    return { tone: 'paid' as Tone, label: t('Payée · à expédier', 'Paid · to ship') };
  },
  get fulfilled() {
    return { tone: 'ready' as Tone, label: t('Expédiée', 'Shipped') };
  },
  get expired() {
    return { tone: 'muted' as Tone, label: t('Expirée', 'Expired') };
  },
  get cancelled() {
    return { tone: 'muted' as Tone, label: t('Annulée', 'Cancelled') };
  },
} satisfies Record<OrderStatus, { tone: Tone; label: string }>;

export const MODE_LABEL = {
  get bot() {
    return t('L’assistant répond', 'The assistant replies');
  },
  get human() {
    return t('Vous avez la main', 'You have the conversation');
  },
  get paused() {
    return t('Assistant en pause', 'Assistant paused');
  },
} satisfies Record<ConversationMode, string>;

export function itemsLine(o: Pick<VendorOrder, 'items'>): string {
  const [first, ...rest] = o.items;
  if (!first) return '';
  const opts = formatOptions(first.options);
  const head = `${first.title}${opts ? ` · ${opts}` : ''}${first.quantity > 1 ? ` × ${first.quantity}` : ''}`;
  const more = rest.length;
  return more ? `${head} + ${more} ${t(`autre${more > 1 ? 's' : ''}`, `more`)}` : head;
}
