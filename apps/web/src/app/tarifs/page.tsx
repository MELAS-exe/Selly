import type { Metadata } from 'next';
import Link from 'next/link';
import { Eyebrow, PageShell } from '@/components/brand/page-shell';
import { getPlans } from '@/lib/core';
import { formatFcfa, formatSats, period, periodLine, planFeatures } from '@/lib/plan-format';
import type { Plan, PlansResponse } from '@/lib/vendor-types';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Selly plans for online shops in Senegal: Starter, Pro and Business. Paid in sats, straight from your wallet. 14-day Pro trial.',
};

// Prices and the rate come from core and move; the data is cached for 5 minutes (lib/core.ts), the page is built per request.
export const dynamic = 'force-dynamic';

const BLURB: Record<Plan['id'], string> = {
  starter: 'To test online sales',
  pro: 'For an active shop',
  business: 'For a busy shop with a large catalog',
};

async function load(): Promise<PlansResponse | null> {
  try {
    return await getPlans();
  } catch {
    return null;
  }
}

function PlanCard({
  plan,
  featured,
  trialDays,
}: {
  plan: Plan;
  featured: boolean;
  trialDays: number;
}) {
  const monthly = period(plan, 1);
  const longer = plan.periods.filter((p) => p.months !== 1);
  return (
    <li
      className={`flex flex-col p-8 border ${
        featured ? 'bg-[#111] text-white border-[#111]' : 'bg-[#F6F4F0] border-[#1111111f]'
      }`}
    >
      <h2 className="pv-serif text-4xl font-light">{plan.name}</h2>
      <p
        className={`pv-sans text-[10px] uppercase tracking-[0.2em] mt-2 ${
          featured ? 'text-white/60' : 'text-black/60'
        }`}
      >
        {BLURB[plan.id]}
      </p>

      <p className="mt-8 flex items-baseline gap-2">
        <span className="pv-serif text-5xl font-light tnum">
          {plan.monthly_price_sat.toLocaleString('en-US')}
        </span>
        <span className="pv-sans text-xs uppercase tracking-widest opacity-70">sats / month</span>
      </p>
      <p className={`pv-sans text-xs mt-1 tnum ${featured ? 'text-white/60' : 'text-black/60'}`}>
        {monthly?.indicative_xof != null
          ? `About ${formatFcfa(monthly.indicative_xof)} a month`
          : ' '}
      </p>

      <ul
        className={`mt-6 space-y-1 pv-sans text-xs tnum ${featured ? 'text-white/70' : 'text-black/60'}`}
      >
        {longer.map((p) => (
          <li key={p.months}>{periodLine(p)}</li>
        ))}
      </ul>

      <ul className="mt-8 pt-8 border-t border-current/15 space-y-3 pv-sans text-sm leading-snug flex-1">
        {planFeatures(plan).map((line) => (
          <li key={line} className="flex gap-4">
            <span className="w-4 h-px bg-[#8AAE4A] mt-[0.7em] shrink-0" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/app/login"
        className={`mt-10 pv-sans text-xs uppercase tracking-[0.2em] font-medium border py-4 px-6 text-center transition-colors ${
          featured
            ? 'border-[#8AAE4A] bg-[#8AAE4A] text-[#173B32] hover:bg-transparent hover:text-[#A3C651]'
            : 'border-[#173B32] text-[#173B32] hover:bg-[#173B32] hover:text-[#F6F4F0]'
        }`}
      >
        {featured ? `Start your ${trialDays}-day free trial` : 'Get started'}
      </Link>
    </li>
  );
}

export default async function PricingPage() {
  const plans = await load();

  return (
    <PageShell>
      <main>
        <section className="pt-20 pb-12 md:pt-28 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f]">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="pv-serif text-5xl md:text-7xl font-light leading-[1.05] max-w-3xl">
            One simple price. <span className="italic text-[#8AAE4A]">Paid in sats.</span>
          </h1>
          <p className="pv-sans text-sm md:text-base leading-relaxed text-black/70 max-w-xl mt-8">
            Selly never takes a cut of your sales: customers pay straight to your wallet. You pay a
            flat plan, from your own wallet, when you choose. No automatic charges.
          </p>
        </section>

        <section
          aria-label="Plans"
          className="pb-20 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f]"
        >
          {plans ? (
            <ul className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {plans.data.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  featured={plan.id === plans.trial.plan_id}
                  trialDays={plans.trial.days}
                />
              ))}
            </ul>
          ) : (
            <p role="alert" className="pv-sans text-sm border border-[#1111111f] p-8">
              The plans could not be loaded just now. Please refresh the page in a moment.
            </p>
          )}

          {plans?.rate && (
            <p className="pv-sans text-[11px] text-black/50 mt-6 tnum">
              FCFA amounts are indicative, at 1 BTC = {formatFcfa(plans.rate.xof_per_btc)}. The
              price you pay is always the price in sats.
            </p>
          )}
        </section>

        <section className="py-20 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-[#1111111f]">
          <Eyebrow>How paying works</Eyebrow>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-10 mt-4">
            {[
              [
                'Pick a plan',
                'Choose a plan and 1, 3 or 12 months. Longer periods cost less per month.',
              ],
              [
                'Pay from your wallet',
                'Selly shows a Lightning invoice, valid for an hour. Scan it or tap the link, and your wallet does the rest.',
              ],
              [
                'Nothing renews on its own',
                'We hold no key to your wallet. Before your period ends we remind you, and a week of grace keeps your shop open.',
              ],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-6">
                <span className="pv-serif italic text-4xl text-[#8AAE4A] leading-none tnum">
                  {i + 1}
                </span>
                <div>
                  <h3 className="pv-serif text-2xl mb-2">{title}</h3>
                  <p className="pv-sans text-sm leading-relaxed text-black/60">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="pv-sans text-sm text-black/60 mt-12">
            No bitcoin yet?{' '}
            <Link
              href="/aide/payer-en-bitcoin"
              className="underline underline-offset-4 hover:text-[#173B32]"
            >
              See how to get some with Orange Money or Wave
            </Link>
            .
          </p>
        </section>
      </main>
    </PageShell>
  );
}
