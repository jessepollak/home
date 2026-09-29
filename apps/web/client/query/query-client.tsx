"use client";

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type DehydratedState,
  type Query,
  type QueryKey,
  type QueryCacheNotifyEvent,
} from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { recordHomeStartupCache } from "@/client/observability/perf-marks";
import { recordHomeCachePersistence } from "@/client/observability/interaction-performance";
import type { HomeStartupCacheState } from "@/shared/observability/client-performance.contract";
import { OWNER_SESSION_RETENTION_MS } from "@/shared/account/session-types";
import type { OwnerQueryScope, PublicQueryScope, QueryScope } from "./query-scopes";
import { invalidateMutationScopes } from "./mutation-options";

export const ownerQueryCachePrefix = "home.query.v1:";
export const ownerQueryCacheTtlMs = OWNER_SESSION_RETENTION_MS;
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

export function ownerQueryKey(ownerKey: string, scope: OwnerQueryScope, ...parts: readonly unknown[]): QueryKey {
  return [ownerKey, scope, ...parts];
}

export function publicQueryKey(scope: PublicQueryScope, ...parts: readonly unknown[]): QueryKey {
  return ["unauthenticated", scope, ...parts];
}

export function disabledQueryKey(scope: QueryScope, ...parts: readonly unknown[]): QueryKey {
  return ["unauthenticated", `${scope}-disabled`, ...parts];
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
    shouldDehydrateMutation: () => false,
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
  onWrite?: (startedAt: number, durationMs: number) => void,
) {
  const key = ownerQueryStorageKey(ownerKey);
  if (!key) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedOwnerClient | (() => PersistedOwnerClient) | null = null;
  const writePending = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const value = pending;
    pending = null;
    const startedAt = performance.now();
    try {
      storage.setItem(key, JSON.stringify(typeof value === "function" ? value() : value));
    } catch { // oxlint-disable-line home/no-silent-catch -- persisted owner queries are a best-effort cache; quota or privacy failures cannot block the app
    } finally {
      try {
        onWrite?.(startedAt, performance.now() - startedAt);
      } catch {
        return undefined;
      }
    }
  };
  return {
    persistClient(value: PersistedOwnerClient | (() => PersistedOwnerClient)) {
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

const ownerPersistenceSubscriptions = new WeakMap<QueryClient, Set<{
  ownerKey: string;
  pause: () => void;
  resume: () => void;
}>>();

function affectsPersistedOwner(event: QueryCacheNotifyEvent, ownerKey: string): boolean {
  if (event.type !== "added" && event.type !== "removed" && event.type !== "updated") return false;
  const { query } = event;
  const meta = query.meta;
  if (meta?.persistence !== "owner" || meta.ownerKey !== ownerKey || query.queryKey[0] !== ownerKey) return false;
  if (event.type === "removed") return true;
  if (event.type === "added") return query.state.status === "success";
  switch (event.action.type) {
    case "success":
    case "error":
    case "invalidate":
      return true;
    case "setState":
      return Object.keys(event.action.state).some((key) => key !== "fetchStatus" && key !== "fetchMeta");
    default:
      return false;
  }
}

export function subscribeOwnerQueryPersistence(
  queryClient: QueryClient,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ownerKey: string,
  onWrite?: (startedAt: number, durationMs: number) => void,
) {
  const persister = createOwnerQueryPersister(storage, ownerKey, ownerQueryPersistThrottleMs, onWrite);
  if (!persister) return () => {};
  let paused = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (paused) return;
    if (event.type !== "removed" && queryClient.getQueryCache().get(event.query.queryHash) !== event.query) return;
    if (!affectsPersistedOwner(event, ownerKey)) return;
    persister.persistClient(() => ({
      timestamp: Date.now(),
      buster: "home-query-v3",
      clientState: dehydrateOwnerQueries(queryClient, ownerKey),
    }));
  });
  const subscriptions = ownerPersistenceSubscriptions.get(queryClient) ?? new Set();
  ownerPersistenceSubscriptions.set(queryClient, subscriptions);
  const subscription = {
    ownerKey,
    pause: () => {
      paused = true;
      persister.cancel();
    },
    resume: () => { paused = false; },
  };
  subscriptions.add(subscription);
  return () => {
    unsubscribe();
    persister.cancel();
    subscriptions.delete(subscription);
  };
}

function pauseOwnerPersistence(queryClient: QueryClient, clear: () => void, preserveOwnerKey?: string) {
  const subscriptions = [...ownerPersistenceSubscriptions.get(queryClient) ?? []]
    .filter((subscription) => subscription.ownerKey !== preserveOwnerKey);
  for (const subscription of subscriptions) subscription.pause();
  try {
    clear();
  } finally {
    for (const subscription of subscriptions) subscription.resume();
  }
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
  pauseOwnerPersistence(queryClient, () => {
    if (preserveOwnerKey) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== preserveOwnerKey,
      });
      queryClient.getMutationCache().clear();
    } else {
      queryClient.clear();
    }
    if (storage) clearPersistedOwnerQueries(storage, preserveOwnerKey);
  }, preserveOwnerKey);
}

export function clearOwnerQueryMemory(queryClient: QueryClient): void {
  pauseOwnerPersistence(queryClient, () => queryClient.clear());
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
  if (!persisted || persisted.buster !== "home-query-v3" || now - persisted.timestamp > ownerQueryCacheTtlMs) {
    if (persisted) persister?.removeClient();
    return false;
  }
  const state = persisted.clientState;
  const queries = state.queries.filter((query) =>
    query.queryKey[0] === ownerKey && now - query.state.dataUpdatedAt <= ownerQueryCacheTtlMs);
  if (queries.length === 0) {
    persister?.removeClient();
    return false;
  }
  hydrate(queryClient, { ...state, queries });
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
  useEffect(() => {
    if (!ownerKey || typeof window === "undefined") return;
    const restored = restoreOwnerQueries(queryClient, window.localStorage, ownerKey);
    recordHomeStartupCache(ownerRestoreCacheState(ownerKey, restored));
  }, [ownerKey, queryClient]);
  useEffect(() => {
    if (!ownerKey || typeof window === "undefined") return;
    return subscribeOwnerQueryPersistence(queryClient, window.localStorage, ownerKey, recordHomeCachePersistence);
  }, [ownerKey, queryClient]);
  return null;
}

let sharedClient: QueryClient | null = null;

export function createHomeQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, variables, _context, mutation, { client }) => {
        void invalidateMutationScopes(client, mutation.meta, variables);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false, networkMode: "always", gcTime: 0 },
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

export const useHomeMutation: typeof useMutation = ((options: Parameters<typeof useMutation>[0]) =>
  useMutation(options, browserHomeQueryClient())) as typeof useMutation;

export const useHomeInfiniteQuery: typeof useInfiniteQuery = ((options: Parameters<typeof useInfiniteQuery>[0]) =>
  useInfiniteQuery(options, browserHomeQueryClient())) as typeof useInfiniteQuery;

export { useQueryClient as useHomeQueryClient } from "@tanstack/react-query";
