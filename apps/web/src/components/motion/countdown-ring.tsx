'use client';

import { type CSSProperties, useEffect, useState } from 'react';

const TICK = 1000;

/**
 * CountdownRing: a ring that empties until `expiresAt`, with the time left in the middle.
 * When it reaches zero it turns grey and reads "Expirée"; `onExpire` fires once.
 *
 * `durationMs` is the full validity of the invoice (default 15 min), so the ring shows the
 * share of time left. role="timer" is not announced on every tick (implicit aria-live off).
 *
 * Usage: <CountdownRing expiresAt={checkout.invoice.expires_at} onExpire={() => setExpired(true)} />
 */
export function CountdownRing({
  expiresAt,
  durationMs = 15 * 60_000,
  size = 88,
  onExpire,
}: {
  expiresAt: string | number | Date;
  durationMs?: number;
  size?: number;
  onExpire?: () => void;
}) {
  const end = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, end - now);
  const expired = left === 0;

  useEffect(() => {
    if (expired) {
      onExpire?.();
      return;
    }
    const id = setInterval(() => setNow(Date.now()), TICK);
    return () => clearInterval(id);
  }, [expired, onExpire]);

  const secs = Math.ceil(left / 1000);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  const share = Math.min(1, left / durationMs);

  return (
    <div
      role="timer"
      aria-label={expired ? 'Lien de paiement expiré' : `Temps restant : ${mm} min ${ss} s`}
      className={`relative inline-grid place-items-center ${expired ? 'ring-expired' : ''}`}
      style={{ width: size, height: size, '--tick': `${TICK}ms` } as CSSProperties}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" strokeWidth="3" className="ring-track" />
        <circle
          cx="20"
          cy="20"
          r="17"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={1}
          className="ring-left"
          style={{ strokeDashoffset: 1 - share }}
          suppressHydrationWarning
        />
      </svg>
      <span
        aria-hidden="true"
        className={`tnum font-semibold ${expired ? 'text-muted' : ''}`}
        suppressHydrationWarning
      >
        {expired ? 'Expirée' : `${mm}:${ss}`}
      </span>
    </div>
  );
}
