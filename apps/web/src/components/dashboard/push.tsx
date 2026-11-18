'use client';

// Web Push for the vendor (apps/web/AGENTS.md): register the service worker, subscribe with the VAPID key, send the
// subscription to core. Offered after a first sale, never on the first visit; also a switch in "More".

import { useEffect, useState } from 'react';
import { api } from '@/lib/browser-api';
import { dash } from '@/lib/i18n/dashboard';
import { useLive } from './live';
import { btn } from './ui';

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const DISMISSED = 'selly:push-offer-dismissed';

type PushState = 'unsupported' | 'unconfigured' | 'default' | 'granted' | 'denied' | 'on';

function supported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Registers /sw.js (production only: in development it would cache Next's hot-reload chunks). */
export function registerServiceWorker() {
  if (!supported() || process.env.NODE_ENV !== 'production') return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

function base64Url(key: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (!KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) return 'on';
  return Notification.permission === 'granted' ? 'granted' : 'default';
}

async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (!KEY) return 'unconfigured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';
  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64Url(KEY),
  });
  const json = sub.toJSON();
  await api('/vendors/me/push-subscriptions', {
    method: 'POST',
    body: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      expiration_time: json.expirationTime ?? null,
    },
  });
  return 'on';
}

function usePushState() {
  const [state, setState] = useState<PushState>('unsupported');
  useEffect(() => {
    currentState().then(setState, () => setState('unsupported'));
  }, []);
  return [state, setState] as const;
}

/** The switch in "More". */
export function PushToggle() {
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-display text-2xl">{dash.more.notifications}</p>
        <p className="text-d-ink-soft">
          {state === 'on'
            ? dash.push.done
            : state === 'denied'
              ? dash.push.denied
              : state === 'unconfigured' || state === 'unsupported'
                ? dash.push.unavailable
                : dash.more.notificationsHint}
        </p>
      </div>
      {(state === 'default' || state === 'granted') && (
        <button
          type="button"
          disabled={busy}
          className={btn.secondary}
          onClick={async () => {
            setBusy(true);
            setState(await enablePush().catch(() => 'default' as const));
            setBusy(false);
          }}
        >
          {dash.more.enable}
        </button>
      )}
      {state === 'on' && (
        <span className="rounded-full bg-d-paid-soft px-3 py-1 text-d-paid">
          {dash.more.enabled}
        </span>
      )}
    </div>
  );
}

/** After a paid order arrives live, offer alerts once (unless they are on, blocked or dismissed). */
export function PushOffer() {
  const { subscribe } = useLive();
  const [state, setState] = usePushState();
  const [show, setShow] = useState(false);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type !== 'order.paid') return;
        let dismissed = false;
        try {
          dismissed = localStorage.getItem(DISMISSED) === '1';
        } catch {}
        if (!dismissed) setShow(true);
      }),
    [subscribe],
  );

  if (!show || !(state === 'default' || state === 'granted')) return null;
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {}
  };
  return (
    <div
      role="dialog"
      aria-label={dash.more.notifications}
      className="d-arrive flex flex-wrap items-center justify-between gap-3 border-b border-d-hairline bg-d-paid-soft px-4 py-3 lg:px-8"
    >
      <p>{dash.push.offer}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className={btn.primary}
          onClick={async () => {
            setState(await enablePush().catch(() => 'default' as const));
            close();
          }}
        >
          {dash.push.accept}
        </button>
        <button type="button" className={btn.secondary} onClick={close}>
          {dash.push.later}
        </button>
      </div>
    </div>
  );
}
