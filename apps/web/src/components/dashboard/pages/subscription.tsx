'use client';

// Abonnement (architecture.md 3.7): prepaid in sats, for 1, 3 or 12 months, never renewed on its own. Paying is a
// Lightning invoice on the platform wallet: QR code, lightning: link and countdown, checked until settled.

import { useEffect, useState } from 'react';
import type { PlansResponse } from '@/lib/vendor-types';
import { newKey, useDashboard, useResource } from '../data';
import { daysUntil, fmtInt, fmtLongDate, fmtSats, fmtXof } from '../format';
import { Check, Copy, ExternalLink, Zap } from '../icons';
import type { Page, PlanId, SubscriptionInvoice, SubscriptionView } from '../types';
import { Badge, Failed, InfoRow, Loading, Modal, PageTitle, PanelHead, Progress } from '../ui';

const STATUS: Record<string, { tone: 'paid' | 'pending' | 'alert'; label: string }> = {
  trialing: { tone: 'paid', label: 'Essai gratuit' },
  active: { tone: 'paid', label: 'Active' },
  grace: { tone: 'pending', label: 'Période de grâce' },
  suspended: { tone: 'alert', label: 'Suspendue' },
};

export function Subscription() {
  const { mutate } = useDashboard();
  const view = useResource<SubscriptionView>('/vendors/me/subscription');
  const plans = useResource<PlansResponse>('/plans');
  const history = useResource<Page<SubscriptionInvoice>>('/vendors/me/subscription/invoices');
  const [planId, setPlanId] = useState<PlanId | null>(null);
  const [months, setMonths] = useState<1 | 3 | 12>(1);
  const [invoice, setInvoice] = useState<SubscriptionInvoice | null>(null);
  const [busy, setBusy] = useState(false);

  if (view.error && !view.data) return <Failed error={view.error} retry={view.reload} />;
  if (!view.data || !plans.data) return <Loading rows={5} />;
  const v = view.data;
  const s = v.subscription;
  const chosen = planId ?? s?.plan_id ?? 'pro';
  const plan = plans.data.data.find((p) => p.id === chosen);
  const period = plan?.periods.find((p) => p.months === months);
  const end = s
    ? s.status === 'grace' && s.grace_ends_at
      ? s.grace_ends_at
      : s.current_period_end
    : null;

  async function pay() {
    setBusy(true);
    try {
      const inv = await mutate<SubscriptionInvoice>('/vendors/me/subscription/invoices', {
        method: 'POST',
        body: { plan_id: chosen, months },
        idempotencyKey: newKey(),
      });
      setInvoice(inv);
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="Votre compte · Selly"
        title="Abonnement"
        description="Un abonnement prépayé en sats. Pas de débit automatique, pas de frais par vente : les paiements des clients vont tout droit dans votre portefeuille."
      />
      <div className="wallet-page-grid">
        <section className="panel plan-card">
          <div className="eyebrow">Formule actuelle</div>
          <h2>{v.plan?.name ?? 'Aucune'}</h2>
          {s && (
            <Badge tone={STATUS[s.status]?.tone ?? 'pending'}>
              {STATUS[s.status]?.label ?? s.status}
            </Badge>
          )}
          {v.plan && (
            <div className="plan-price">
              <strong>{fmtSats(v.plan.monthly_price_sat)}</strong>
              <span>/ mois</span>
            </div>
          )}
          <div className="usage-row">
            <div className="usage-top">
              <span>Réponses de l’assistant ce mois</span>
              <b>
                {fmtInt(v.usage.agent_turns.used)} / {fmtInt(v.usage.agent_turns.limit)}
              </b>
            </div>
            <Progress used={v.usage.agent_turns.used} limit={v.usage.agent_turns.limit} />
          </div>
          <div className="usage-row">
            <div className="usage-top">
              <span>Brouillons photo ce mois</span>
              <b>
                {fmtInt(v.usage.drafts.used)} / {fmtInt(v.usage.drafts.limit)}
              </b>
            </div>
            <Progress used={v.usage.drafts.used} limit={v.usage.drafts.limit} />
          </div>
          <div className="usage-row">
            <div className="usage-top">
              <span>Produits au catalogue</span>
              <b>
                {fmtInt(v.usage.products.used)} / {fmtInt(v.usage.products.limit)}
              </b>
            </div>
            <Progress used={v.usage.products.used} limit={v.usage.products.limit} />
          </div>
          {v.actions.includes('start_trial') && (
            <button
              type="button"
              className="button primary"
              style={{ marginTop: 24 }}
              onClick={() =>
                mutate(
                  '/vendors/me/subscription/trial',
                  { method: 'POST', body: { plan_id: plans.data?.trial.plan_id ?? 'pro' } },
                  'Essai démarré : votre boutique est en ligne.',
                ).catch(() => {})
              }
            >
              <Zap size={14} /> Démarrer l’essai de {plans.data.trial.days} jours
            </button>
          )}
        </section>
        <section className="panel">
          <PanelHead title="Échéance" sub="Votre formule se renouvelle quand vous le décidez" />
          <div className="info-list">
            <InfoRow
              label="État"
              value={s ? (STATUS[s.status]?.label ?? s.status) : 'Pas d’abonnement'}
            />
            {s && end && (
              <InfoRow
                label={s.status === 'grace' ? 'Fin de la grâce' : 'Fin de la période'}
                value={`${fmtLongDate(end)} · ${Math.max(0, daysUntil(end))} j`}
              />
            )}
            {s?.next_plan_id && (
              <InfoRow
                label="Ensuite"
                value={plans.data.data.find((p) => p.id === s.next_plan_id)?.name ?? s.next_plan_id}
              />
            )}
            <InfoRow label="Paiement" value="Facture Lightning prépayée" />
          </div>
          <div className="draft-note" style={{ margin: '0 22px 22px' }}>
            Le renouvellement n’est jamais automatique. Choisissez une période et réglez la facture
            depuis votre portefeuille. Les jours restants sont conservés.
          </div>
        </section>
        <section className="panel">
          <PanelHead
            title="Renouveler ou changer"
            sub="Prix fixés en sats ; l’équivalent FCFA suit le cours"
          />
          <div className="info-list">
            <div className="info-row">
              <span>Formule</span>
              <select
                className="select"
                aria-label="Formule"
                value={chosen}
                onChange={(e) => setPlanId(e.target.value as PlanId)}
              >
                {plans.data.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {fmtSats(p.monthly_price_sat)} / mois
                  </option>
                ))}
              </select>
            </div>
            {plan?.periods.map((p) => (
              <label className="info-row" key={p.months} style={{ cursor: 'pointer' }}>
                <span>
                  <input
                    type="radio"
                    name="months"
                    checked={months === p.months}
                    onChange={() => setMonths(p.months)}
                    style={{ accentColor: '#173b32' }}
                  />
                  {p.months} mois
                  {p.discount_pct > 0 && <Badge tone="paid">−{p.discount_pct} %</Badge>}
                </span>
                <b>
                  {fmtSats(p.price_sat)}
                  {p.indicative_xof !== null && (
                    <span className="table-secondary" style={{ display: 'block' }}>
                      ≈ {fmtXof(p.indicative_xof)}
                    </span>
                  )}
                </b>
              </label>
            ))}
          </div>
          <div style={{ padding: '0 22px 22px' }}>
            <button
              type="button"
              className="button primary"
              style={{ width: '100%' }}
              disabled={busy || !period}
              onClick={pay}
            >
              <Zap size={14} /> Payer {period ? fmtSats(period.price_sat) : ''}
            </button>
          </div>
        </section>
        <section className="panel">
          <PanelHead title="Ce qui est inclus" sub={plan ? `Formule ${plan.name}` : ''} />
          {plan && (
            <div className="info-list">
              <InfoRow label="Mini-boutique et commandes" value="Illimitées" />
              <InfoRow label="Produits" value={fmtInt(plan.limits.products)} />
              <InfoRow
                label="Réponses de l’assistant"
                value={`${fmtInt(plan.limits.agent_turns_per_month)} / mois`}
              />
              <InfoRow
                label="Brouillons photo"
                value={`${fmtInt(plan.limits.drafts_per_month)} / mois`}
              />
              <InfoRow
                label="Messages vocaux compris"
                value={plan.limits.voice_notes ? 'Oui' : 'Non'}
              />
              <InfoRow label="Frais Selly par vente" value="Aucun" />
            </div>
          )}
        </section>
      </div>
      {(history.data?.data.length ?? 0) > 0 && (
        <section className="panel" style={{ marginTop: 24 }}>
          <PanelHead title="Factures" sub="Vos paiements d’abonnement" />
          <div className="info-list">
            {history.data?.data.map((i) => (
              <InfoRow
                key={i.id}
                label={`${i.description} · ${fmtLongDate(i.created_at)}`}
                value={
                  <>
                    {fmtSats(i.amount_sat)}{' '}
                    <Badge
                      tone={
                        i.status === 'settled'
                          ? 'paid'
                          : i.status === 'pending'
                            ? 'pending'
                            : 'muted'
                      }
                    >
                      {i.status === 'settled'
                        ? 'Payée'
                        : i.status === 'pending'
                          ? 'À payer'
                          : i.status === 'expired'
                            ? 'Expirée'
                            : 'Annulée'}
                    </Badge>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}
      {invoice && <PayModal invoice={invoice} onClose={() => setInvoice(null)} />}
    </>
  );
}

/** The invoice to pay: checked every 3 seconds (the stream also says subscription.updated). */
function PayModal({ invoice, onClose }: { invoice: SubscriptionInvoice; onClose: () => void }) {
  const { request, refresh, flash } = useDashboard();
  const [inv, setInv] = useState(invoice);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const left = Math.max(0, Math.floor((Date.parse(inv.expires_at) - now) / 1000));

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (inv.status !== 'pending') return;
    const t = window.setInterval(async () => {
      try {
        const next = await request<SubscriptionInvoice>(
          `/vendors/me/subscription/invoices/${inv.id}`,
        );
        setInv((cur) => ({ ...next, qr_svg: next.qr_svg ?? cur.qr_svg }));
        if (next.status === 'settled') {
          flash('Paiement reçu : votre abonnement est prolongé.');
          refresh();
        }
      } catch {}
    }, 3000);
    return () => window.clearInterval(t);
  }, [inv.id, inv.status, request, flash, refresh]);

  return (
    <Modal title={inv.status === 'settled' ? 'Merci !' : 'Payer en Lightning'} onClose={onClose}>
      {inv.status === 'settled' ? (
        <>
          <p className="modal-copy">
            <Check size={14} /> {inv.description} réglé. Période couverte jusqu’au{' '}
            {fmtLongDate(inv.covers.to)}.
          </p>
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={onClose}>
              Fermer
            </button>
          </div>
        </>
      ) : left === 0 || inv.status !== 'pending' ? (
        <>
          <p className="modal-copy">Cette facture a expiré. Fermez et créez-en une nouvelle.</p>
          <div className="modal-actions">
            <button type="button" className="button" onClick={onClose}>
              Fermer
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-copy">
            {inv.description} : <b>{fmtSats(inv.amount_sat)}</b>
            {inv.credit_sat > 0 ? ` (dont ${fmtSats(inv.credit_sat)} de crédit déduit)` : ''}.
            Scannez avec votre portefeuille, ou ouvrez-le depuis ce téléphone.
          </p>
          <div className="invoice-box">
            {inv.qr_svg ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(inv.qr_svg)}`}
                alt="QR code de la facture Lightning"
              />
            ) : (
              <div className="chart-empty" style={{ width: 200, height: 200 }}>
                QR indisponible
              </div>
            )}
            <div>
              <div className="wallet-label" style={{ color: 'var(--ink-55)' }}>
                Expire dans
              </div>
              <div className="plan-price" style={{ marginTop: 6 }}>
                <strong>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                </strong>
              </div>
              <div className="invoice-code" style={{ marginTop: 10 }}>
                {inv.bolt11}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <a className="button small primary" href={inv.lightning_uri}>
                  <ExternalLink size={12} /> Ouvrir le portefeuille
                </a>
                <button
                  type="button"
                  className="button small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inv.bolt11);
                      setCopied(true);
                    } catch {}
                  }}
                >
                  <Copy size={12} /> {copied ? 'Copiée' : 'Copier'}
                </button>
              </div>
            </div>
          </div>
          <p className="form-hint" role="status" style={{ marginTop: 16 }}>
            En attente du paiement… Pas de sats ?{' '}
            <a className="text-link" href="/aide/payer-en-bitcoin" target="_blank" rel="noreferrer">
              Acheter avec Orange Money ou Wave
            </a>
          </p>
        </>
      )}
    </Modal>
  );
}
