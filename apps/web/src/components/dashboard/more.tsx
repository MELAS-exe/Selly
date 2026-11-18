'use client';

// "More": the hub and its pages (assistant, wallet, subscription, shop settings, security).
// The wallet and subscription pages keep their own paths (/app/portefeuille, /app/abonnement): core's alerts open them.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/browser-api';
import { useInvalidate, useResource } from '@/lib/dashboard/resource';
import { relativeTime } from '@/lib/dashboard/time';
import type {
  ChatMessage,
  DeliveryZone,
  Page,
  SubscriptionFull,
  VendorMe,
} from '@/lib/dashboard/types';
import { usageGauge } from '@/lib/dashboard/usage';
import { formatMoney, formatSats } from '@/lib/format';
import { dash } from '@/lib/i18n/dashboard';
import { describeError, toE164 } from '@/lib/onboarding';
import type { PlanId, Wallet } from '@/lib/vendor-types';
import { ChatBubbleIn } from '../motion/chat-bubble-in';
import { CountdownRing } from '../motion/countdown-ring';
import { PaymentSuccess } from '../motion/payment-success';
import { TypingDots } from '../motion/typing-dots';
import { PushToggle } from './push';
import { useVendor } from './shell';
import {
  btn,
  EmptyState,
  ErrorState,
  field,
  Label,
  ListSkeleton,
  Section,
  Skeleton,
  Title,
} from './ui';

const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (s: string) => date.format(new Date(s));

function Back() {
  return (
    <Link href="/app/plus" className={`${btn.quiet} mb-2 lg:hidden`}>
      ← {dash.more.title}
    </Link>
  );
}

function Page_({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Back />
      <Title>{title}</Title>
      {children}
    </div>
  );
}

function Feedback({ error, ok }: { error: string | null; ok?: string | null }) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-2 text-d-alert">
          {error}
        </p>
      )}
      <p role="status" className="mt-2 text-d-paid">
        {ok ?? ''}
      </p>
    </>
  );
}

// ------------------------------------------------------------------------------------------- hub

export function MoreHub() {
  const router = useRouter();
  const links: { href: string; title: string; hint: string }[] = [
    { href: '/app/plus/assistant', title: dash.more.assistant, hint: dash.more.assistantHint },
    { href: '/app/portefeuille', title: dash.more.wallet, hint: dash.more.walletHint },
    { href: '/app/abonnement', title: dash.more.subscription, hint: dash.more.subscriptionHint },
    { href: '/app/plus/boutique', title: dash.more.shop, hint: dash.more.shopHint },
    { href: '/app/plus/securite', title: dash.more.security, hint: dash.more.securityHint },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <Title>{dash.more.title}</Title>
      <ul className="border-t border-d-hairline">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="group flex min-h-16 items-center justify-between gap-4 border-b border-d-hairline py-3"
            >
              <span>
                <span className="font-display text-2xl">{l.title}</span>
                <span className="block text-d-ink-soft">{l.hint}</span>
              </span>
              <span
                aria-hidden="true"
                className="text-d-ink-soft transition-transform group-hover:translate-x-1"
              >
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Section>
        <PushToggle />
      </Section>
      <Section>
        <button
          type="button"
          className={btn.secondary}
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => {});
            router.replace('/app/login');
          }}
        >
          {dash.more.signOut}
        </button>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- assistant

