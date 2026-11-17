import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { medianBigint, satToMsat, xofPerBtcCentsFromBtcEurCents, xofToSat } from './index';

describe('money', () => {
  it('converts BTC/EUR to XOF per BTC (architecture.md 4.5 example)', () => {
    expect(xofPerBtcCentsFromBtcEurCents(9_000_000n)).toBe(5_903_613_000n);
  });

  it('prices 16,000 XOF at 27,103 sats', () => {
    expect(xofToSat(16_000n, 5_903_613_000n)).toBe(27_103n);
    expect(satToMsat(27_103n)).toBe(27_103_000n);
  });

  it('takes the median', () => {
    expect(medianBigint([3n, 1n, 2n])).toBe(2n);
    expect(medianBigint([4n, 1n, 2n, 3n])).toBe(2n);
  });

  // P1: the sats amount never pays less than the XOF price at the quoted rate.
  it('P1: never undercharges', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000_000n }),
        fc.bigInt({ min: 1_000_000_00n, max: 500_000_000_00n }),
        (xof, rateCents) => {
          const sat = xofToSat(xof, rateCents);
          expect(sat * rateCents).toBeGreaterThanOrEqual(xof * 100_000_000n * 100n);
          expect((sat - 1n) * rateCents).toBeLessThan(xof * 100_000_000n * 100n);
        },
      ),
    );
  });
});
