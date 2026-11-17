/**
 * WaxSkeleton: a loading placeholder in the pale wax print, with a light sweeping across it.
 * `tile` is a square (product photo), `line` a text line, `card` a block. Hidden from
 * assistive technology; pass `label` once per loading region to say it is loading.
 *
 * Usage: <WaxSkeleton shape="tile" label="Chargement des articles" />
 */
export function WaxSkeleton({
  shape = 'line',
  className = '',
  label,
}: {
  shape?: 'tile' | 'line' | 'card';
  className?: string;
  label?: string;
}) {
  const box =
    shape === 'tile' ? 'aspect-square w-full' : shape === 'card' ? 'h-28 w-full' : 'h-4 w-3/4';
  return (
    <>
      {label && <span className="sr-only">{label}</span>}
      <div
        aria-hidden="true"
        className={`wax-skeleton wax-tile wax-0 opacity-70 ${box} ${className}`}
      />
    </>
  );
}
