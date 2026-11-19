'use client';

// The live part of the checkout (architecture.md 3.4, 6.2): QR and wallet link, the time left, and the order's
// status from core's SSE stream (/checkout/{token}/events), with a slow poll of /status when the stream drops.
// Server-rendered from the first view, so the QR, the amount and the wallet link work before any JavaScript.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CountdownRing } from '@/components/motion/countdown-ring';
import { PaymentSuccess } from '@/components/motion/payment-success';
import { Check, Copy, ExternalLink, RefreshCcw } from '@/components/storefront/draft-icons';

import type { CheckoutView, InvoiceStatus, OrderStatus } from '@/lib/types';
import { useLang, useMoney, useT } from '../lang';

type Live = {
  status: OrderStatus;
  invoice: InvoiceStatus | null;
  paidAt: string | null;
  fulfilledAt: string | null;
};

const POLL_MS = 5000;

export function CheckoutLive({ view }: { view: CheckoutView }) {
  const { money, sats } = useMoney();
  const t = useT();
  const { order, store } = view;
  const [invoice, setInvoice] = useState(view.invoice);
  const [live, setLive] = useState<Live>({
    status: order.status,
    invoice: view.invoice?.status ?? null,
    paidAt: order.paid_at,
    fulfilledAt: order.fulfilled_at,
  });
  const [expired, setExpired] = useState(
    order.status === 'expired' || view.invoice?.status === 'expired',
  );
  const [copied, setCopied] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const token = order.public_token;
  const done = live.status === 'cancelled' || live.status === 'fulfilled';
  const paid = live.status === 'paid' || live.status === 'fulfilled';
  // Already paid when the page opened (the order page, days later): no QR to turn into a check.
  const [paidOnArrival] = useState(order.status === 'paid' || order.status === 'fulfilled');

  const apply = useCallback(
    (d: {
      status: OrderStatus;
      invoice?: { status: InvoiceStatus | null } | null;
      invoice_status?: InvoiceStatus | null;
      paid_at?: string | null;
      fulfilled_at?: string | null;
    }) => {
      const inv = d.invoice?.status ?? d.invoice_status ?? null;
      setLive({
        status: d.status,
        invoice: inv,
        paidAt: d.paid_at ?? null,
        fulfilledAt: d.fulfilled_at ?? null,
      });
      if (d.status === 'expired' || inv === 'expired') setExpired(true);
    },
    [],
  );

  // SSE first; if the stream errors, poll until it is done.
  useEffect(() => {
    if (done) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const startPoll = () => {
      if (poll) return;
      poll = setInterval(async () => {
        const res = await fetch(`/api/v1/checkout/${encodeURIComponent(token)}/status`, {
          cache: 'no-store',
        }).catch(() => null);
        if (res?.ok) apply(await res.json());
      }, POLL_MS);
    };
    let es: EventSource | null = null;
    if ('EventSource' in window) {
      es = new EventSource(`/api/v1/checkout/${encodeURIComponent(token)}/events`);
      es.addEventListener('status', (e) => apply(JSON.parse((e as MessageEvent).data)));
      es.onerror = () => {
        es?.close();
        startPoll();
      };
    } else startPoll();
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [token, done, apply]);

  const copy = async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice.bolt11);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem(
        t(
          'Copie impossible : sélectionnez la facture ci-dessous et copiez-la.',
          'Could not copy: select the invoice below and copy it.',
        ),
      );
    }
  };

  const renew = async () => {
    setRenewing(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/v1/checkout/${encodeURIComponent(token)}/invoice`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { code?: string } | null;
        setProblem(
          p?.code === 'PAYMENT_UNAVAILABLE'
            ? t(
                'Paiement momentanément indisponible. Réessayez dans un instant.',
                'Payment unavailable for a moment. Try again shortly.',
              )
            : p?.code === 'OUT_OF_STOCK' || p?.code === 'INSUFFICIENT_STOCK'
              ? t(
                  'Un article n’est plus disponible. Demandez au vendeur.',
                  'An item is no longer available. Ask the seller.',
                )
              : t(
                  'Impossible de créer un nouveau lien. Réessayez.',
                  'Could not make a new link. Try again.',
                ),
        );
        return;
      }
      // The new invoice comes with a fresh rate: reload the view.
      const v = (await (
        await fetch(`/api/v1/checkout/${encodeURIComponent(token)}`, { cache: 'no-store' })
      ).json()) as CheckoutView;
      setInvoice(v.invoice);
      setExpired(false);
      apply({ status: v.order.status, invoice: v.invoice, paid_at: v.order.paid_at });
    } finally {
      setRenewing(false);
    }
  };

  if (live.status === 'cancelled')
    return (
      <Panel>
        <p className="sf-serif text-3xl">
          {t('Cette commande a été annulée.', 'This order was cancelled.')}
        </p>
        <p className="mt-3 text-d-ink-soft">
          {t(
            'Rien n’a été payé. Vous pouvez repasser commande depuis la boutique.',
            'Nothing was paid. You can order again from the shop.',
          )}
        </p>
        <a href={`/s/${store.slug}`} className="sf-btn sf-btn-primary mt-6">
          {t('Retour à la boutique', 'Back to the shop')}
        </a>
      </Panel>
    );

  return (
    <>
      <h1 className="sf-serif mt-3 mb-8 text-[2.75rem] leading-[1.02] sm:text-6xl">
        {paid ? (
          <>
            {t('Merci,', 'Thank you,')}{' '}
            <em className="text-[var(--sf-accent-text)]">{t('c’est réglé.', 'it’s paid.')}</em>
          </>
        ) : (
          <>
            {t('Plus qu’un geste,', 'One more tap,')}{' '}
            <em className="text-[var(--sf-accent-text)]">
              {t('et c’est à vous.', 'and it’s yours.')}
            </em>
          </>
        )}
      </h1>
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="sf-eyebrow">{paid ? t('Payé', 'Paid') : t('À payer', 'To pay')}</p>
            <p className="sf-figure mt-1 text-5xl leading-none">{money(order.total)}</p>
            <p className="tnum mt-2 text-d-ink-soft">
              {t('soit', 'that is')} {sats(order.total_sat)} {t('en bitcoin', 'in bitcoin')}
            </p>
          </div>
          {!paid && invoice && !expired && (
            <CountdownRing
              expiresAt={invoice.expires_at}
              size={76}
              onExpire={() => setExpired(true)}
            />
          )}
        </div>

        <div className="mt-8 flex flex-col items-center">
          {expired && !paid ? (
            <div className="w-full border border-d-hairline p-6 text-center">
              <p className="sf-serif text-2xl">
                {t('Le lien de paiement a expiré.', 'The payment link has expired.')}
              </p>
              <p className="mt-2 text-d-ink-soft">
                {t(
                  'Le taux du bitcoin bouge : un nouveau lien recalcule le montant en sats.',
                  'The bitcoin rate moves: a new link works out the amount in sats again.',
                )}
              </p>
              <button
                type="button"
                onClick={renew}
                disabled={renewing}
                className="sf-btn sf-btn-primary mt-5 disabled:opacity-50"
              >
                <RefreshCcw size={16} />{' '}
                {renewing
                  ? t('Un instant…', 'One moment…')
                  : t('Nouveau lien de paiement', 'New payment link')}
              </button>
            </div>
          ) : (
            <>
              {/* One stage for both states, so the QR itself turns into the check when the payment lands. */}
              <PaymentSuccess
                paid={paid}
                message={
                  live.status === 'fulfilled'
                    ? t(
                        `Commande ${order.number} remise. Merci !`,
                        `Order ${order.number} handed over. Thank you!`,
                      )
                    : t(
                        `Paiement reçu. Commande ${order.number} confirmée.`,
                        `Payment received. Order ${order.number} confirmed.`,
                      )
                }
              >
                {invoice && !paidOnArrival ? (
                  <div
                    role="img"
                    aria-label={t(
                      'QR code de la facture Lightning',
                      'QR code of the Lightning invoice',
                    )}
                    className="checkout-qr aspect-square w-full max-w-64 border border-d-hairline bg-white p-3 sm:max-w-72"
                    // Inline SVG made by core from the invoice (qrcode library), never user input.
                    dangerouslySetInnerHTML={{ __html: invoice.qr_svg ?? '' }}
                  />
                ) : (
                  <span className="block size-40" />
                )}
              </PaymentSuccess>
              {!paid && invoice && (
                <>
                  <p className="mt-1 max-w-80 text-center text-d-ink-soft">
                    {t(
                      'Scannez avec votre portefeuille bitcoin, ou ouvrez-le directement sur ce téléphone.',
                      'Scan with your bitcoin wallet, or open it right on this phone.',
                    )}
                  </p>
                  <div className="mt-6 grid w-full gap-3">
                    <a href={invoice.lightning_uri} className="sf-btn sf-btn-primary">
                      {t('Ouvrir mon portefeuille', 'Open my wallet')} <ExternalLink size={16} />
                    </a>
                    <button type="button" onClick={copy} className="sf-btn sf-btn-ghost">
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied
                        ? t('Facture copiée', 'Invoice copied')
                        : t('Copier la facture', 'Copy the invoice')}
                    </button>
                  </div>
                  <details className="mt-4 w-full text-d-ink-soft">
                    <summary className="min-h-11 cursor-pointer py-2">
                      {t('Voir la facture', 'See the invoice')}
                    </summary>
                    <p className="font-mono text-sm break-all select-all">{invoice.bolt11}</p>
                  </details>
                  <a href={`/c/${token}`} className="mt-2 min-h-11 py-2 text-d-ink-soft underline">
                    {t('J’ai payé, actualiser', 'I’ve paid, refresh')}
                  </a>
                </>
              )}
            </>
          )}
        </div>

        {problem && (
          <p role="alert" className="mt-4 border border-d-alert/40 bg-d-alert/5 p-3 text-d-alert">
            {problem}
          </p>
        )}

        <Steps live={live} />
      </Panel>
    </>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <section
      aria-label={t('Paiement', 'Payment')}
      className="sf-rise border border-d-hairline bg-d-paper p-6 sm:p-8"
    >
      {children}
    </section>
  );
}

/** Commande reçue → Payée → Remise: the order page that replaces WhatsApp status messages (architecture.md 3.4). */
function Steps({ live }: { live: Live }) {
  const t = useT();
  const lang = useLang();
  const at = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-SN', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(iso))
      : null;
  const steps = [
    { label: t('Commande reçue', 'Order received'), done: true, when: null },
    {
      label: t('Paiement reçu', 'Payment received'),
      done: live.status === 'paid' || live.status === 'fulfilled',
      when: at(live.paidAt),
    },
    {
      label: t('Remise ou livrée', 'Handed over or delivered'),
      done: live.status === 'fulfilled',
      when: at(live.fulfilledAt),
    },
  ];
  return (
    <ol className="mt-8 grid grid-cols-3 border-t border-d-hairline pt-5">
      {steps.map((s, i) => (
        <li key={s.label} className="relative pr-2">
          <span
            aria-hidden="true"
            className={`grid size-7 place-items-center border text-sm font-semibold transition-colors duration-[var(--dur-ui)] ${s.done ? 'border-[var(--sf-ink)] bg-[var(--sf-ink)] text-d-paper' : 'border-d-hairline text-d-ink-soft'}`}
          >
            {s.done ? <Check size={14} /> : i + 1}
          </span>
          <span
            className={`mt-2 block leading-tight ${s.done ? 'font-semibold' : 'text-d-ink-soft'}`}
          >
            {s.label}
            <span className="sr-only">
              {s.done ? t(' : fait', ': done') : t(' : à venir', ': to come')}
            </span>
          </span>
          {s.when && <span className="tnum block text-[0.9375rem] text-d-ink-soft">{s.when}</span>}
        </li>
      ))}
    </ol>
  );
}
