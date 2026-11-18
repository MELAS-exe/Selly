'use client';

// A small data hook for the dashboard, instead of SWR or react-query: fetch, loading, error, refresh, and
// invalidation by key. The live stream calls invalidate(["orders"]) and every mounted list of orders reloads
// quietly (no skeleton), while what is on screen stays in place.

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
import { api } from '../browser-api';

const Bus = createContext<EventTarget | null>(null);

export function ResourceProvider({ children }: { children: ReactNode }) {
  const bus = useMemo(() => new EventTarget(), []);
  return <Bus.Provider value={bus}>{children}</Bus.Provider>;
}

/** "orders" matches "orders" and "orders?status=paid"; "order:o1" matches only itself. */
export function keyMatches(key: string, target: string): boolean {
  return key === target || key.startsWith(`${target}?`);
}

export function useInvalidate() {
  const bus = useContext(Bus);
  return useCallback(
    (keys: string[]) => {
      if (keys.length) bus?.dispatchEvent(new CustomEvent('invalidate', { detail: keys }));
    },
    [bus],
  );
}

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Reload without showing the skeleton again. */
  refresh: () => Promise<void>;
  /** Replace the data locally (optimistic updates). */
  mutate: (next: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Loads `path` (under /api/v1) and keeps it fresh. `key` names it for invalidation; null `path` waits.
 * The first load shows `loading`; later loads are quiet. A failed quiet reload keeps the old data.
 */
export function useResource<T>(key: string, path: string | null): Resource<T> {
  const bus = useContext(Bus);
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);
  const hasData = useRef(false);

  const load = useCallback(
    async (quiet: boolean) => {
      if (!path) return;
      const mine = ++seq.current;
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        const next = await api<T>(path);
        if (mine !== seq.current) return;
        hasData.current = true;
        setData(next);
        setError(null);
      } catch (err) {
        if (mine !== seq.current) return;
        if (!quiet || !hasData.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    hasData.current = false;
    setData(undefined);
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!bus) return;
    const on = (e: Event) => {
      const keys = (e as CustomEvent<string[]>).detail;
      if (keys.some((k) => keyMatches(key, k))) void load(true);
    };
    bus.addEventListener('invalidate', on);
    return () => bus.removeEventListener('invalidate', on);
  }, [bus, key, load]);

  const mutate = useCallback((next: T | ((prev: T | undefined) => T)) => {
    setData((prev) =>
      typeof next === 'function' ? (next as (p: T | undefined) => T)(prev) : next,
    );
  }, []);

  return { data, error, loading, refresh: () => load(true), mutate };
}
