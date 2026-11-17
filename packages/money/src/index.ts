// Money arithmetic. Floating point is never used for money (architecture.md section 4.5).
// Rates are carried as integer centi-francs per BTC, so 59,036,130.00 XOF/BTC is 5_903_613_000n.

export const XOF_PER_EUR_MILLI = 655_957n; // 655.957 XOF per EUR, times 1000
const SAT_PER_BTC = 100_000_000n;

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** BTC/EUR given in euro cents (90,000 EUR is 9_000_000n) to XOF per BTC in centi-francs. */
export function xofPerBtcCentsFromBtcEurCents(btcEurCents: bigint): bigint {
  // euro cents x 655.957 = XOF cents. Round half up.
  return (btcEurCents * XOF_PER_EUR_MILLI + 500n) / 1000n;
}

/** Median of at least one rate. For an even count, the lower middle is returned (conservative, deterministic). */
export function medianBigint(values: bigint[]): bigint {
  if (values.length === 0) throw new Error('median of an empty list');
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)] as bigint;
}

/** Whole sats to charge for a price in XOF, rounded up so the vendor never receives less. */
export function xofToSat(totalXof: bigint, xofPerBtcCents: bigint): bigint {
  if (totalXof <= 0n) throw new Error('total must be positive');
  if (xofPerBtcCents <= 0n) throw new Error('rate must be positive');
  return ceilDiv(totalXof * SAT_PER_BTC * 100n, xofPerBtcCents);
}

export const satToMsat = (sat: bigint): bigint => sat * 1000n;

/** Indicative XOF value of a sat amount, rounded to the nearest franc. For display only. */
export function satToXofIndicative(sat: bigint, xofPerBtcCents: bigint): bigint {
  return (sat * xofPerBtcCents + (SAT_PER_BTC * 100n) / 2n) / (SAT_PER_BTC * 100n);
}
