import type { CSSProperties } from 'react';
import { formatMoney, formatSats } from '@/lib/format';

/**
 * NumberRoll: an amount whose digits roll to their new value (FCFA totals, sats).
 *
 * Each digit is a reel of 0-9 moved with a transform; separators stay still. Columns are
 * keyed from the right, so 9 500 to 45 000 rolls the units, tens and hundreds and simply adds
 * the new left digits. The formatted text is always in the DOM for assistive technology, and
 * readable from the first frame. No hooks: works in server and client components.
 *
 * Usage: <NumberRoll value={quote.total.amount} kind="xof" className="text-3xl font-bold" />
 */
export function NumberRoll({
  value,
  kind,
  className = '',
}: {
  value: number;
  kind: 'xof' | 'sats';
  className?: string;
}) {
  const text = kind === 'xof' ? formatMoney({ amount: value, currency: 'XOF' }) : formatSats(value);
  const chars = [...text];
  return (
    <span className={`tnum inline-block whitespace-nowrap ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {chars.map((ch, i) => {
          const fromRight = chars.length - i;
          if (!/\d/.test(ch)) return <span key={`s${fromRight}`}>{ch}</span>;
          return (
            <span key={`d${fromRight}`} className="roll-col">
              <span
                className="roll-reel"
                style={{ '--n': Number(ch), '--p': fromRight } as CSSProperties}
              >
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
