'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/browser-api';
import {
  describeError,
  type OnboardingStep,
  SLUG_PATTERN,
  slugify,
  stepFor,
  toE164,
} from '@/lib/onboarding';
import type {
  PlansResponse,
  SubscriptionView,
  Vendor,
  VendorCreateRequest,
  WalletLinkRequest,
} from '@/lib/vendor-types';

type Screen = OnboardingStep | 'loading' | 'failed';

const STEPS: { id: Exclude<OnboardingStep, 'done'>; label: string }[] = [
  { id: 'shop', label: 'Your shop' },
  { id: 'wallet', label: 'Your wallet' },
  { id: 'plan', label: 'Your plan' },
];

const inputClass =
  'peer w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#173B32] transition-colors rounded-none min-h-11';
const labelClass = 'block pv-sans text-[10px] uppercase tracking-widest text-black/50 mb-1';
const hintClass = 'pv-sans text-xs text-black/50 mt-1';
const primaryButton =
  'relative overflow-hidden pv-sans text-xs uppercase tracking-[0.2em] font-medium border border-[#173B32] bg-[#173B32] text-[#F6F4F0] py-4 px-8 w-full text-center min-h-12 hover:bg-transparent hover:text-[#173B32] transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer';
const linkButton = 'pv-sans text-xs underline underline-offset-4 min-h-11 cursor-pointer';

/** A short sentence about the next step, with a hairline in front (as in the landing page's lists). */
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="w-4 h-px bg-[#E3342F] mt-[0.7em] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function Wizard() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('loading');
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Reads where the vendor stands and shows the first step still missing. */
  const load = useCallback(async () => {
    try {
      const me = await api<Vendor>('/vendors/me');
      setVendor(me);
      setScreen(stepFor(me));
    } catch (err) {
      if (err instanceof ApiError && err.problem.status === 401) {
        router.replace('/app/login?next=/app/onboarding');
      } else if (err instanceof ApiError && err.problem.status === 404) {
        setScreen('shop'); // signed in, no shop yet
      } else {
        setError(describeError(err));
        setScreen('failed');
      }
    }
  }, [router]);

  useEffect(() => {
    load();
    // The trial's name and length come from core; the defaults cover a failed request.
    api<PlansResponse>('/plans').then(setPlans, () => {});
  }, [load]);

  /** Runs one step's request, then shows what is missing next. */
  async function submit(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const current = STEPS.findIndex((s) => s.id === screen);

  if (screen === 'loading') {
    return (
      <p role="status" className="pv-sans text-sm text-black/60 py-24">
        Loading…
      </p>
    );
  }

  if (screen === 'failed') {
    return (
      <div className="py-12 max-w-md">
        <p role="alert" className="pv-sans text-sm border border-[#1111111f] p-6 mb-6">
          {error}
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setScreen('loading');
            load();
          }}
          className={primaryButton}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      {screen !== 'done' && (
        <ol
          aria-label="Progress"
          className="flex gap-6 md:gap-10 mb-12 pb-6 border-b border-[#1111111f]"
        >
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={i === current ? 'step' : undefined}
              className={`pv-sans text-[10px] uppercase tracking-[0.2em] flex items-center gap-3 ${
                i === current ? 'text-[#173B32] font-medium' : 'text-black/40'
              }`}
            >
              <span
                className={`size-6 grid place-items-center rounded-full border tnum ${
                  i === current ? 'bg-[#173B32] text-[#F6F4F0] border-[#173B32]' : 'border-current'
                }`}
              >
                {i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      <div aria-live="assertive" role="alert" className="min-h-6">
        {error && (
          <p className="pv-sans text-sm text-[#a3214f] border border-[#a3214f]/30 px-4 py-3 mb-6">
            {error}
          </p>
        )}
      </div>

      {screen === 'shop' && (
        <ShopStep
          busy={busy}
          onSubmit={(body) => submit(() => api<Vendor>('/vendors', { method: 'POST', body }))}
        />
      )}
      {screen === 'wallet' && (
        <WalletStep
          busy={busy}
          onSubmit={(body) => submit(() => api('/vendors/me/wallet', { method: 'PUT', body }))}
        />
      )}
      {screen === 'plan' && (
        <PlanStep
          busy={busy}
          plans={plans}
          onSubmit={(planId) =>
            submit(() =>
              api<SubscriptionView>('/vendors/me/subscription/trial', {
                method: 'POST',
                body: { plan_id: planId },
              }),
            )
          }
        />
      )}
      {screen === 'done' && vendor && <DoneStep vendor={vendor} />}
    </div>
  );
}

function ShopStep({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: VendorCreateRequest) => void;
}) {
  const ids = { name: useId(), slug: useId(), wa: useId() };
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => setOrigin(window.location.origin), []);

  const nameOk = name.trim().length >= 2 && name.trim().length <= 60;
  const slugOk = SLUG_PATTERN.test(slug);
  const e164 = toE164(whatsapp);
  const waOk = whatsapp.trim() === '' || e164 !== null;
  const ready = nameOk && slugOk && waOk;

  return (
    <form
      className="flex flex-col gap-10 max-w-lg"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onSubmit({
          display_name: name.trim(),
          slug,
          ...(e164 ? { contact_whatsapp_e164: e164 } : {}),
        });
      }}
    >
      <div>
        <h1 className="pv-serif text-4xl md:text-5xl font-light mb-3">Name your shop</h1>
        <p className="pv-sans text-sm text-black/60 leading-relaxed">
          This is what customers see at the top of your shop. You can change it later.
        </p>
      </div>

      <div>
        <label htmlFor={ids.name} className={labelClass}>
          Shop name
        </label>
        <input
          id={ids.name}
          value={name}
          maxLength={60}
          autoComplete="organization"
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={ids.slug} className={labelClass}>
          Shop address
        </label>
        <div className="flex items-baseline gap-1 border-b border-[#11111130] focus-within:border-[#173B32] transition-colors">
          <span className="pv-sans text-sm text-black/40 shrink-0">
            {origin.replace(/^https?:\/\//, '')}/s/
          </span>
          <input
            id={ids.slug}
            value={slug}
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            aria-describedby={`${ids.slug}-hint`}
            aria-invalid={slug.length > 0 && !slugOk}
            className="flex-1 min-w-0 bg-transparent py-2 pv-sans text-sm tracking-wider text-[#111] focus:outline-none min-h-11"
          />
        </div>
        <p
          id={`${ids.slug}-hint`}
          className={`${hintClass} ${slug.length > 0 && !slugOk ? 'text-[#a3214f]' : ''}`}
        >
          Letters, numbers and dashes, 3 to 40 characters.
        </p>
      </div>

      <div>
        <label htmlFor={ids.wa} className={labelClass}>
          WhatsApp number <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <input
          id={ids.wa}
          type="tel"
          autoComplete="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          aria-invalid={!waOk}
          aria-describedby={`${ids.wa}-hint`}
          className={inputClass}
        />
        <p id={`${ids.wa}-hint`} className={`${hintClass} ${!waOk ? 'text-[#a3214f]' : ''}`}>
          {waOk
            ? 'Customers can reach you here when the assistant hands over. Example: 77 123 45 67'
            : 'Use the country code, for example +221 77 123 45 67.'}
        </p>
      </div>

      <button type="submit" disabled={busy || !ready} className={primaryButton}>
        {busy ? 'Creating your shop…' : 'Create my shop'}
      </button>
    </form>
  );
}

