'use client';

// The dashboard's small building blocks: paper, hairlines, serif figures, the mascot for empty states.

import { type ReactNode, useState } from 'react';
import { dash } from '@/lib/i18n/dashboard';
import { describeError } from '@/lib/onboarding';
import type { OrderStatus } from '@/lib/types';

export const btn = {
  primary:
    'press inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-d-ink px-5 font-medium text-d-paper disabled:opacity-40',
  secondary:
    'press inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] border border-d-ink/30 bg-transparent px-5 font-medium text-d-ink hover:border-d-ink disabled:opacity-40',
  danger:
    'press inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] border border-d-alert/40 px-5 font-medium text-d-alert hover:border-d-alert disabled:opacity-40',
  quiet:
    'inline-flex min-h-11 items-center gap-2 font-medium text-d-ink underline decoration-d-ink/30 underline-offset-4 hover:decoration-d-ink',
};

export const field =
  'w-full min-h-11 rounded-[6px] border border-d-hairline bg-d-paper px-3 py-2 text-d-ink placeholder:text-d-ink-soft/70 focus:border-d-ink focus:outline-none';

/** A page title in the site's serif. */
export function Title({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 pb-4">
      <h1 className="font-display text-[2.25rem] leading-none font-medium">{children}</h1>
      {aside}
    </div>
  );
}

/** A rare small label, spaced capitals, with the landing page's hairline in front. */
export function Label({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="mb-3 flex items-center gap-3 text-sm font-medium tracking-[0.14em] text-d-ink-soft uppercase"
    >
      <span aria-hidden="true" className="h-px w-6 bg-d-lime-deep" />
      {children}
    </h2>
  );
}

/** A section separated by a hairline instead of a shadowed card. */
export function Section({
  children,
  className = '',
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`border-t border-d-hairline py-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`d-skeleton ${className}`} />;
}

/** Lines of placeholder for a list, with a status for screen readers. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" className="space-y-4 py-2">
      <span className="sr-only">{dash.shell.loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-d-hairline pb-4">
          <Skeleton className="h-11 w-11 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

/** An error in words, with what to do. Never an endless spinner. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="border-l-2 border-d-alert py-3 pl-4">
      <p className="font-medium">{dash.common.errorTitle}</p>
      <p className="text-d-ink-soft">{describeError(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${btn.secondary} mt-3`}>
          {dash.common.retry}
        </button>
      )}
    </div>
  );
}

/** The mascot, a sentence about what is (not) here, and what to do about it. */
export function EmptyState({
  title,
  text,
  action,
  compact = false,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-5 ${compact ? 'py-4' : 'py-8'}`}>
      <img
        src="/brand/selly-mascot.webp"
        alt=""
        width={800}
        height={800}
        loading="lazy"
        decoding="async"
        className={`shrink-0 ${compact ? 'size-16' : 'size-24'} object-contain`}
      />
      <div>
        <p className="font-display text-2xl leading-tight">{title}</p>
        {text && <p className="mt-1 text-d-ink-soft">{text}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

const pill: Record<OrderStatus, string> = {
  pending_payment: 'bg-d-pending-soft text-d-pending',
  paid: 'bg-d-paid-soft text-d-paid',
  fulfilled: 'bg-d-paper-deep text-d-ink',
  cancelled: 'bg-d-cancelled-soft text-d-cancelled',
  expired: 'bg-d-cancelled-soft text-d-cancelled',
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-medium ${pill[status]}`}>
      {dash.orders.status[status]}
    </span>
  );
}

/** Copy and share the shop link (Web Share API where the phone has it). */
export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={btn.primary}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            // Clipboard refused: the link stays visible for a manual copy.
          }
        }}
      >
        {copied ? dash.common.copied : dash.common.copy}
      </button>
      {canShare && (
        <button
          type="button"
          className={btn.secondary}
          onClick={() => navigator.share({ url }).catch(() => {})}
        >
          {dash.common.share}
        </button>
      )}
      <span role="status" className="sr-only">
        {copied ? dash.common.copied : ''}
      </span>
    </div>
  );
}
