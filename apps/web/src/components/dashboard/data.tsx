'use client';

// The dashboard's data: one request function (core through the /api/v1 rewrites, or the demo data), a hook that
// reads and re-reads, and a context that holds the shop, the toast and the live stream. Every write bumps a
// version and every reader refetches, so the numbers on screen never disagree after an action. Core's stream
// (GET /api/v1/vendors/me/events) bumps it too, and leaves a note in the bell.

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, api } from '@/lib/browser-api';
import { demoRequest } from './demo';
import type { Upload, Vendor } from './types';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RequestInit {
  method?: Method;
  body?: unknown;
  idempotencyKey?: string;
}

export interface LiveNote {
  id: string;
  type: string;
  text: string;
  href: string | null;
  at: string;
}

interface DashboardState {
  demo: boolean;
  vendor: Vendor | null;
  version: number;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** A write: runs it, says so in the toast, refreshes every reader. Errors are shown and rethrown. */
  mutate: <T>(path: string, init: RequestInit, done?: string) => Promise<T>;
  refresh: () => void;
  flash: (text: string, tone?: 'ok' | 'error') => void;
  notes: LiveNote[];
  clearNotes: () => void;
}

const Ctx = createContext<DashboardState | null>(null);

export function useDashboard(): DashboardState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboard outside <DashboardProvider>');
  return v;
}

/** A sentence for the vendor, from a problem code (architecture.md 7.4). */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const { code, detail, status } = err.problem;
    const known: Record<string, string> = {
      NETWORK: 'Pas de connexion. Vérifiez votre réseau et réessayez.',
      NOT_FOUND: 'Introuvable : cet élément a peut-être été supprimé.',
      RATE_LIMITED: 'Trop de requêtes, réessayez dans un instant.',
      PAYMENT_UNAVAILABLE: 'Paiement momentanément indisponible. Réessayez dans un instant.',
      PROVIDER_TIMEOUT: 'Le portefeuille ne répond pas. Est-il en ligne ?',
      NWC_URI_INVALID: 'Ce lien de connexion n’est pas valide. Copiez-le à nouveau.',
      NWC_PERMISSIONS_TOO_BROAD:
        'Cette connexion peut dépenser vos fonds. Créez une connexion « réception seulement ».',
      NWC_METHODS_MISSING: 'Ce portefeuille ne sait pas créer ou vérifier des factures.',
      NWC_TIMEOUT: 'Votre portefeuille ne répond pas. Est-il en ligne ?',
      NWC_WALLET_ERROR: 'Le portefeuille a refusé la demande.',
      PLAN_LIMIT_REACHED: 'Limite de votre formule atteinte. Passez à la formule supérieure.',
      STEP_UP_REQUIRED: 'Confirmez avec votre clé Nostr pour faire ce changement.',
    };
    // Core writes these in French and says what to do (a wallet without receiving capacity, a bad field): show them.
    if ((code === 'VALIDATION_FAILED' || code.startsWith('NWC_')) && detail) return detail;
    if (status === 409) return detail ?? 'Cette action vient d’être faite ailleurs. Rechargez.';
    return known[code] ?? detail ?? 'Une erreur s’est produite. Réessayez.';
  }
  return 'Une erreur s’est produite. Réessayez.';
}

/** Short lines for the bell, from core's stream (docs/api.json, GET /vendors/me/events). */
function noteFor(type: string, data: Record<string, unknown>): Omit<LiveNote, 'id' | 'at'> | null {
  const n = typeof data.number === 'string' ? ` ${data.number}` : '';
  const orderHref =
    typeof data.order_id === 'string' ? `/app/commandes/${data.order_id}` : '/app/commandes';
  const chatHref =
    typeof data.conversation_id === 'string'
      ? `/app/discussions/${data.conversation_id}`
      : '/app/discussions';
  switch (type) {
    case 'order.created':
      return { type, text: `Nouvelle commande${n}, en attente de paiement`, href: orderHref };
    case 'order.paid':
      return { type, text: `Commande${n} payée : à expédier`, href: orderHref };
    case 'order.expired':
      return { type, text: `Commande${n} expirée sans paiement`, href: orderHref };
    case 'order.cancelled':
      return { type, text: `Commande${n} annulée`, href: orderHref };
    case 'conversation.handoff':
      return { type, text: 'Un client vous attend dans une discussion', href: chatHref };
    case 'conversation.new':
      return { type, text: 'Nouvelle discussion sur votre boutique', href: chatHref };
    case 'draft.ready':
      return {
        type,
        text:
          data.status === 'failed'
            ? 'La photo n’a pas pu être lue. Réessayez.'
            : 'Un brouillon photo est prêt à vérifier',
        href: '/app/catalogue#brouillons',
      };
    case 'wallet.degraded':
      return { type, text: 'Votre portefeuille ne répond plus', href: '/app/portefeuille' };
    case 'wallet.restored':
      return { type, text: 'Votre portefeuille répond à nouveau', href: '/app/portefeuille' };
    case 'subscription.updated':
      return { type, text: 'Votre abonnement a changé', href: '/app/abonnement' };
    case 'usage.warning':
      return {
        type,
        text: 'Vous approchez de la limite de votre formule',
        href: '/app/abonnement',
      };
    default:
      return null;
  }
}

