import { core } from '@selly/db';
import { medianBigint, xofPerBtcCentsFromBtcEurCents } from '@selly/money';
import { desc } from 'drizzle-orm';
import type { Database } from '../../context';
import { AppError } from '../../errors';
import type { RateFeed } from './feeds';

export interface RateQuote {
  id: string;
  xofPerBtcCents: number;
  source: string;
  inputs: { source: string; btc_eur_cents: string }[];
  fetchedAt: Date;
  validUntil: Date;
}

const FRESH_MS = 60_000; // a quote is reused for 60 seconds
const STALE_OK_MS = 10 * 60_000; // when every feed is down, a quote under 10 minutes old is still used
const FEED_TIMEOUT_MS = 2_000;
const MIN_SOURCES = 2;

/**
 * BTC/XOF rate: median of BTC/EUR feeds times 655.957 (architecture.md section 3.6 and 4.5).
 * Every quote used by an order is a stored row.
 */
export class RateService {
  constructor(
    private readonly db: Database,
    private readonly feeds: RateFeed[],
    private readonly now: () => Date,
    private readonly minSources = MIN_SOURCES,
  ) {}

  async current(): Promise<RateQuote> {
    const now = this.now();
    const [last] = await this.db
      .select()
      .from(core.rateQuotes)
      .orderBy(desc(core.rateQuotes.fetchedAt))
      .limit(1);
    if (last && last.validUntil > now) return this.toQuote(last);

    const results = await Promise.allSettled(
      this.feeds.map(async (f) => ({
        source: f.name,
        cents: await f.btcEurCents(AbortSignal.timeout(FEED_TIMEOUT_MS)),
      })),
    );
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

    if (ok.length < Math.min(this.minSources, this.feeds.length) || ok.length === 0) {
      if (last && now.getTime() - last.fetchedAt.getTime() < STALE_OK_MS) return this.toQuote(last);
      throw new AppError('RATE_UNAVAILABLE', 'No fresh BTC/EUR quote is available.', {
        headers: { 'Retry-After': '30' },
      });
    }

    const rate = xofPerBtcCentsFromBtcEurCents(medianBigint(ok.map((o) => o.cents)));
    const inputs = ok.map((o) => ({ source: o.source, btc_eur_cents: o.cents.toString() }));
    const [row] = await this.db
      .insert(core.rateQuotes)
      .values({
        xofPerBtcCents: Number(rate),
        source: 'index',
        inputs,
        fetchedAt: now,
        validUntil: new Date(now.getTime() + FRESH_MS),
      })
      .returning();
    return this.toQuote(row as typeof core.rateQuotes.$inferSelect);
  }

  private toQuote(r: typeof core.rateQuotes.$inferSelect): RateQuote {
    return {
      id: r.id,
      xofPerBtcCents: r.xofPerBtcCents,
      source: r.source,
      inputs: r.inputs as RateQuote['inputs'],
      fetchedAt: r.fetchedAt,
      validUntil: r.validUntil,
    };
  }
}
