import { durationToken, motionToken, prefersReducedMotion } from './tokens';

/**
 * Flies a copy of the product photo into the cart button along an arc, then removes it.
 * Purely decorative: the cart is already written when this starts, the copy is inert and
 * hidden from assistive technology, and nothing waits for it. Returns the animation, or null.
 */
export function flyToCart(source: HTMLElement | null, fallback: HTMLElement | null) {
  const target = document.querySelector<HTMLElement>('[data-cart-target]');
  if (!source || !target || prefersReducedMotion()) return null;

  const from = source.getBoundingClientRect();
  const visible = from.bottom > 0 && from.top < window.innerHeight;
  // Photo scrolled away: a small copy takes off from the button instead.
  let box = from;
  if (!visible && fallback) {
    const b = fallback.getBoundingClientRect();
    box = new DOMRect(b.left + b.width / 2 - 32, b.top - 72, 64, 64);
  }
  const to = target.getBoundingClientRect();

  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.dataset.cartFlight = '';
  for (const el of [ghost, ...ghost.querySelectorAll<HTMLElement>('[role],[aria-label]')]) {
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    zIndex: '60',
    pointerEvents: 'none',
    borderRadius: 'var(--radius-tile)',
    overflow: 'hidden',
    willChange: 'transform, opacity',
  });
  document.body.append(ghost);

  const sx = box.left + box.width / 2;
  const sy = box.top + box.height / 2;
  const dx = to.left + to.width / 2 - sx;
  const dy = to.top + to.height / 2 - sy;
  const end = 20 / box.width;
  // Halfway, the copy is already small (about 100 px), so the whole arc stays on screen.
  const mid = Math.max(end, Math.min(0.5, 100 / box.width));
  // The arc's high point: above both ends, never above the top edge.
  const peak = Math.max((box.height * mid) / 2 + 8, Math.min(sy, sy + dy) - 60) - sy;

  const anim = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, easing: motionToken('--ease-out-expo') },
      {
        transform: `translate(${dx * 0.55}px, ${peak}px) scale(${mid})`,
        opacity: 1,
        offset: 0.5,
        easing: 'ease-in',
      },
      { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.4 },
    ],
    { duration: durationToken('--dur-hero') * 0.85, fill: 'forwards' },
  );
  const done = () => ghost.remove();
  anim.finished.then(done, done);
  return anim;
}
