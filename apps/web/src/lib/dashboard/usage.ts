export type GaugeLevel = 'ok' | 'warn' | 'full';

/** A usage bar: share used (capped at 100), what is left, and a level from 80 % (warn) and at the limit (full). */
export function usageGauge(u: { used: number; limit: number }): {
  percent: number;
  level: GaugeLevel;
  left: number;
} {
  if (u.limit <= 0) return { percent: 100, level: 'full', left: 0 };
  const percent = Math.min(100, Math.round((u.used / u.limit) * 100));
  const left = Math.max(0, u.limit - u.used);
  const level: GaugeLevel = left === 0 ? 'full' : percent >= 80 ? 'warn' : 'ok';
  return { percent, level, left };
}
