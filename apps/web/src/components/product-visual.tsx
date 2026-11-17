import type { Image } from '@/lib/types';

/** Same product, same colourway, on every page. */
function colourway(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

interface Props {
  image: Image | null;
  title: string;
  seed: string;
  /** Rendered width in CSS pixels, for `sizes`. */
  sizes: string;
  priority?: boolean;
  className?: string;
}

/**
 * The product photo with its dominant colour as placeholder, or, while a vendor has no photo yet,
 * a wax-print tile with the product's initial. Square, so grids never jump while images load.
 */
export function ProductVisual({ image, title, seed, sizes, priority, className = '' }: Props) {
  if (image) {
    return (
      <img
        src={image.url}
        alt={title}
        width={image.width}
        height={image.height}
        sizes={sizes}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        style={{ backgroundColor: image.dominant }}
        className={`aspect-square w-full object-cover ${className}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={title}
      className={`wax-tile wax-${colourway(seed)} grid aspect-square w-full place-items-center ${className}`}
    >
      <span
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-full bg-paper text-3xl font-bold text-ink shadow-[0_0_0_6px_rgba(255,255,255,0.35)]"
      >
        {title.trim().charAt(0).toUpperCase()}
      </span>
    </div>
  );
}