const STREAM_EVENTS = [
  'order.created',
  'order.paid',
  'order.expired',
  'order.cancelled',
  'order.fulfilled',
  'wallet.degraded',
  'wallet.restored',
  'wallet.paired',
  'conversation.handoff',
  'conversation.new',
  'usage.warning',
  'subscription.updated',
  'draft.ready',
];

export function DashboardProvider({ demo, children }: { demo: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [notes, setNotes] = useState<LiveNote[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ text, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === 'error' ? 6000 : 3200);
  }, []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      if (demo) return demoRequest<T>(path, init);
      try {
        return await api<T>(path, init);
      } catch (err) {
        if (err instanceof ApiError && err.problem.status === 401) {
          router.replace(`/app/login?next=${encodeURIComponent(pathname)}`);
        }
        throw err;
      }
    },
    [demo, router, pathname],
  );

  const mutate = useCallback(
    async <T,>(path: string, init: RequestInit, done?: string): Promise<T> => {
      try {
        const res = await request<T>(path, init);
        if (done) flash(done);
        refresh();
        return res;
      } catch (err) {
        flash(errorText(err), 'error');
        throw err;
      }
    },
    [request, flash, refresh],
  );

  // The shop: no session goes to sign-in (request does it), no shop yet goes to onboarding.
  useEffect(() => {
    request<Vendor>('/vendors/me').then(setVendor, (err) => {
      if (err instanceof ApiError && err.problem.status === 404) router.replace('/app/onboarding');
    });
  }, [request, router, version]);

  // Live updates. EventSource reconnects by itself; a closed stream (signed out) stops it.
  useEffect(() => {
    if (demo) return;
    const es = new EventSource('/api/v1/vendors/me/events');
    const onEvent = (e: MessageEvent) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(e.data);
      } catch {}
      const note = noteFor(e.type, data);
      if (note) {
        setNotes((all) =>
          [
            { ...note, id: e.lastEventId || `${Date.now()}`, at: new Date().toISOString() },
            ...all,
          ].slice(0, 20),
        );
      }
      refresh();
    };
    for (const t of STREAM_EVENTS) es.addEventListener(t, onEvent);
    return () => es.close();
  }, [demo, refresh]);

  const value = useMemo<DashboardState>(
    () => ({
      demo,
      vendor,
      version,
      request,
      mutate,
      refresh,
      flash,
      notes,
      clearNotes: () => setNotes([]),
    }),
    [demo, vendor, version, request, mutate, refresh, flash, notes],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <div className={`feedback ${toast.tone === 'error' ? 'error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </Ctx.Provider>
  );
}

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Reads `path` (null: nothing to read yet) and reads it again after every write or live event. The previous
 * data stays on screen while it reloads. `poll` re-reads every that many milliseconds while the page is visible.
 */
export function useResource<T>(path: string | null, poll?: number): Resource<T> {
  const { request, version } = useDashboard();
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({
    loading: path !== null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    request<T>(path).then(
      (data) => live && setState({ data, loading: false }),
      (error) => live && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [path, request, version, tick]);

  useEffect(() => {
    if (!poll || path === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, poll);
    return () => window.clearInterval(id);
  }, [poll, path]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload } as Resource<T>;
}

/** A random Idempotency-Key for one user action. */
export const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Photos → presigned uploads (POST /media/uploads, then PUT straight to storage). Returns the storage keys; core
 * processes them (resize, re-encode, EXIF dropped) when a product, a draft or the branding uses them.
 */
export async function uploadImages(
  request: DashboardState['request'],
  files: File[],
): Promise<string[]> {
  const keys: string[] = [];
  for (const f of files) {
    const up = await request<Upload>('/media/uploads', {
      method: 'POST',
      body: { content_type: f.type, size_bytes: f.size },
    });
    const res = await fetch(up.upload_url, { method: up.method, headers: up.headers, body: f });
    if (!res.ok) throw new Error('upload');
    keys.push(up.storage_key);
  }
  return keys;
}
