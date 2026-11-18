'use client';

// The dashboard's small pieces, with the draft's markup and class names (dashboard.css).
import { type ReactNode, useEffect, useId } from 'react';
import { errorText } from './data';
import { CircleCheck, Clock, type IconComponent, X } from './icons';

export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-title-row">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <div className="panel-sub">{description}</div>}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  note,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note: ReactNode;
  icon: IconComponent;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        <Icon size={14} />
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: 'paid' | 'pending' | 'ready' | 'alert' | 'muted' | 'review';
  children: ReactNode;
}) {
  return (
    <span className={`status ${tone}`}>
      {tone === 'paid' || tone === 'ready' ? <CircleCheck size={11} /> : null}
      {tone === 'pending' ? <Clock size={11} /> : null}
      {children}
    </span>
  );
}

export function PanelHead({
  title,
  sub,
  action,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <div className="panel-title">{title}</div>
        {sub && <div className="panel-sub">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: IconComponent;
  title: string;
  text: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={24} strokeWidth={1.5} />
      <strong>{title}</strong>
      {text}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/** What a page shows while its first read is on the way, or when it failed. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="panel" aria-busy="true" style={{ padding: 22 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 18, marginBottom: 14, width: `${90 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

export function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="panel">
      <div className="empty-state" role="alert">
        <strong>Impossible de charger</strong>
        {errorText(error)}
        <div style={{ marginTop: 16 }}>
          <button type="button" className="button small" onClick={retry}>
            Réessayer
          </button>
        </div>
      </div>
    </div>
  );
}

export function InfoRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Progress({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={used} aria-valuemax={limit}>
      <span
        className={pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
