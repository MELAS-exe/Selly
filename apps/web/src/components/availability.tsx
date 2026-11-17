import { availabilityLabel } from '@/lib/format';
import type { Availability as A } from '@/lib/types';

const tone: Record<A, string> = {
  in_stock: 'text-leaf',
  low: 'text-bissap',
  out_of_stock: 'text-muted line-through decoration-1',
};

/** Stock in words, never a raw count: core only gives exact numbers to the agent. */
export function Availability({ value }: { value: A }) {
  return <span className={`font-medium ${tone[value]}`}>{availabilityLabel[value]}</span>;
}
