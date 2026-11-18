'use client';

// Catalog: add a product from a photo (an AI draft the vendor always checks before it is published),
// the drafts to review, and the products with their stock, price and quick edits.

import { type FormEvent, useId, useState } from 'react';
import { ApiError, api } from '@/lib/browser-api';
import { useInvalidate, useResource } from '@/lib/dashboard/resource';
import type {
  Draft,
  Metrics,
  Page,
  Upload,
  VendorProduct,
  VendorVariant,
} from '@/lib/dashboard/types';
import { formatMoney, formatOptions } from '@/lib/format';
import { dash } from '@/lib/i18n/dashboard';
import { describeError } from '@/lib/onboarding';
import type { Money } from '@/lib/types';
import { btn, EmptyState, ErrorState, field, Label, ListSkeleton, Section, Title } from './ui';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Presigned upload: ask core for a URL, send the file straight to storage, keep the key. */
async function uploadImage(file: File): Promise<string> {
  const type = IMAGE_TYPES.find((t) => t === file.type);
  if (!type)
    throw new ApiError({ type: 'about:blank', title: 'Type', status: 422, code: 'MEDIA_TYPE' });
  const up = await api<Upload>('/media/uploads', {
    method: 'POST',
    body: { content_type: type, size_bytes: file.size },
  });
  const res = await fetch(up.upload_url, { method: up.method, headers: up.headers, body: file });
  if (!res.ok)
    throw new ApiError({
      type: 'about:blank',
      title: 'Upload',
      status: res.status,
      code: 'UPLOAD_FAILED',
    });
  return up.storage_key;
}

function AddFromPhoto() {
  const id = useId();
  const invalidate = useInvalidate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'uploading' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setState('uploading');
    setError(null);
    try {
      const key = await uploadImage(file);
      await api<Draft>('/inventory/restock-ai', {
        method: 'POST',
        body: { image_keys: [key], text: text.trim() },
        idempotencyKey: crypto.randomUUID(),
      });
      setState('sent');
      setFile(null);
      setPreview(null);
      setText('');
      invalidate(['drafts']);
    } catch (err) {
      setState('idle');
      setError(describeError(err));
    }
  }

  return (
    <Section labelledBy={`${id}-l`}>
      <Label id={`${id}-l`}>{dash.catalog.addPhoto}</Label>
      <p className="mb-3 text-d-ink-soft">{dash.catalog.addPhotoHint}</p>
      <form onSubmit={submit} className="space-y-3">
        <label
          htmlFor={`${id}-f`}
          className="flex min-h-28 cursor-pointer items-center gap-4 rounded-[6px] border border-dashed border-d-ink/30 p-3 hover:border-d-ink"
        >
          {preview ? (
            <img src={preview} alt="" className="size-20 rounded-[4px] object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-20 place-items-center rounded-[4px] bg-d-paper-deep text-3xl"
            >
              +
            </span>
          )}
          <span className="font-medium">{file ? file.name : dash.catalog.addPhoto}</span>
          <input
            id={`${id}-f`}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setState('idle');
              if (preview) URL.revokeObjectURL(preview);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
        </label>
        <div>
          <label htmlFor={`${id}-t`} className="block font-medium">
            {dash.catalog.describe}
          </label>
          <input
            id={`${id}-t`}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            placeholder={dash.catalog.describePlaceholder}
            className={`${field} mt-1`}
          />
        </div>
        <button type="submit" disabled={!file || state === 'uploading'} className={btn.primary}>
          {state === 'uploading' ? dash.catalog.uploading : dash.catalog.sendPhoto}
        </button>
        <p role="status" className="text-d-ink-soft">
          {state === 'sent' ? dash.catalog.drafting : ''}
        </p>
        {error && (
          <p role="alert" className="text-d-alert">
            {error}
          </p>
        )}
      </form>
    </Section>
  );
}

type Extracted = {
  title?: { value: string };
  description?: { value: string };
  category?: { value: string };
  price?: { value: Money };
  variants?: { options: Record<string, string>; stock?: number | null }[];
};

