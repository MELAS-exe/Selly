'use client';

// Web Push for the vendor (apps/web/AGENTS.md): register the service worker, subscribe with the VAPID key, send the
// subscription to core. Offered once after a first paid order seen live, never on the first visit; also a switch
// in Réglages. Logic from the first dashboard (PR #30), in the draft's design.

import { useEffect, useState } from 'react';
import { api } from '@/lib/browser-api';

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const DISMISSED = 'selly:push-offer-dismissed';

export type PushState = 'unsupported' | 'unconfigured' | 'default' | 'granted' | 'denied' | 'on';

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

const TEXT: Record<PushState, string> = {
  on: 'Activées sur cet appareil.',
  denied: 'Bloquées par le navigateur : autorisez-les dans les réglages du site.',
  unconfigured: 'Pas encore disponibles sur ce serveur.',
  unsupported: 'Ce navigateur ne les gère pas. Installez l’application depuis Chrome ou Safari.',
  default: 'Une alerte quand une commande est payée ou qu’un client vous attend.',
  granted: 'Une alerte quand une commande est payée ou qu’un client vous attend.',
};

/** The switch in Réglages. */
export function PushToggle() {
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  return (
    <div className="info-row" style={{ alignItems: 'center' }}>
      <span style={{ display: 'block' }}>
        <b style={{ display: 'block', color: 'var(--ink)' }}>Notifications sur cet appareil</b>
        {TEXT[state]}
      </span>
      {(state === 'default' || state === 'granted') && (
        <button
          type="button"
          disabled={busy}
          className="button small"
          onClick={async () => {
            setBusy(true);
            setState(await enablePush().catch(() => 'default' as const));
            setBusy(false);
          }}
        >
          Activer
        </button>
      )}
    </div>
  );
}

/** After a paid order arrives live, offer alerts once (unless they are on, blocked or dismissed). */
export function PushOffer({ trigger }: { trigger: boolean }) {
  const [state, setState] = usePushState();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED) === '1');
    } catch {}
  }, []);
  if (!trigger || dismissed || !(state === 'default' || state === 'granted')) return null;
  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {}
  };
  return (
    <div className="banner" role="dialog" aria-label="Notifications">
      <span>
        Une commande vient d’être payée. Être prévenu sur ce téléphone la prochaine fois ?
      </span>
      <span style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="button small primary"
          onClick={async () => {
            setState(await enablePush().catch(() => 'default' as const));
            close();
          }}
        >
          Activer
        </button>
        <button type="button" className="button small" onClick={close}>
          Plus tard
        </button>
      </span>
    </div>
  );
}
