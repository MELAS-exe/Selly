import type { ReactNode } from 'react';

/**
 * ListeningPulse: a slow breathing around its child (the QR) while a payment is awaited.
 * Two rings scale out and fade, behind the child; it stops when `active` is false and under
 * reduced motion. Decorative only: the waiting state must also be said in words.
 *
 * Usage: <ListeningPulse active={status === 'pending_payment'}>{qr}</ListeningPulse>
 */
export function ListeningPulse({
  active = true,
  children,
  className = '',
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return <div className={`listen ${active ? 'is-listening' : ''} ${className}`}>{children}</div>;
}
