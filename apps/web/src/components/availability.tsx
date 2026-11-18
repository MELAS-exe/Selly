import { availabilityLabel } from '@/lib/format';
import type { Availability as A } from '@/lib/types';

const tone: Record<A, string> = {
  in_stock: 'text-leaf',
  low: 'text-bissap',
  out_of_stock: 'text-muted line-through decoration-1',
};

/** Stock in words, never a raw count: core only gives exact numbers to the agent. */
export function Availability({ value }: { value: A }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${tone[value]}`}>
      {value === 'low' && (
        <span aria-hidden="true" className="low-dot motion-loop size-2 rounded-full bg-bissap" />
      )}
      {availabilityLabel[value]}
    </span>
  );
}
