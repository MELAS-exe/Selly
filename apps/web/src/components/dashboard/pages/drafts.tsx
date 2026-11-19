'use client';

// Photo drafts (architecture.md 6.5 and 8.6): the vendor sends Selly a photo and a sentence, the vision model fills
// a draft, and nothing is published before the vendor checks it. Each field shows how sure the model is.

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/browser-api';
import { errorText, newKey, uploadImages, useDashboard, useResource } from '../data';
import { fmtAgo, fmtXof, formatOptions } from '../format';
import { Camera, Check, CircleCheck, ImagePlus, TriangleAlert } from '../icons';
import type { Draft, Page } from '../types';
import { Badge, Empty, Failed, Loading, PageTitle } from '../ui';

const FROM: Record<string, string> = {
  text: 'votre message',
  image: 'la photo',
  price_tag: 'l’étiquette',
  inferred: 'une déduction',
};

/**
 * Drafts still to check, at the top of the catalogue. Drafts made with Selly are confirmed in the conversation;
 * these are the others (or ones left there), and failed photos of the last day. Nothing shows when all is checked.
 */
export function PendingDrafts() {
  const review = useResource<Page<Draft>>('/inventory/drafts?status=needs_review');
  const processing = useResource<Page<Draft>>('/inventory/drafts?status=processing', 4000);
  const failed = useResource<Page<Draft>>('/inventory/drafts?status=failed');
  const recentFailures = (failed.data?.data ?? []).filter(
    (d) => Date.now() - Date.parse(d.created_at) < 86_400_000,
  );
  const toCheck = review.data?.data ?? [];
  const reading = processing.data?.data.length ?? 0;
  if (toCheck.length === 0 && reading === 0 && recentFailures.length === 0) return null;

  return (
    <section id="brouillons" className="pending-drafts" aria-labelledby="brouillons-title">
      <h2 id="brouillons-title" className="panel-title">
        Brouillons photo à vérifier
      </h2>
      <p className="form-hint">
        Rien n’est publié avant votre confirmation. Pour en créer un, envoyez une photo à Selly.
      </p>
      {reading > 0 && (
        <div className="draft-note" role="status">
          <b>Lecture en cours…</b> {reading} photo{reading > 1 ? 's' : ''} en cours d’analyse.
        </div>
      )}
      {recentFailures.length > 0 && (
        <div className="banner alert" role="status">
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <TriangleAlert size={16} />
            {recentFailures.length} photo{recentFailures.length > 1 ? 's' : ''} n’
            {recentFailures.length > 1 ? 'ont' : 'a'} pas pu être lue
            {recentFailures.length > 1 ? 's' : ''}. Reprenez la photo avec plus de lumière.
          </span>
        </div>
      )}
      {toCheck.length > 0 && (
        <div className="draft-grid">
          {toCheck.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </section>
  );
}

function confidenceTone(c: number | undefined) {
  if (c === undefined) return 'muted' as const;
  return c >= 0.8 ? ('paid' as const) : c >= 0.6 ? ('pending' as const) : ('alert' as const);
}

function DraftCard({ draft: d }: { draft: Draft }) {
  const { mutate } = useDashboard();
  const x = d.extracted ?? {};
  const [title, setTitle] = useState(x.title?.value ?? '');
  const [price, setPrice] = useState(x.price?.value.amount ? String(x.price.value.amount) : '');
  const [category, setCategory] = useState(x.category?.value ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const variants = x.variants ?? [];
  const open = d.questions.filter((q) => !answers[q.id]);

  async function confirm() {
    setBusy(true);
    const edits: Record<string, unknown> = {};
    if (title !== (x.title?.value ?? '')) edits.title = title;
    if (category !== (x.category?.value ?? '')) edits.category = category || null;
    if (price && Number(price) !== x.price?.value.amount)
      edits.price = { amount: Number(price), currency: 'XOF' };
    try {
      await mutate(
        `/inventory/drafts/${d.id}/confirm`,
        {
          method: 'POST',
          body: {
            answers,
            edits,
            mode: target ? 'restock' : 'new',
            target_product_id: target || null,
          },
        },
        target ? 'Stock ajouté au produit existant.' : `${title} ajouté au catalogue.`,
      );
    } catch {
      setBusy(false);
    }
  }

  return (
    <article className="product-card">
      <div className="product-art draft-art">
        <ImagePlus size={28} strokeWidth={1.3} />
        <span className="art-label">{d.source === 'assistant' ? 'Via l’assistant' : 'Photo'}</span>
        <Badge tone="pending">À vérifier</Badge>
      </div>
      <div className="product-info">
        <div className="table-secondary" style={{ marginTop: 0 }}>
          {fmtAgo(d.created_at)}
          {d.input_text ? ` · « ${d.input_text} »` : ''}
        </div>
        <Field label="Nom" from={x.title?.from} confidence={x.title?.confidence}>
          <input
            className="form-control"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <>
          <Field label="Prix (FCFA)" from={x.price?.from} confidence={x.price?.confidence}>
            <input
              className="form-control"
              type="number"
              inputMode="numeric"
              min="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Catégorie" from={x.category?.from} confidence={x.category?.confidence}>
            <input
              className="form-control"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
        </>
        {variants.length > 0 && (
          <p style={{ marginTop: 12 }}>
            Variantes : {variants.map((v) => formatOptions(v.options) || 'unique').join(' · ')}
          </p>
        )}
        {d.questions.map((q) => (
          <div key={q.id} style={{ marginTop: 14 }}>
            <div className="form-label" style={{ margin: '0 0 8px' }}>
              {q.text}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {q.choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`button small ${answers[q.id] === c ? 'primary' : ''}`}
                  aria-pressed={answers[q.id] === c}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: c }))}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        ))}
        {d.matches.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <label className="form-label" style={{ margin: '0 0 2px' }} htmlFor={`target-${d.id}`}>
              Déjà au catalogue ?
            </label>
            <select
              id={`target-${d.id}`}
              className="form-control"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Non, c’est un nouveau produit</option>
              {d.matches.map((m) => (
                <option key={m.product_id} value={m.product_id}>
                  Ajouter le stock à « {m.title} » ({Math.round(m.similarity * 100)} % ressemblant)
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="product-meta">
          <span>{price ? fmtXof(Number(price)) : 'Prix à indiquer'}</span>
        </div>
        <div className="draft-actions">
          <button
            type="button"
            className="button primary small"
            disabled={busy || open.length > 0 || title.trim().length < 2 || (!target && !price)}
            title={open.length ? 'Répondez d’abord aux questions' : undefined}
            onClick={confirm}
          >
            <Check size={13} /> {target ? 'Ajouter le stock' : 'Publier'}
          </button>
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() =>
              mutate(
                `/inventory/drafts/${d.id}/discard`,
                { method: 'POST', body: {} },
                'Brouillon supprimé.',
              ).catch(() => {})
            }
          >
            Supprimer
          </button>
        </div>
      </div>
    </article>
  );
}

function Field({
  label,
  from,
  confidence,
  children,
}: {
  label: string;
  from?: string;
  confidence?: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="form-label field-head" style={{ margin: 0 }}>
        <span>{label}</span>
        {confidence !== undefined && (
          <Badge tone={confidenceTone(confidence)}>
            {Math.round(confidence * 100)} %{from ? ` · ${FROM[from] ?? from}` : ''}
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}
