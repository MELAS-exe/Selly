// Dates as a vendor reads them on a phone: "5 min ago", "yesterday", "2 Oct".

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** Calendar days between two instants, in the vendor's time zone. */
function daysBetween(a: Date, b: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(b) - start(a)) / DAY);
}

export function relativeTime(at: string | Date, now: Date = new Date()): string {
  const then = new Date(at);
  const diff = now.getTime() - then.getTime();
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  const days = daysBetween(then, now);
  if (days === 0) return `${Math.floor(diff / HOUR)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return dayMonth.format(then);
}

/** "Today", "Yesterday" or "16 Nov": the heading of a day in a list. */
export function dayLabel(at: string | Date, now: Date = new Date()): string {
  const days = daysBetween(new Date(at), now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return dayMonth.format(new Date(at));
}

/** A key for the calendar day, for grouping. */
export function dayKey(at: string | Date): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
