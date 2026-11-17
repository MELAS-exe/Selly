// BTC/EUR price feeds. Each returns euro cents as a bigint; no floating point touches a price.

export interface RateFeed {
  readonly name: string;
  /** BTC price in euro cents (90,000.00 EUR is 9_000_000n). */
  btcEurCents(signal?: AbortSignal): Promise<bigint>;
}

/** "90010.5" to 9001050n. Rejects anything that is not a plain decimal. */
export function decimalToCents(value: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal price: ${value}`);
  const frac = `${m[2] ?? ''}00`.slice(0, 2);
  return BigInt(m[1] as string) * 100n + BigInt(frac);
}

type Fetch = typeof fetch;

export const krakenFeed = (f: Fetch = fetch): RateFeed => ({
  name: 'kraken',
  async btcEurCents(signal) {
    const res = await f('https://api.kraken.com/0/public/Ticker?pair=XBTEUR', { signal });
    if (!res.ok) throw new Error(`kraken ${res.status}`);
    const body = (await res.json()) as { result?: Record<string, { c?: string[] }> };
    const price = Object.values(body.result ?? {})[0]?.c?.[0];
    if (!price) throw new Error('kraken: no price');
    return decimalToCents(price);
  },
});

export const coinbaseFeed = (f: Fetch = fetch): RateFeed => ({
  name: 'coinbase',
  async btcEurCents(signal) {
    const res = await f('https://api.coinbase.com/v2/prices/BTC-EUR/spot', { signal });
    if (!res.ok) throw new Error(`coinbase ${res.status}`);
    const body = (await res.json()) as { data?: { amount?: string } };
    if (!body.data?.amount) throw new Error('coinbase: no price');
    return decimalToCents(body.data.amount);
  },
});

export function feedsFromConfig(sources: string, f: Fetch = fetch): RateFeed[] {
  const all: Record<string, RateFeed> = { kraken: krakenFeed(f), coinbase: coinbaseFeed(f) };
  return sources
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const feed = all[s];
      if (!feed) throw new Error(`unknown rate source: ${s}`);
      return feed;
    });
}
