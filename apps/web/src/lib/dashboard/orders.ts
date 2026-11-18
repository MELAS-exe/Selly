import { dayKey, dayLabel } from './time';

export interface DayGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/** Orders grouped by calendar day, newest day and newest order first. */
export function groupOrders<T extends { created_at: string }>(
  orders: T[],
  now: Date = new Date(),
): DayGroup<T>[] {
  const sorted = [...orders].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups: DayGroup<T>[] = [];
  for (const o of sorted) {
    const key = dayKey(o.created_at);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(o);
    else groups.push({ key, label: dayLabel(o.created_at, now), items: [o] });
  }
  return groups;
}