export function AssistantChat() {
  const history = useResource<Page<ChatMessage>>('assistant', '/assistant/messages');
  const [extra, setExtra] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidate();
  const end = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const loaded = history.data?.data ?? [];
  const ids = new Set(loaded.map((m) => m.id));
  const messages = [...loaded, ...extra.filter((m) => !ids.has(m.id))];

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  async function send(body: { text?: string; quick_reply_id?: string }) {
    setBusy(true);
    setError(null);
    try {
      const turn = await api<{ message: ChatMessage; reply: ChatMessage }>('/assistant/messages', {
        method: 'POST',
        body: { client_message_id: crypto.randomUUID(), ...body },
      });
      setExtra((x) => [...x, turn.message, turn.reply]);
      setText('');
      // A command may have changed prices, stock or orders.
      invalidate(['inventory', 'metrics', 'orders']);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const last = messages[messages.length - 1];

  return (
    <Page_ title={dash.assistant.title}>
      <p className="text-d-ink-soft">{dash.assistant.intro}</p>
      <div aria-live="polite" className="space-y-3 py-5">
        {history.error ? (
          <ErrorState error={history.error} onRetry={history.refresh} />
        ) : history.loading ? (
          <ListSkeleton rows={2} />
        ) : (
          messages.map((m) => (
            <ChatBubbleIn
              key={m.id}
              from={m.author === 'vendor' ? 'customer' : 'agent'}
              still={ids.has(m.id)}
              className={`whitespace-pre-wrap rounded-[14px] ${
                m.author === 'vendor'
                  ? 'rounded-br-sm bg-d-ink text-d-paper'
                  : 'rounded-bl-sm border border-d-hairline bg-d-paper'
              }`}
            >
              {m.text}
            </ChatBubbleIn>
          ))
        )}
        {busy && <TypingDots label={dash.assistant.thinking} />}
        {!busy &&
          last?.author !== 'vendor' &&
          last?.quick_replies &&
          last.quick_replies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {last.quick_replies.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className={btn.secondary}
                  onClick={() => send({ quick_reply_id: q.id })}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
        <div ref={end} />
      </div>
      {messages.length === 0 && !history.loading && (
        <div className="mb-4 flex flex-wrap gap-2">
          {dash.assistant.examples.map((e) => (
            <button key={e} type="button" className={btn.secondary} onClick={() => setText(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send({ text: text.trim() });
        }}
        className="sticky bottom-16 flex gap-2 border-t border-d-hairline bg-d-paper pt-3 lg:bottom-0"
      >
        <label htmlFor={inputId} className="sr-only">
          {dash.assistant.placeholder}
        </label>
        <input
          id={inputId}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder={dash.assistant.placeholder}
          className={field}
        />
        <button type="submit" disabled={busy || !text.trim()} className={btn.primary}>
          {dash.assistant.send}
        </button>
      </form>
      <Feedback error={error} />
    </Page_>
  );
}

// ------------------------------------------------------------------------------------------- wallet

function ConfirmDialog({
  open,
  title,
  text,
  confirm,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  text: string;
  confirm: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={id}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-[8px] border border-d-hairline bg-d-paper p-6 text-d-ink backdrop:bg-d-ink/40"
    >
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      <p className="mt-2 text-d-ink-soft">{text}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={btn.secondary}>
          {dash.common.cancel}
        </button>
        <button type="button" onClick={onConfirm} className={btn.danger}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}

export function WalletPage() {
  const { refresh: refreshVendor } = useVendor();
  const wallet = useResource<Wallet>('wallet', '/vendors/me/wallet');
  const invalidate = useInvalidate();
  const [uri, setUri] = useState('');
  const [lud16, setLud16] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const id = useId();
  const none = wallet.error instanceof ApiError && wallet.error.problem.status === 404;

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      invalidate(['wallet', 'vendor']);
      await refreshVendor();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function pair() {
    await run(async () => {
      const p = await api<{ open_uri: string }>('/vendors/me/wallet/pairing', {
        method: 'POST',
        body: {},
      });
      setPairing(true);
      window.location.href = p.open_uri;
    });
  }

  function link(e: FormEvent) {
    e.preventDefault();
    const body = uri.trim()
      ? { kind: 'nwc', uri: uri.trim() }
      : { kind: 'lightning_address', lud16: lud16.trim() };
    run(() => api('/vendors/me/wallet', { method: 'PUT', body })).then(() => {
      setUri('');
      setLud16('');
    });
  }

  const w = wallet.data;
  return (
    <Page_ title={dash.wallet.title}>
      {wallet.loading ? (
        <Skeleton className="h-32 w-full" />
      ) : wallet.error && !none ? (
        <ErrorState error={wallet.error} onRetry={wallet.refresh} />
      ) : w ? (
        <Section>
          <p className="flex flex-wrap items-center gap-3">
            <span className="font-display text-2xl">{dash.wallet.kind[w.kind]}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${
                w.status === 'active'
                  ? 'bg-d-paid-soft text-d-paid'
                  : 'bg-d-alert-soft text-d-alert'
              }`}
            >
              {dash.wallet.status[w.status]}
            </span>
          </p>
          {w.lud16 && <p className="mt-1">{w.lud16}</p>}
          <ul className="mt-3 space-y-1 text-d-ink-soft">
            {w.receive_only && <li>{dash.wallet.receiveOnly}</li>}
            {w.notifications && <li>{dash.wallet.notifications}</li>}
            <li>{dash.wallet.checked(relativeTime(w.checked_at))}</li>
            {w.balance_sat !== null && (
              <li>
                {dash.wallet.balance}: {formatSats(w.balance_sat)}
              </li>
            )}
          </ul>
          {w.last_error && <p className="mt-2 text-d-alert">{w.last_error}</p>}
        </Section>
      ) : (
        <EmptyState compact title={dash.wallet.none} text={dash.wallet.noneHint} />
      )}

      <Section>
        <button type="button" disabled={busy} onClick={pair} className={btn.primary}>
          {dash.wallet.pair}
        </button>
        <p className="mt-2 text-d-ink-soft">
          {pairing ? dash.wallet.pairWaiting : dash.wallet.pairHint}
        </p>
      </Section>

      <Section labelledBy={`${id}-l`}>
        <Label id={`${id}-l`}>{dash.wallet.orPaste}</Label>
        <form onSubmit={link} className="space-y-3">
          <div>
            <label htmlFor={`${id}-u`} className="block font-medium">
              {dash.wallet.uri}
            </label>
            <input
              id={`${id}-u`}
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              className={`${field} mt-1`}
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor={`${id}-a`} className="block font-medium">
              {dash.wallet.lnAddress}
            </label>
            <input
              id={`${id}-a`}
              value={lud16}
              onChange={(e) => setLud16(e.target.value)}
              placeholder="awa@getalby.com"
              className={`${field} mt-1`}
            />
          </div>
          <button
            type="submit"
            disabled={busy || (!uri.trim() && !lud16.trim())}
            className={btn.secondary}
          >
            {dash.wallet.link}
          </button>
        </form>
      </Section>

      {w && (
        <Section>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm(true)}
            className={btn.danger}
          >
            {dash.wallet.unlink}
          </button>
          <ConfirmDialog
            open={confirm}
            title={dash.wallet.unlinkTitle}
            text={dash.wallet.unlinkText}
            confirm={dash.wallet.unlinkConfirm}
            onClose={() => setConfirm(false)}
            onConfirm={() => {
              setConfirm(false);
              run(() => api('/vendors/me/wallet', { method: 'DELETE' }));
            }}
          />
        </Section>
      )}
      <Feedback error={error} />
    </Page_>
  );
}

// ------------------------------------------------------------------------------------------- subscription

interface SubscriptionInvoice {
  id: string;
  status: 'pending' | 'settled' | 'expired' | 'cancelled';
  plan_id: PlanId;
  months: number;
  amount_sat: number;
  bolt11: string;
  lightning_uri: string;
  expires_at: string;
  created_at: string;
  covers: { from: string; to: string };
  settled_at: string | null;
}

function Gauge({ label, used, limit }: { label: string; used: number; limit: number }) {
  const g = usageGauge({ used, limit });
  const color =
    g.level === 'full' ? 'bg-d-alert' : g.level === 'warn' ? 'bg-d-pending' : 'bg-d-lime-deep';
  return (
    <div className="py-2">
      <div className="flex justify-between gap-3">
        <span>{label}</span>
        <span className="tnum text-d-ink-soft">
          {used} / {limit} · {dash.subscription.left(g.left)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-d-paper-deep"
      >
        <div
          className={`d-bar h-full ${color}`}
          style={{ transform: `scaleX(${g.percent / 100})` }}
        />
      </div>
    </div>
  );
}

function RenewBox({ planId, onPaid }: { planId: PlanId; onPaid: () => void }) {
  const [months, setMonths] = useState(1);
  const [invoice, setInvoice] = useState<SubscriptionInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = useRef<string>('');

  // Poll the invoice while it is open (the live stream also announces subscription.updated).
  useEffect(() => {
    if (!invoice || invoice.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const next = await api<SubscriptionInvoice>(
          `/vendors/me/subscription/invoices/${invoice.id}`,
        );
        setInvoice(next);
        if (next.status === 'settled') onPaid();
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [invoice, onPaid]);

  async function create() {
    setBusy(true);
    setError(null);
    key.current ||= crypto.randomUUID();
    try {
      setInvoice(
        await api<SubscriptionInvoice>('/vendors/me/subscription/invoices', {
          method: 'POST',
          body: { plan_id: planId, months },
          idempotencyKey: key.current,
        }),
      );
      key.current = '';
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (invoice)
    return (
      <div className="space-y-4">
        <p className="font-display text-2xl">{dash.subscription.payTitle}</p>
        <p className="d-figure text-4xl">{formatSats(invoice.amount_sat)}</p>
        <PaymentSuccess paid={invoice.status === 'settled'} message={dash.subscription.paid}>
          <div className="flex items-center gap-5">
            <CountdownRing expiresAt={invoice.expires_at} durationMs={60 * 60_000} />
            <div className="flex flex-col gap-2">
              <a href={invoice.lightning_uri} className={btn.primary}>
                {dash.subscription.openWallet}
              </a>
              <button
                type="button"
                className={btn.secondary}
                onClick={() =>
                  navigator.clipboard.writeText(invoice.bolt11).then(
                    () => setCopied(true),
                    () => {},
                  )
                }
              >
                {copied ? dash.common.copied : dash.subscription.copyInvoice}
              </button>
            </div>
          </div>
        </PaymentSuccess>
        <a href="/aide/payer-en-bitcoin" className={btn.quiet}>
          {dash.subscription.noSats}
        </a>
      </div>
    );

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={dash.subscription.renew} className="flex flex-wrap gap-2">
        {[1, 3, 12].map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={months === m}
            onClick={() => setMonths(m)}
            className={`min-h-11 rounded-full border px-4 ${months === m ? 'border-d-ink bg-d-ink text-d-paper' : 'border-d-hairline'}`}
          >
            {dash.subscription.months(m)}
          </button>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={create} className={btn.primary}>
        {dash.subscription.create}
      </button>
      <Feedback error={error} />
    </div>
  );
}

export function SubscriptionPage() {
  const sub = useResource<SubscriptionFull>('subscription', '/vendors/me/subscription');
  const receipts = useResource<Page<SubscriptionInvoice>>(
    'subscription?invoices',
    '/vendors/me/subscription/invoices',
  );
  const invalidate = useInvalidate();
  const s = sub.data?.subscription;
  const u = sub.data?.usage;
  const id = useId();
  return (
    <Page_ title={dash.subscription.title}>
      {sub.error ? (
        <ErrorState error={sub.error} onRetry={sub.refresh} />
      ) : !sub.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Section>
            {s && sub.data.plan ? (
              <>
                <p className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-3xl">{sub.data.plan.name}</span>
                  <span className="rounded-full bg-d-paper-deep px-2.5 py-0.5 text-sm font-medium">
                    {dash.subscription.status[s.status]}
                  </span>
                </p>
                <p className="text-d-ink-soft">
                  {dash.subscription.until(fmtDate(s.current_period_end))}
                </p>
              </>
            ) : (
              <EmptyState compact title={dash.subscription.none} />
            )}
          </Section>
          {u && (
            <Section labelledBy={`${id}-u`}>
              <Label id={`${id}-u`}>{dash.subscription.usage}</Label>
              <Gauge
                label={dash.subscription.products}
                used={u.products.used}
                limit={u.products.limit}
              />
              <Gauge
                label={dash.subscription.agentTurns}
                used={u.agent_turns.used}
                limit={u.agent_turns.limit}
              />
              <Gauge label={dash.subscription.drafts} used={u.drafts.used} limit={u.drafts.limit} />
            </Section>
          )}
          <Section labelledBy={`${id}-r`}>
            <Label id={`${id}-r`}>{dash.subscription.renew}</Label>
            <RenewBox
              planId={s?.plan_id ?? 'pro'}
              onPaid={() => invalidate(['subscription', 'vendor'])}
            />
          </Section>
          <Section labelledBy={`${id}-h`}>
            <Label id={`${id}-h`}>{dash.subscription.receipts}</Label>
            {receipts.data?.data.filter((r) => r.status === 'settled').length ? (
              <ul>
                {receipts.data.data
                  .filter((r) => r.status === 'settled')
                  .map((r) => (
                    <li
                      key={r.id}
                      className="flex justify-between gap-3 border-b border-d-hairline py-2"
                    >
                      <span>
                        {dash.subscription.months(r.months)}
                        <span className="block text-d-ink-soft">
                          {dash.subscription.covers(fmtDate(r.covers.from), fmtDate(r.covers.to))}
                        </span>
                      </span>
                      <span className="tnum">{formatSats(r.amount_sat)}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-d-ink-soft">{dash.subscription.receiptsEmpty}</p>
            )}
          </Section>
        </>
      )}
    </Page_>
  );
}

// ------------------------------------------------------------------------------------------- shop settings

export function ShopSettings() {
  const { vendor, refresh } = useVendor();
  const id = useId();
  const [name, setName] = useState(vendor.display_name);
  const [whatsapp, setWhatsapp] = useState(vendor.contact_whatsapp_e164 ?? '');
  const [zones, setZones] = useState<DeliveryZone[]>(vendor.settings.delivery.zones);
  const [pickup, setPickup] = useState(vendor.settings.delivery.pickup);
  const [hours, setHours] = useState(
    vendor.settings.hours[0] ?? { days: 'lun-sam', open: '09:00', close: '19:00' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const phone = whatsapp.trim() ? toE164(whatsapp) : null;
    if (whatsapp.trim() && !phone) {
      setBusy(false);
      setError(dash.shopForm.whatsapp);
      return;
    }
    try {
      await api<VendorMe>('/vendors/me', {
        method: 'PATCH',
        body: {
          display_name: name.trim(),
          contact_whatsapp_e164: phone,
          settings: {
            delivery: {
              zones: zones.filter((z) => z.label.trim()),
              pickup: { available: pickup.available, address_text: pickup.address_text || null },
            },
            hours: [hours],
          },
        },
      });
      await refresh();
      setOk(dash.common.saved);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page_ title={dash.shopForm.title}>
      <form onSubmit={save} className="space-y-1">
        <Section>
          <label htmlFor={`${id}-n`} className="block font-medium">
            {dash.shopForm.name}
          </label>
          <input
            id={`${id}-n`}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${field} mt-1`}
          />
          <label htmlFor={`${id}-w`} className="mt-4 block font-medium">
            {dash.shopForm.whatsapp}
          </label>
          <input
            id={`${id}-w`}
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="77 123 45 67"
            className={`${field} tnum mt-1`}
          />
        </Section>
        <Section labelledBy={`${id}-z`}>
          <Label id={`${id}-z`}>{dash.shopForm.zones}</Label>
          <ul className="space-y-3">
            {zones.map((z, i) => (
              <li key={z.id} className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <label htmlFor={`${id}-zl${i}`} className="block text-sm font-medium">
                    {dash.shopForm.zoneLabel}
                  </label>
                  <input
                    id={`${id}-zl${i}`}
                    value={z.label}
                    onChange={(e) =>
                      setZones((zs) =>
                        zs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                      )
                    }
                    className={`${field} mt-1`}
                  />
                </div>
                <div className="w-32">
                  <label htmlFor={`${id}-zf${i}`} className="block text-sm font-medium">
                    {dash.shopForm.zoneFee}
                  </label>
                  <input
                    id={`${id}-zf${i}`}
                    inputMode="numeric"
                    value={z.fee.amount}
                    onChange={(e) =>
                      setZones((zs) =>
                        zs.map((x, j) =>
                          j === i
                            ? { ...x, fee: { ...x.fee, amount: Number(e.target.value) || 0 } }
                            : x,
                        ),
                      )
                    }
                    className={`${field} tnum mt-1`}
                  />
                </div>
                <button
                  type="button"
                  className={btn.quiet}
                  onClick={() => setZones((zs) => zs.filter((_, j) => j !== i))}
                >
                  {dash.shopForm.remove}
                  <span className="sr-only"> {z.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${btn.secondary} mt-3`}
            onClick={() =>
              setZones((zs) => [
                ...zs,
                {
                  id: `zone-${Date.now().toString(36)}`,
                  label: '',
                  fee: { amount: 1000, currency: 'XOF' },
                },
              ])
            }
          >
            {dash.shopForm.addZone}
          </button>
          <p className="mt-2 text-sm text-d-ink-soft">
            {zones
              .filter((z) => z.label)
              .map((z) => `${z.label} ${formatMoney(z.fee)}`)
              .join(' · ')}
          </p>
        </Section>
        <Section>
          <label className="flex min-h-11 items-center gap-3 font-medium">
            <input
              type="checkbox"
              checked={pickup.available}
              onChange={(e) => setPickup((p) => ({ ...p, available: e.target.checked }))}
              className="size-5 accent-d-ink"
            />
            {dash.shopForm.pickup}
          </label>
          {pickup.available && (
            <>
              <label htmlFor={`${id}-pa`} className="mt-2 block font-medium">
                {dash.shopForm.pickupAddress}
              </label>
              <input
                id={`${id}-pa`}
                value={pickup.address_text ?? ''}
                onChange={(e) => setPickup((p) => ({ ...p, address_text: e.target.value }))}
                className={`${field} mt-1`}
              />
            </>
          )}
        </Section>
        <Section labelledBy={`${id}-h`}>
          <Label id={`${id}-h`}>{dash.shopForm.hours}</Label>
          <div className="flex flex-wrap gap-3">
            {(['days', 'open', 'close'] as const).map((k) => (
              <div key={k}>
                <label htmlFor={`${id}-h${k}`} className="block text-sm font-medium">
                  {dash.shopForm[k]}
                </label>
                <input
                  id={`${id}-h${k}`}
                  type={k === 'days' ? 'text' : 'time'}
                  value={hours[k]}
                  onChange={(e) => setHours((h) => ({ ...h, [k]: e.target.value }))}
                  className={`${field} mt-1 w-36`}
                />
              </div>
            ))}
          </div>
        </Section>
        <div className="pt-4">
          <button type="submit" disabled={busy} className={btn.primary}>
            {dash.common.save}
          </button>
          <Feedback error={error} ok={ok} />
        </div>
      </form>
    </Page_>
  );
}

// ------------------------------------------------------------------------------------------- security

interface KeyItem {
  pubkey: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}
interface SessionItem {
  id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export function SecurityPage() {
  const keys = useResource<{ data: KeyItem[] }>('keys', '/vendors/me/keys');
  const sessions = useResource<{ data: SessionItem[] }>('sessions', '/auth/sessions');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <Page_ title={dash.security.title}>
      <Section labelledBy={`${id}-k`}>
        <Label id={`${id}-k`}>{dash.security.keys}</Label>
        <p className="mb-3 text-d-ink-soft">{dash.security.keysHint}</p>
        {keys.error ? (
          <ErrorState error={keys.error} onRetry={keys.refresh} />
        ) : !keys.data ? (
          <ListSkeleton rows={1} />
        ) : (
          <ul>
            {keys.data.data.map((k) => (
              <li key={k.pubkey} className="border-b border-d-hairline py-2">
                <span className="font-medium">{k.label ?? '—'}</span>
                <span className="tnum block break-all text-sm text-d-ink-soft">
                  {k.pubkey.slice(0, 12)}…{k.pubkey.slice(-8)}
                </span>
                <span className="text-sm text-d-ink-soft">
                  {k.last_used_at
                    ? dash.security.lastUsed(relativeTime(k.last_used_at))
                    : dash.security.never}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section labelledBy={`${id}-d`}>
        <Label id={`${id}-d`}>{dash.security.devices}</Label>
        {sessions.error ? (
          <ErrorState error={sessions.error} onRetry={sessions.refresh} />
        ) : !sessions.data ? (
          <ListSkeleton rows={2} />
        ) : (
          <ul>
            {sessions.data.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-d-hairline py-2"
              >
                <span>
                  <span className="font-medium">{s.device_label ?? '—'}</span>
                  {s.current && (
                    <span className="ml-2 rounded-full bg-d-paid-soft px-2 text-sm text-d-paid">
                      {dash.security.current}
                    </span>
                  )}
                  <span className="block text-sm text-d-ink-soft">
                    {dash.security.lastSeen(relativeTime(s.last_seen_at))}
                  </span>
                </span>
                {!s.current && (
                  <button
                    type="button"
                    className={btn.secondary}
                    onClick={() =>
                      api(`/auth/sessions/${s.id}`, { method: 'DELETE' }).then(
                        sessions.refresh,
                        (err) => setError(describeError(err)),
                      )
                    }
                  >
                    {dash.security.signOutDevice}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Feedback error={error} />
      </Section>
    </Page_>
  );
}
