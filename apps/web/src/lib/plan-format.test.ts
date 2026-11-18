import { describe, expect, it } from 'vitest';
import { formatFcfa, formatSats, period, periodLine, planFeatures } from './plan-format';
import type { Plan } from './vendor-types';

const pro: Plan = {
  id: 'pro',
  name: 'Pro',
  monthly_price_sat: 15000,
  periods: [
    { months: 1, price_sat: 15000, discount_pct: 0, indicative_xof: 8850 },
    { months: 3, price_sat: 42750, discount_pct: 5, indicative_xof: 25200 },
    { months: 12, price_sat: 150000, discount_pct: 17, indicative_xof: 88500 },
  ],
  limits: {
    products: 200,
    agent_turns_per_month: 1500,
    drafts_per_month: 100,
    voice_notes: true,
    nostr_dm_alerts: true,
    powered_by_badge: false,
    embed_widget: false,
    support: 'two_working_days',
  },
};

describe('plan formatting', () => {
  it('writes amounts with separators', () => {
    expect(formatSats(15000)).toBe('15,000 sats');
    expect(formatFcfa(8850)).toBe('8,850 FCFA');
  });

  it('finds a period and describes the longer ones', () => {
    expect(period(pro, 1)?.price_sat).toBe(15000);
    expect(periodLine(pro.periods[1] as Plan['periods'][number])).toBe(
      '3 months: 42,750 sats (5% off)',
    );
    expect(periodLine(pro.periods[0] as Plan['periods'][number])).toBe('1 month: 15,000 sats');
  });

  it('lists what a plan includes, from its limits', () => {
    const lines = planFeatures(pro);
    expect(lines).toContain('Up to 200 products');
    expect(lines).toContain('1,500 assistant replies a month');
    expect(lines).toContain('The assistant understands voice notes');
    expect(lines).toContain('Reply within 2 working days');
    expect(lines.some((l) => l.includes('own domain'))).toBe(false);
  });

  it('mentions the badge and the planned widget only where they apply', () => {
    const starter: Plan = {
      ...pro,
      id: 'starter',
      limits: { ...pro.limits, powered_by_badge: true, voice_notes: false, nostr_dm_alerts: false },
    };
    const lines = planFeatures(starter);
    expect(lines).toContain('Text messages only');
    expect(lines).toContain('"Powered by Selly" shown on your shop');
    const business = planFeatures({ ...pro, limits: { ...pro.limits, embed_widget: true } });
    expect(business.some((l) => l.includes('own domain'))).toBe(true);
  });
});