function WalletStep({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: WalletLinkRequest) => void;
}) {
  const ids = { uri: useId() };
  const [uri, setUri] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  function submit() {
    setLocal(null);
    const value = uri.trim();
    if (!value.startsWith('nostr+walletconnect://')) {
      setLocal(
        'A connection link starts with nostr+walletconnect://. Copy it again from your wallet.',
      );
      return;
    }
    onSubmit({ kind: 'nwc', uri: value });
  }

  return (
    <form
      className="flex flex-col gap-10 max-w-lg"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <h1 className="pv-serif text-4xl md:text-5xl font-light mb-3">Connect your wallet</h1>
        <p className="pv-sans text-sm text-black/60 leading-relaxed">
          Customers pay straight into your wallet. Selly only asks it for invoices and never touches
          the money.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="How to connect"
        className="flex gap-6 border-b border-[#1111111f]"
      >
        <span className="pv-sans text-xs uppercase tracking-[0.2em] min-h-11 pb-3 -mb-px border-b-2 border-[#173B32] text-[#173B32] font-medium">
          Connection link
        </span>
      </div>

      {local && (
        <p role="alert" className="pv-sans text-sm text-[#a3214f]">
          {local}
        </p>
      )}

      <div>
        <label htmlFor={ids.uri} className={labelClass}>
          Wallet connection link
        </label>
        <textarea
          id={ids.uri}
          rows={3}
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="nostr+walletconnect://…"
          className={`${inputClass} resize-none`}
        />
        <ul className="pv-sans text-sm text-black/70 leading-relaxed space-y-3 mt-6">
          <Bullet>
            In your wallet app, find “Nostr Wallet Connect” (or “Connections”) and add a new
            connection.
          </Bullet>
          <Bullet>
            Choose <strong>receive only</strong>: it can create and check invoices, nothing else.
          </Bullet>
          <Bullet>
            Copy the link and paste it here. Selly stores it encrypted and never shows it again.
          </Bullet>
        </ul>
      </div>

      <p className="pv-sans text-xs text-black/50">
        Lightning addresses are not supported yet. Use a connection link from your wallet app.
      </p>

      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? 'Checking your wallet…' : 'Connect my wallet'}
      </button>
      <p className="pv-sans text-xs text-black/50">
        No wallet yet?{' '}
        <Link href="/aide/payer-en-bitcoin" className="underline underline-offset-4">
          See how to get one and buy bitcoin with Orange Money or Wave
        </Link>
        .
      </p>
    </form>
  );
}

