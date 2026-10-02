"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RegionId } from "@/config/regions";
import type { HomeBalancesPresentation } from "@/shared/balances/present";
import { browserHomeQueryClient, ownerQueryKey, subscribeOwnerQueryBoundary, useHomeQueryClient } from "@/client/query/query-client";
import { homeSummaryStorageKey, readHomeSummary, writeHomeSummary, syncHomeSummaryCookie } from "@/client/query/home-summary-cache";

import { clearHomeSummaryCookie } from "@/client/query/home-summary-cookie";
import { homeSummaryPresentation, type HomeSummaryRecord } from "@/shared/balances/home-summary";

function summaryStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }
function createSummaryStore(identity: string | null, initial: HomeBalancesPresentation | null) {
  let value: HomeBalancesPresentation | null = initial;
  const listeners = new Set<() => void>();
  return {
    identity,
    read: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    replace: (next: HomeBalancesPresentation | null) => { value = next; for (const listener of listeners) listener(); },
  };
}

export function useHomeSummary({ owner, region, enabled, presentation, updatedAt, pending, initialSummary = null }: {
  owner: string | null; region: RegionId; enabled: boolean; presentation: HomeBalancesPresentation; updatedAt: number; pending: boolean; initialSummary?: HomeSummaryRecord | null;
}): HomeBalancesPresentation {
  const client = useHomeQueryClient(browserHomeQueryClient());
  const identity = enabled && owner ? homeSummaryStorageKey(owner, region) : null;
  const [seed, setSeed] = useState({ identity, record: initialSummary });
  if (seed.identity !== identity) setSeed({ identity, record: null });
  const initial = seed.identity === identity ? seed.record : null;
  const store = useMemo(() => createSummaryStore(identity,
    identity && initial?.owner === owner && initial.region === region
      ? homeSummaryPresentation(initial) : null), [identity, initial, owner, region]);
  const cached = useSyncExternalStore(store.subscribe, store.read, store.read);
  const marked = useRef(false);
  useLayoutEffect(() => {
    if (!identity || !owner) return;
    const storage = summaryStorage();
    const local = storage ? readHomeSummary(storage, owner, region) : null;
    if (local && (local.cachedAt ?? 0) >= (store.read()?.cachedAt ?? 0)) store.replace(local);
    const stopBoundary = subscribeOwnerQueryBoundary(client, (preserved) => { if (preserved !== owner) { store.replace(null); } });
    const stopQuery = client.getQueryCache().subscribe((event) => {
      const key: unknown = event.query.queryKey;
      if (!Array.isArray(key)) return;
      if (key[0] !== owner || key[1] !== "balances" || key[2] !== region) return;
      if (event.type === "removed") { store.replace(null); }
      if (event.type === "updated" && event.action.type === "invalidate") {
        clearHomeSummaryCookie();
        try { storage?.removeItem(identity); } catch { return false; }
      }
    });
    return () => { stopBoundary(); stopQuery(); };
  }, [client, identity, owner, region, store]);
  useLayoutEffect(() => {
    if (!identity || !owner || pending || presentation.status !== "ready") return;
    const state = client.getQueryState(ownerQueryKey(owner, "balances", region));
    if (!state || state.status !== "success" || state.isInvalidated || state.dataUpdatedAt !== updatedAt) return;
    const storage = summaryStorage();
    if (storage) { writeHomeSummary(storage, owner, region, updatedAt, presentation); syncHomeSummaryCookie(storage, owner, region); }
    store.replace({ ...presentation, revalidating: true, cachedAt: updatedAt });
  }, [client, identity, owner, region, pending, presentation, updatedAt, store]);
  const displayed = cached && (presentation.status === "loading" || pending) ? cached : presentation;
  useLayoutEffect(() => {
    if (displayed.cachedAt !== undefined && !marked.current) {
      marked.current = true;
      performance.mark("balances:summary-painted");
    }
  }, [displayed.cachedAt]);
  return displayed;
}
