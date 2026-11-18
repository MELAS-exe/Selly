import type { Image } from '@/lib/types';

/**
 * A product's photo (dominant colour while it loads), or, until the vendor adds one, the paper with the draft's dot
 * pattern and the product's initial in the serif. Fixed ratio, so grids never jump.
 */
export function Visual({
  image,
  title,
  sizes,
  priority = false,
  ratio = 'aspect-[1/1.08]',
}: {
  image: Image | null;
  title: string;
  sizes: string;
  priority?: boolean;
  ratio?: string;
}) {
  if (image)
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
        className={`${ratio} w-full object-cover`}
      />
    );
  return (
    <div
      role="img"
      aria-label={title}
      className={`sf-placeholder ${ratio} grid w-full place-items-center bg-d-paper-deep`}
    >
      <span
        aria-hidden="true"
        className="sf-serif text-[5rem] leading-none text-[var(--sf-ink)]/70 italic"
      >
        {title.trim().charAt(0).toUpperCase()}
      </span>
    </div>
  );
}
