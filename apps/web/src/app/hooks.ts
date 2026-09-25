import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MasterData } from '@/lib/types';
import { cacheGet, cachePut, type OutboxItem } from '@/offline/db';
import { onOutboxChange, pendingItems, pruneSynced, syncOutbox } from '@/offline/sync';

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

/** Master data: served from the device cache instantly, refreshed in the background. */
export function useMasterData() {
  return useQuery<MasterData>({
    queryKey: ['master'],
    queryFn: async () => {
      const cached = await cacheGet<MasterData>('master');
      try {
        const fresh = await api.masterData();
        await cachePut('master', fresh);
        return fresh;
      } catch (e) {
        if (cached) return cached.value;
        throw e;
      }
    },
    initialData: undefined,
    staleTime: 60 * 60 * 1000,
    gcTime: Infinity,
  });
}

/** Unsent grievances on this device, live. */
export function usePendingOutbox(userId: string | null): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const refresh = () => pendingItems(userId).then((x) => alive && setItems(x));
    refresh();
    const off = onOutboxChange(refresh);
    return () => { alive = false; off(); };
  }, [userId]);
  return items;
}

/**
 * Background sync triggers: app start, back online, app brought to the
 * foreground, and a timer while anything is waiting.
 */
export function useAutoSync(userId: string | null, onSynced?: (n: number) => void) {
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    const run = async (force = false) => {
      if (stopped || !navigator.onLine) return;
      const n = await syncOutbox(userId, { force });
      if (n > 0) onSynced?.(n);
    };
    run(true);
    pruneSynced(userId);
    // A phone that has just reconnected often fails the very first request, and a failed
    // try waits longer before the next one. So try again a few seconds after reconnecting.
    const retries: number[] = [];
    const onOnline = () => {
      run(true);
      retries.push(window.setTimeout(() => run(true), 3_000), window.setTimeout(() => run(true), 10_000));
    };
    const onVisible = () => document.visibilityState === 'visible' && run(true);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const t = window.setInterval(() => run(false), 20_000);
    return () => {
      stopped = true; window.removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t); retries.forEach((r) => clearTimeout(r));
    };
  }, [userId, onSynced]);
}

/** Cache-first query helper for member screens (works with no signal). */
export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<T>({
    queryKey: [key],
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval,
    queryFn: async () => {
      try {
        const v = await fetcher();
        await cachePut(key, v);
        return v;
      } catch (e) {
        const c = await cacheGet<T>(key);
        if (c) return c.value;
        throw e;
      }
    },
    networkMode: 'always',
    retry: (n, e) => n < 1 && (e as { key?: string })?.key !== 'not_found',
  });
}
