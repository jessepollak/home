"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { RegionId } from "@/config/regions";
import { homeSummaryStorageKey, readHomeRateLabels, writeHomeRateLabels, type HomeRateLabels, type HomeRateObservation } from "@/client/query/home-summary-cache";
import { browserHomeQueryClient, subscribeOwnerQueryBoundary, useHomeQueryClient } from "@/client/query/query-client";

function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }
function createStore(identity: string | null) {
  let labels: HomeRateLabels = {};
  let active = true;
  const listeners = new Set<() => void>();
  return {
    identity,
    read: () => labels,
    active: () => active,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    replace: (next: HomeRateLabels) => {
      if (JSON.stringify(labels) === JSON.stringify(next)) return;
      labels = next;
      for (const listener of listeners) listener();
    },
    clear: () => { active = false; labels = {}; for (const listener of listeners) listener(); },
  };
}

export function useHomeRateLabels({ owner, region, cash, borrow }: {
  owner: string | null; region: RegionId; cash: HomeRateObservation; borrow: HomeRateObservation;
}): { cash: string | null; borrow: string | null } {
  const client = useHomeQueryClient(browserHomeQueryClient());
  const identity = owner ? homeSummaryStorageKey(owner, region) : null;
  const store = useMemo(() => createStore(identity), [identity]);
  const cached = useSyncExternalStore(store.subscribe, store.read, store.read);
  useLayoutEffect(() => {
    if (!owner) return;
    const cache = storage();
    store.replace(cache ? readHomeRateLabels(cache, owner, region) : {});
    const stopBoundary = subscribeOwnerQueryBoundary(client, (preserved) => { if (preserved !== owner) store.clear(); });
    const stopQuery = client.getQueryCache().subscribe((event) => {
      const key: unknown = event.query.queryKey;
      if (!Array.isArray(key)) return;
      if (event.type === "removed" && key[0] === owner && key[1] === "balances" && key[2] === region) store.clear();
    });
    return () => { stopBoundary(); stopQuery(); };
  }, [client, owner, region, store]);
  useLayoutEffect(() => {
    if (!owner || !store.active()) return;
    const next = { ...store.read() };
    if (!cash.pending) next.cash = { value: cash.value, updatedAt: cash.updatedAt };
    if (!borrow.pending) next.borrow = { value: borrow.value, updatedAt: borrow.updatedAt };
    const cache = storage();
    if (cache) {
      const persisted = readHomeRateLabels(cache, owner, region);
      if (JSON.stringify(persisted) !== JSON.stringify(next)) writeHomeRateLabels(cache, owner, region, next);
    }
    store.replace(next);
  }, [borrow.pending, borrow.updatedAt, borrow.value, cached, cash.pending, cash.updatedAt, cash.value, owner, region, store]);
  if (!owner || !store.active()) return { cash: null, borrow: null };
  return { cash: cash.pending ? cached.cash?.value ?? null : cash.value, borrow: borrow.pending ? cached.borrow?.value ?? null : borrow.value };
}
