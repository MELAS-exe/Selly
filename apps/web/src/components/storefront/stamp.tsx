'use client';

import { useId } from 'react';

/** Text on a turning circle around the S mark, as on the landing page (paused off screen by nothing: it is small). */
export function Stamp({ text }: { text: string }) {
  const id = useId();
  return (
    <div className="relative size-28" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="pv-spin motion-loop size-full text-d-ink">
        <path id={id} d="M 60, 60 m -45, 0 a 45,45 0 1,1 90,0 a 45,45 0 1,1 -90,0" fill="none" />
        <text className="fill-current text-[10px] tracking-[0.3em] uppercase">
          <textPath href={`#${id}`}>{text}</textPath>
        </text>
      </svg>
      <img src="/brand/selly-s.png" alt="" className="absolute inset-0 m-auto w-9" />
    </div>
  );
}