function PlanStep({
  busy,
  plans,
  onSubmit,
}: {
  busy: boolean;
  plans: PlansResponse | null;
  onSubmit: (planId: PlansResponse['trial']['plan_id']) => void;
}) {
  const trial = plans?.trial ?? { plan_id: 'pro' as const, days: 14 };
  const name = plans?.data.find((p) => p.id === trial.plan_id)?.name ?? 'Pro';
  return (
    <div className="flex flex-col gap-10 max-w-lg">
      <div>
        <h1 className="pv-serif text-4xl md:text-5xl font-light mb-3">Start your free trial</h1>
        <p className="pv-sans text-sm text-black/60 leading-relaxed">
          {trial.days} days of {name}, with nothing to pay now. Your shop goes live as soon as you
          start.
        </p>
      </div>
      <ul className="pv-sans text-sm text-black/70 leading-relaxed space-y-3">
        <Bullet>
          Every {name} feature is on for {trial.days} days.
        </Bullet>
        <Bullet>
          Afterwards you pick a plan and pay from your own wallet. Nothing renews on its own.
        </Bullet>
        <Bullet>One trial per key and per wallet.</Bullet>
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit(trial.plan_id)}
        className={primaryButton}
      >
        {busy ? 'Starting…' : `Start my ${trial.days}-day trial`}
      </button>
      <p className="pv-sans text-xs text-black/50">
        <Link href="/tarifs" className="underline underline-offset-4">
          Compare the plans
        </Link>
      </p>
    </div>
  );
}

function DoneStep({ vendor }: { vendor: Vendor }) {
  const [copied, setCopied] = useState(false);
  const share = `https://wa.me/?text=${encodeURIComponent(`Visit ${vendor.display_name} on Selly: ${vendor.store_url}`)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(vendor.store_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is on screen to copy by hand.
    }
  }

  return (
    <div className="flex flex-col gap-10 max-w-lg">
      <div>
        <p className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-6 flex items-center gap-4">
          <span className="w-8 h-px bg-[#E3342F]" />
          You are live
        </p>
        <h1 className="pv-serif text-4xl md:text-6xl font-light leading-[1.05] mb-4">
          {vendor.display_name} is <span className="italic text-[#8AAE4A]">open</span>
        </h1>
        <p className="pv-sans text-sm text-black/60 leading-relaxed">
          Share this one link on WhatsApp, Instagram or wherever your customers find you.
        </p>
      </div>

      <div>
        <p className={labelClass}>Your shop link</p>
        <a
          href={vendor.store_url}
          className="block pv-sans text-sm break-all border border-[#1111111f] bg-[#EAE7E0] px-4 py-3 hover:border-[#173B32] transition-colors"
        >
          {vendor.store_url}
        </a>
        <div className="flex gap-6 mt-2">
          <button type="button" onClick={copy} className={linkButton}>
            {copied ? 'Copied' : 'Copy the link'}
          </button>
          <a
            href={share}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkButton} inline-flex items-center`}
          >
            Share on WhatsApp
          </a>
        </div>
      </div>

      <Link href="/app" className={`${primaryButton} inline-flex items-center justify-center`}>
        Go to my dashboard
      </Link>
      <p className="pv-sans text-xs text-black/50">
        Next: add your first products from the dashboard.
      </p>
    </div>
  );
}
