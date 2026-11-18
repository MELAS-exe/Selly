'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Image } from '@/lib/types';
import { ArrowRight, X } from './draft-icons';

/**
 * A product photo that opens the full-screen viewer at that photo. The viewer cycles through all the product's
 * photos: arrows, ← →, a swipe, or the thumbnails; Escape or the backdrop closes it.
 */
export function PhotoZoom({
  images,
  index,
  title,
  children,
  className,
}: {
  images: Image[];
  index: number;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (images.length === 0) return <>{children}</>;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Agrandir la photo ${index + 1} sur ${images.length} : ${title}`}
        className={`block w-full cursor-zoom-in ${className ?? ''}`}
      >
        {children}
      </button>
      {open && (
        <Viewer
          images={images}
          start={index}
          title={title}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

function Viewer({
  images,
  start,
  title,
  onClose,
}: {
  images: Image[];
  start: number;
  title: string;
  onClose: () => void;
}) {
  const [at, setAt] = useState(start);
  const n = images.length;
  const go = useCallback((step: number) => setAt((i) => (i + step + n) % n), [n]);
  const box = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    // The page stays put behind the viewer.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose]);

  const img = images[at] as Image;
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-label={`Photos de ${title}`}
      tabIndex={-1}
      className="sf-viewer fixed inset-0 z-50 flex flex-col bg-[#0d1512]/95 text-white outline-none"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => {
        touch.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const x0 = touch.current;
        const x1 = e.changedTouches[0]?.clientX;
        touch.current = null;
        if (x0 == null || x1 == null || Math.abs(x1 - x0) < 40 || n < 2) return;
        go(x1 < x0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <p className="text-[0.9375rem] tabular-nums" aria-live="polite">
          {at + 1} / {n}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="grid size-11 place-items-center border border-white/25 hover:bg-white/10"
        >
          <X size={20} />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <img
          key={img.url}
          src={img.url}
          alt={`${title}, photo ${at + 1} sur ${n}`}
          width={img.width}
          height={img.height}
          className="sf-viewer-img max-h-full max-w-full object-contain"
          style={{ backgroundColor: img.dominant }}
        />
        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Photo précédente"
              className="absolute top-1/2 left-2 grid size-12 -translate-y-1/2 place-items-center border border-white/25 bg-black/30 hover:bg-white/10 sm:left-6"
            >
              <ArrowRight size={20} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Photo suivante"
              className="absolute top-1/2 right-2 grid size-12 -translate-y-1/2 place-items-center border border-white/25 bg-black/30 hover:bg-white/10 sm:right-6"
            >
              <ArrowRight size={20} />
            </button>
          </>
        )}
      </div>

      {n > 1 && (
        <ul className="flex justify-center gap-2 overflow-x-auto px-4 py-4 [scrollbar-width:none]">
          {images.map((im, i) => (
            <li key={im.url} className="shrink-0">
              <button
                type="button"
                onClick={() => setAt(i)}
                aria-label={`Photo ${i + 1}`}
                aria-current={i === at ? 'true' : undefined}
                className={`block size-14 overflow-clip border ${i === at ? 'border-white' : 'border-white/20 opacity-60 hover:opacity-100'}`}
              >
                <img src={im.url} alt="" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.querySelector('.sf') ?? document.body,
  );
}
