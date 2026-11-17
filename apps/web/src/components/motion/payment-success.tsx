'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { durationToken, prefersReducedMotion } from './tokens';

/**
 * PaymentSuccess: the "payment received" sequence, around the QR code.
 *
 * While `paid` is false it simply shows its child (the QR). When `paid` turns true:
 * a lightning bolt sweeps across the QR (clip-path), the QR shrinks away and becomes a large
 * green check (leaf) that draws itself, then a short burst of confetti (canvas, loaded with a
 * dynamic import at that moment). About 600 ms, plus the confetti falling.
 *
 * The message ("Paiement reçu…") is shown at once, in a role="status" region: the words never
 * wait for the animation. Once paid, the QR is hidden from assistive technology (it no longer
 * matters), which is a state change, not something the animation does.
 *
 * Usage:
 *   <PaymentSuccess paid={status === 'paid'} message={`Paiement reçu. Commande ${ref} confirmée.`}>
 *     <div dangerouslySetInnerHTML={{ __html: invoice.qr_svg }} />
 *   </PaymentSuccess>
 */
export function PaymentSuccess({
  paid,
  message,
  children,
}: {
  paid: boolean;
  message: ReactNode;
  children: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!paid || prefersReducedMotion()) return;
    const t = setTimeout(() => {
      import('./confetti').then((m) => stage.current && m.burst(stage.current));
    }, durationToken('--dur-hero') * 0.65);
    return () => clearTimeout(t);
  }, [paid]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div ref={stage} className="pay-stage" data-paid={paid}>
        <div className="pay-qr" aria-hidden={paid || undefined} inert={paid || undefined}>
          {children}
        </div>
        {paid && (
          <div className="pay-check grid size-40 place-items-center rounded-full bg-leaf text-paper">
            <svg
              viewBox="0 0 24 24"
              className="size-20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path pathLength={1} d="M4.5 12.5l5 5 10-11" />
            </svg>
          </div>
        )}
        <svg viewBox="0 0 64 96" className="pay-bolt" aria-hidden="true">
          <path fill="currentColor" d="M38 0 6 54h22l-8 42 38-60H34z" />
        </svg>
      </div>
      <p role="status" className="min-h-[2lh] text-center text-lg font-semibold text-leaf">
        {paid ? message : null}
      </p>
    </div>
  );
}
