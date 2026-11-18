import type { Plan, PlanLimits, PlanPeriod } from './vendor-types';

const number = new Intl.NumberFormat('en-US');

export const formatSats = (sats: number) => `${number.format(sats)} sats`;
export const formatFcfa = (xof: number) => `${number.format(xof)} FCFA`;

export const period = (plan: Plan, months: PlanPeriod['months']) =>
  plan.periods.find((p) => p.months === months);

const SUPPORT: Record<PlanLimits['support'], string> = {
  help_pages: 'Help pages',
  two_working_days: 'Reply within 2 working days',
  one_working_day: 'Reply within 1 working day',
};

/** What a plan includes, in the order a vendor compares them. Every line is a plain sentence. */
export function planFeatures(plan: Plan): string[] {
  const l = plan.limits;
  const out = [
    `Up to ${number.format(l.products)} products`,
    'Unlimited orders and payments',
    `${number.format(l.agent_turns_per_month)} assistant replies a month`,
    `${number.format(l.drafts_per_month)} photo-to-product drafts a month`,
    l.voice_notes ? 'The assistant understands voice notes' : 'Text messages only',
    l.nostr_dm_alerts
      ? 'Alerts in the dashboard, by push and by Nostr message'
      : 'Alerts in the dashboard and by push',
    l.powered_by_badge ? '"Powered by Selly" shown on your shop' : 'No "Powered by Selly" badge',
    SUPPORT[l.support],
  ];
  if (l.embed_widget) out.push('Chat on your own domain (planned after launch)');
  return out;
}

/** "3 months" / "12 months" line under the monthly price. */
export function periodLine(p: PlanPeriod): string {
  const off = p.discount_pct > 0 ? ` (${p.discount_pct}% off)` : '';
  return `${p.months} ${p.months === 1 ? 'month' : 'months'}: ${formatSats(p.price_sat)}${off}`;
}
