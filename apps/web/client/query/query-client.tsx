"use client";

import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type DehydratedState,
  type Query,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { recordHomeStartupCache } from "@/client/observability/perf-marks";
import type { HomeStartupCacheState } from "@/shared/observability/client-performance.contract";

export const ownerQueryCachePrefix = "home.query.v1:";
export const ownerQueryCacheTtlMs = 24 * 60 * 60 * 1000;
export const ownerQueryPersistThrottleMs = 250;
const forbiddenIdentityPattern = /authorization|bearer\s|eyj[a-z0-9_-]{10,}\./i;
const maxIdentityLength = 200;

type PersistedOwnerClient = {
  timestamp: number;
  buster: string;
  clientState: DehydratedState;
};

export type HomeQueryMeta = {
  persistence?: "memory" | "owner";
  ownerKey?: string;
};

export function isSafeQueryIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxIdentityLength &&
    !value.includes("\n") && !value.includes("\r") && !forbiddenIdentityPattern.test(value);
}

export function ownerQueryKey(ownerKey: string, scope: string, ...parts: readonly unknown[]): QueryKey {
  return [ownerKey, scope, ...parts];
}

export function publicQueryKey(scope: string, ...parts: readonly unknown[]): QueryKey {
  return ["unauthenticated", scope, ...parts];
}

export function ownerQueryMeta(ownerKey: string, persistence: "memory" | "owner" = "owner"): HomeQueryMeta {
  return { persistence, ownerKey };
}

export function shouldPersistOwnerQuery(query: Query, ownerKey: string, now = Date.now()): boolean {
  const meta = query.meta as HomeQueryMeta | undefined;
  return isSafeQueryIdentity(ownerKey) && meta?.persistence === "owner" && meta.ownerKey === ownerKey &&
    query.queryKey[0] === ownerKey && query.state.status === "success" &&
    now - query.state.dataUpdatedAt <= ownerQueryCacheTtlMs;
}

export function dehydrateOwnerQueries(
  queryClient: QueryClient,
  ownerKey: string,
  now = Date.now(),
): DehydratedState {
  return dehydrate(queryClient, {
    shouldDehydrateQuery: (query) => shouldPersistOwnerQuery(query, ownerKey, now),
  });
}

export function ownerQueryStorageKey(ownerKey: string): string | null {
  return isSafeQueryIdentity(ownerKey)
    ? `${ownerQueryCachePrefix}${encodeURIComponent(ownerKey)}`
    : null;
}

export function createOwnerQueryPersister(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ownerKey: string,
  throttleTime = ownerQueryPersistThrottleMs,
) {
  const key = ownerQueryStorageKey(ownerKey);
  if (!key) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedOwnerClient | null = null;
  const writePending = () => {
    timer = null;
    if (!pending) return;
    const value = pending;
    pending = null;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      // Persistence is a performance optimization; quota/private-mode failures fail open.
    }
  };
  return {
    persistClient(value: PersistedOwnerClient) {
      pending = value;
      if (timer === null) timer = setTimeout(writePending, throttleTime);
    },
    restoreClient(): PersistedOwnerClient | undefined {
      try {
        const value = storage.getItem(key);
        return value ? JSON.parse(value) as PersistedOwnerClient : undefined;
      } catch {
        storage.removeItem(key);
        return undefined;
      }
    },
    removeClient() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      storage.removeItem(key);
    },
    flush: writePending,
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

export function clearPersistedOwnerQueries(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
  preserveOwnerKey?: string,
): void {
  const preservedStorageKey = preserveOwnerKey ? ownerQueryStorageKey(preserveOwnerKey) : null;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(ownerQueryCachePrefix) && key !== preservedStorageKey) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function clearOwnerQueryBoundary(
  queryClient: QueryClient,
  storage?: Storage,
  preserveOwnerKey?: string,
): void {
  if (preserveOwnerKey) {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== preserveOwnerKey,
    });
  } else {
    queryClient.clear();
  }
  if (storage) clearPersistedOwnerQueries(storage, preserveOwnerKey);
}

export function clearOwnerQueryMemory(queryClient: QueryClient): void {
  queryClient.clear();
}

export function restoreOwnerQueries(
  queryClient: QueryClient,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ownerKey: string,
  now = Date.now(),
): boolean {
  const persister = createOwnerQueryPersister(storage, ownerKey);
  const persisted = persister?.restoreClient();
  persister?.cancel();
  if (!persisted || persisted.buster !== "home-query-v2" || now - persisted.timestamp > ownerQueryCacheTtlMs) {
    if (persisted) persister?.removeClient();
    return false;
  }
  // Defense in depth: hydrate only this owner's queries even if the blob was tampered with.
  const state = persisted.clientState;
  hydrate(queryClient, {
    ...state,
    queries: state.queries.filter((query) => query.queryKey[0] === ownerKey),
  });
  return true;
}

export function ownerRestoreCacheState(
  ownerKey: string | null,
  restored: boolean,
): HomeStartupCacheState {
  if (!ownerKey) return "unknown";
  return restored ? "restored" : "cold";
}

export function OwnerQueryPersistence({ ownerKey }: { ownerKey: string | null }) {
  const queryClient = useQueryClient(browserHomeQueryClient());
  useState(() => {
    const restored = Boolean(
      ownerKey && typeof window !== "undefined" &&
      restoreOwnerQueries(queryClient, window.localStorage, ownerKey),
    );
    recordHomeStartupCache(ownerRestoreCacheState(ownerKey, restored));
    return ownerKey;
  });
  useEffect(() => {
    if (!ownerKey || typeof window === "undefined") return;
    const persister = createOwnerQueryPersister(window.localStorage, ownerKey);
    if (!persister) return;
    const persist = () => persister.persistClient({
      timestamp: Date.now(),
      buster: "home-query-v2",
      clientState: dehydrateOwnerQueries(queryClient, ownerKey),
    });
    const unsubscribe = queryClient.getQueryCache().subscribe(persist);
    return () => {
      unsubscribe();
      persister.cancel();
    };
  }, [ownerKey, queryClient]);
  return null;
}

let sharedClient: QueryClient | null = null;

export function createHomeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export function browserHomeQueryClient(): QueryClient | undefined {
  return typeof window === "undefined" ? undefined : getHomeQueryClient();
}

export function getHomeQueryClient(): QueryClient {
  sharedClient ??= createHomeQueryClient();
  return sharedClient;
}

export function HomeQueryClientProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() =>
    typeof window === "undefined" ? createHomeQueryClient() : getHomeQueryClient(),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export const useHomeQuery: typeof useQuery = ((options: Parameters<typeof useQuery>[0]) =>
  useQuery(options, browserHomeQueryClient())) as typeof useQuery;

export const useHomeInfiniteQuery: typeof useInfiniteQuery = ((options: Parameters<typeof useInfiniteQuery>[0]) =>
  useInfiniteQuery(options, browserHomeQueryClient())) as typeof useInfiniteQuery;

export { useQueryClient as useHomeQueryClient } from "@tanstack/react-query";