function DraftCard({ draft }: { draft: Draft }) {
  const id = useId();
  const invalidate = useInvalidate();
  const x = (draft.extracted ?? {}) as Extracted;
  const [title, setTitle] = useState(x.title?.value ?? '');
  const [description, setDescription] = useState(x.description?.value ?? '');
  const [price, setPrice] = useState(String(x.price?.value.amount ?? ''));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: body ?? {} });
      invalidate(['drafts', 'inventory', 'metrics']);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (draft.status === 'processing')
    return (
      <li className="border-b border-d-hairline py-4 text-d-ink-soft" role="status">
        {dash.catalog.draftProcessing} {draft.input_text && <q>{draft.input_text}</q>}
      </li>
    );

  if (draft.status === 'failed')
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 border-b border-d-hairline py-4">
        <p className="text-d-alert">{dash.catalog.draftFailed}</p>
        <button
          type="button"
          disabled={busy}
          className={btn.secondary}
          onClick={() => run(`/inventory/drafts/${draft.id}/discard`)}
        >
          {dash.catalog.discard}
        </button>
      </li>
    );

  const amount = Number(price.replace(/\s/g, ''));
  const open = draft.questions.filter((q) => !answers[q.id]);

  return (
    <li className="space-y-3 border-b border-d-hairline py-5">
      {draft.input_text && <p className="text-d-ink-soft">“{draft.input_text}”</p>}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor={`${id}-t`} className="block font-medium">
            {dash.catalog.fieldTitle}
          </label>
          <input
            id={`${id}-t`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${field} mt-1`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-p`} className="block font-medium">
            {dash.catalog.price}
          </label>
          <input
            id={`${id}-p`}
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={`${field} tnum mt-1`}
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-d`} className="block font-medium">
          {dash.catalog.description}
        </label>
        <textarea
          id={`${id}-d`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${field} mt-1`}
        />
      </div>
      {x.variants && x.variants.length > 0 && (
        <p className="text-d-ink-soft">
          {x.variants.map((v) => formatOptions(v.options)).join(' · ')}
        </p>
      )}
      {draft.questions.map((q) => (
        <fieldset key={q.id}>
          <legend className="font-medium">{q.text}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {q.choices.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={answers[q.id] === c}
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: c }))}
                className={`min-h-11 rounded-full border px-4 ${
                  answers[q.id] === c ? 'border-d-ink bg-d-ink text-d-paper' : 'border-d-hairline'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      {draft.matches.length > 0 && (
        <fieldset>
          <legend className="font-medium">{dash.catalog.similar}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={target === null}
              onClick={() => setTarget(null)}
              className={`min-h-11 rounded-full border px-4 ${target === null ? 'border-d-ink bg-d-ink text-d-paper' : 'border-d-hairline'}`}
            >
              {dash.catalog.newProduct}
            </button>
            {draft.matches.map((m) => (
              <button
                key={m.product_id}
                type="button"
                aria-pressed={target === m.product_id}
                onClick={() => setTarget(m.product_id)}
                className={`min-h-11 rounded-full border px-4 ${target === m.product_id ? 'border-d-ink bg-d-ink text-d-paper' : 'border-d-hairline'}`}
              >
                {dash.catalog.restockInstead}: {m.title}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={busy || open.length > 0 || !title.trim() || !(amount > 0)}
          className={btn.primary}
          onClick={() =>
            run(`/inventory/drafts/${draft.id}/confirm`, {
              answers,
              edits: {
                title: title.trim(),
                description: description.trim(),
                price: { amount, currency: x.price?.value.currency ?? 'XOF' },
              },
              mode: target ? 'restock' : 'new',
              target_product_id: target,
            })
          }
        >
          {dash.catalog.publish}
        </button>
        <button
          type="button"
          disabled={busy}
          className={btn.secondary}
          onClick={() => run(`/inventory/drafts/${draft.id}/discard`)}
        >
          {dash.catalog.discard}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-d-alert">
          {error}
        </p>
      )}
    </li>
  );
}

function Drafts() {
  const id = useId();
  const drafts = useResource<Page<Draft>>('drafts', '/inventory/drafts');
  const open = (drafts.data?.data ?? []).filter((d) =>
    ['processing', 'needs_review', 'failed'].includes(d.status),
  );
  return (
    <Section labelledBy={`${id}-l`} className="scroll-mt-20">
      <div id="drafts" />
      <Label id={`${id}-l`}>{dash.catalog.drafts}</Label>
      {drafts.error ? (
        <ErrorState error={drafts.error} onRetry={drafts.refresh} />
      ) : drafts.loading ? (
        <ListSkeleton rows={2} />
      ) : open.length ? (
        <ul>
          {open.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </ul>
      ) : (
        <p className="text-d-ink-soft">{dash.catalog.draftsEmpty}</p>
      )}
    </Section>
  );
}

function VariantRow({ v, low, onSaved }: { v: VendorVariant; low: boolean; onSaved: () => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(String(v.on_hand));
  const [reason, setReason] = useState<'restock' | 'adjustment'>('restock');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = formatOptions(v.options) || '—';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/inventory/variants/${v.id}/adjustments`, {
        method: 'POST',
        body: { set_to: Number(to), reason },
      });
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-d-hairline py-2 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {label}
          {low && (
            <span className="ml-2 rounded-full bg-d-alert-soft px-2 py-0.5 text-sm font-medium text-d-alert">
              {dash.catalog.lowStock}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className="tnum">{dash.catalog.available(v.available)}</span>
          {v.reserved > 0 && (
            <span className="text-sm text-d-ink-soft">{dash.catalog.reserved(v.reserved)}</span>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={btn.quiet}
          >
            {dash.catalog.adjust}
            <span className="sr-only"> {label}</span>
          </button>
        </span>
      </div>
      {open && (
        <form onSubmit={save} className="open-rows mt-2">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`${id}-n`} className="block text-sm font-medium">
                {dash.catalog.adjustTo}
              </label>
              <input
                id={`${id}-n`}
                type="number"
                min={0}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`${field} tnum mt-1 w-28`}
              />
            </div>
            <div>
              <label htmlFor={`${id}-r`} className="block text-sm font-medium">
                {dash.catalog.reason}
              </label>
              <select
                id={`${id}-r`}
                value={reason}
                onChange={(e) => setReason(e.target.value as 'restock' | 'adjustment')}
                className={`${field} mt-1`}
              >
                <option value="restock">{dash.catalog.reasons.restock}</option>
                <option value="adjustment">{dash.catalog.reasons.adjustment}</option>
              </select>
            </div>
            <button type="submit" disabled={busy} className={btn.primary}>
              {dash.common.save}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-d-alert">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}

function ProductRow({ p, lowIds }: { p: VendorProduct; lowIds: Set<string> }) {
  const id = useId();
  const invalidate = useInvalidate();
  const [price, setPrice] = useState(String(p.price.amount));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const changed = Number(price) !== p.price.amount;

  async function savePrice(e: FormEvent) {
    e.preventDefault();
    const amount = Number(price.replace(/\s/g, ''));
    if (!(amount > 0)) return;
    setState('saving');
    setError(null);
    try {
      await api(`/inventory/${p.id}`, {
        method: 'PATCH',
        body: { price: { amount, currency: p.price.currency } },
      });
      setState('saved');
      invalidate(['inventory']);
      setTimeout(() => setState('idle'), 1800);
    } catch (err) {
      setState('idle');
      setError(describeError(err));
    }
  }

  return (
    <li className="border-b border-d-hairline py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {p.images[0] ? (
            <img
              src={p.images[0].url}
              alt=""
              className="size-14 rounded-[4px] object-cover"
              style={{ backgroundColor: p.images[0].dominant }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-14 place-items-center rounded-[4px] bg-d-paper-deep font-display text-2xl"
            >
              {p.title.charAt(0)}
            </span>
          )}
          <div>
            <p className="font-medium">
              {p.title}
              {p.status !== 'active' && (
                <span className="ml-2 text-sm text-d-ink-soft">({dash.catalog.hidden})</span>
              )}
            </p>
            <p className="d-figure text-2xl">{formatMoney(p.price)}</p>
          </div>
        </div>
        <form onSubmit={savePrice} className="flex items-end gap-2">
          <div>
            <label htmlFor={`${id}-p`} className="block text-sm font-medium">
              {dash.catalog.price}
            </label>
            <input
              id={`${id}-p`}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${field} tnum mt-1 w-32`}
            />
          </div>
          <button type="submit" disabled={!changed || state === 'saving'} className={btn.secondary}>
            {state === 'saved' ? dash.common.saved : dash.common.save}
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-d-alert">
          {error}
        </p>
      )}
      <ul
        className="mt-3 rounded-[6px] border border-d-hairline px-3"
        aria-label={`${dash.catalog.stock}, ${p.title}`}
      >
        {p.variants.map((v) => (
          <VariantRow
            key={v.id}
            v={v}
            low={lowIds.has(v.id)}
            onSaved={() => invalidate(['inventory', 'metrics'])}
          />
        ))}
      </ul>
    </li>
  );
}

function Products() {
  const id = useId();
  const products = useResource<Page<VendorProduct>>('inventory', '/inventory');
  const metrics = useResource<Metrics>('metrics?nav', '/vendors/dashboard/metrics?period=today');
  const lowIds = new Set((metrics.data?.low_stock ?? []).map((l) => l.variant_id));
  const list = products.data?.data ?? [];
  return (
    <Section labelledBy={`${id}-l`} className="scroll-mt-20">
      <div id="stock" />
      <Label id={`${id}-l`}>{dash.catalog.products}</Label>
      {products.error ? (
        <ErrorState error={products.error} onRetry={products.refresh} />
      ) : products.loading ? (
        <ListSkeleton />
      ) : list.length ? (
        <ul>
          {[...list]
            .sort(
              (a, b) =>
                Number(b.variants.some((v) => lowIds.has(v.id))) -
                Number(a.variants.some((v) => lowIds.has(v.id))),
            )
            .map((p) => (
              <ProductRow key={p.id} p={p} lowIds={lowIds} />
            ))}
        </ul>
      ) : (
        <EmptyState
          compact
          title={dash.catalog.productsEmpty}
          text={dash.catalog.productsEmptyHint}
        />
      )}
    </Section>
  );
}

export function Catalog() {
  return (
    <div className="mx-auto max-w-6xl">
      <Title>{dash.catalog.title}</Title>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-10">
        <div>
          <AddFromPhoto />
          <Drafts />
        </div>
        <Products />
      </div>
    </div>
  );
}
