"use client";

import { clearHomeSummaryCookie } from "./home-summary-cookie";

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hashKey,
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
import { recordRestoredBalance } from "@/client/observability/balance-performance";
import { recordHomeStartupCache } from "@/client/observability/perf-marks";
import { recordHomeCachePersistence } from "@/client/observability/interaction-performance";
import type { HomeStartupCacheState } from "@/shared/observability/client-performance.contract";
import { OWNER_SESSION_RETENTION_MS } from "@/shared/account/session-types";
import { isRecord } from "@/shared/guards";
import type { OwnerQueryScope, PublicQueryScope, QueryScope } from "./query-scopes";
import { invalidateMutationScopes } from "./mutation-options";
import { queryScopes } from "./scopes";
import type { QueryScopePolicy } from "./scopes/policy";
import { decodeOwnerCache, encodeOwnerCache, isCompressedOwnerCache, ownerCacheCompressionThreshold } from "./owner-cache-codec";
import { clearBrowserIndexedOwnerCache, openIndexedOwnerCache } from "./indexed-owner-cache";

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
  const scope = query.queryKey[1];
  const policy = typeof scope === "string" ? scopePolicies[scope] : undefined;
  return isSafeQueryIdentity(ownerKey) && policy?.audience === "owner" && policy.persistence === "owner" &&
    meta?.persistence === "owner" && meta.ownerKey === ownerKey && query.queryKey[0] === ownerKey &&
    query.state.status === "success" && now - query.state.dataUpdatedAt <= ownerQueryCacheTtlMs;
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

function removePersistedQuietly(storage: Pick<Storage, "removeItem">, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
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
  let revision = 0;
  let restoredValue: string | null = null;
  const reportWrite = (startedAt: number) => {
    try {
      onWrite?.(startedAt, performance.now() - startedAt);
    } catch {
      return undefined;
    }
  };
  const writePending = async () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const value = pending;
    pending = null;
    const writeRevision = revision;
    let startedAt = performance.now();
    try {
      const previous = storage.getItem(key);
      const serialized = JSON.stringify(typeof value === "function" ? value() : value);
      let encoded = serialized;
      if (serialized.length >= ownerCacheCompressionThreshold && typeof CompressionStream !== "undefined") {
        reportWrite(startedAt);
        try {
          encoded = await encodeOwnerCache(serialized);
        } finally {
          startedAt = performance.now();
        }
      }
      if (revision === writeRevision && storage.getItem(key) === previous) storage.setItem(key, encoded);
    } catch { // oxlint-disable-line home/no-silent-catch -- persisted owner queries are a best-effort cache; quota or privacy failures cannot block the app
    } finally {
      reportWrite(startedAt);
    }
  };
  return {
    persistClient(value: PersistedOwnerClient | (() => PersistedOwnerClient)) {
      revision += 1;
      pending = value;
      if (timer === null) timer = setTimeout(() => { void writePending(); }, throttleTime);
    },
    restoreClient(): unknown {
      try {
        const value = storage.getItem(key);
        if (value && isCompressedOwnerCache(value)) return undefined;
        return value ? JSON.parse(value) : undefined;
      } catch {
        removePersistedQuietly(storage, key);
        return undefined;
      }
    },
    async restoreClientAsync(): Promise<unknown> {
      let value: string | null = null;
      try {
        value = storage.getItem(key);
        restoredValue = value;
        if (!value) return undefined;
        const decoded: unknown = JSON.parse(await decodeOwnerCache(value));
        return storage.getItem(key) === value ? decoded : undefined;
      } catch {
        try {
          if (storage.getItem(key) === value) removePersistedQuietly(storage, key);
        } catch {
          return undefined;
        }
        return undefined;
      }
    },
    isRestoreCurrent(): boolean {
      try {
        return storage.getItem(key) === restoredValue;
      } catch {
        return false;
      }
    },
    removeClient() {
      revision += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      return removePersistedQuietly(storage, key);
    },
    flush: writePending,
    cancel() {
      revision += 1;
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
      buster: "home-query-v4",
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
    if (key?.startsWith(ownerQueryCachePrefix) && key !== preservedStorageKey &&
      !(preservedStorageKey && key.startsWith(`${preservedStorageKey}:home-summary:`))) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function clearOwnerQueryBoundary(
  queryClient: QueryClient,
  storage?: Storage,
  preserveOwnerKey?: string,
): void {
  if (!preserveOwnerKey) clearHomeSummaryCookie();
  ownerRestoreRevisions.set(queryClient, (ownerRestoreRevisions.get(queryClient) ?? 0) + 1);
  for (const listener of boundaryListeners.get(queryClient) ?? []) listener(preserveOwnerKey);
  clearBrowserIndexedOwnerCache(preserveOwnerKey);
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
  ownerRestoreRevisions.set(queryClient, (ownerRestoreRevisions.get(queryClient) ?? 0) + 1);
  for (const listener of boundaryListeners.get(queryClient) ?? []) listener();
  pauseOwnerPersistence(queryClient, () => queryClient.clear());
}

type TrustedRestoredQuery = {
  queryKey: QueryKey;
  queryHash: string;
  meta?: Record<string, unknown>;
  data: unknown;
  dataUpdatedAt: number;
  isInvalidated: boolean;
};

const scopePolicies: Partial<Record<string, QueryScopePolicy>> = queryScopes;
const ownerRestoreRevisions = new WeakMap<QueryClient, number>();
const boundaryListeners = new WeakMap<QueryClient, Set<(preserveOwner?: string) => void>>();

export function subscribeOwnerQueryBoundary(queryClient: QueryClient, listener: (preserveOwner?: string) => void) {
  const listeners = boundaryListeners.get(queryClient) ?? new Set();
  boundaryListeners.set(queryClient, listeners);
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function trustedRestoredQuery(query: unknown, ownerKey: string, now = Date.now()): TrustedRestoredQuery | null {
  if (!isRecord(query)) return null;
  const { queryKey, state } = query;
  if (!Array.isArray(queryKey) || queryKey[0] !== ownerKey || typeof queryKey[1] !== "string" ||
    typeof query.queryHash !== "string" || query.promise !== undefined ||
    (query.meta !== undefined && !isRecord(query.meta)) ||
    !isRecord(state) || state.status !== "success" ||
    typeof state.dataUpdatedAt !== "number" || !Number.isFinite(state.dataUpdatedAt) ||
    state.dataUpdatedAt <= 0 || state.dataUpdatedAt > now || state.data === undefined ||
    now - state.dataUpdatedAt > ownerQueryCacheTtlMs) return null;
  const policy = scopePolicies[queryKey[1]];
  if (!policy || policy.audience !== "owner" || policy.persistence !== "owner") return null;
  const trusted = policy.validateRestored(state.data, { ownerKey, queryKey });
  if (!trusted) return null;
  return {
    queryKey,
    queryHash: hashKey(queryKey),
    ...(query.meta ? { meta: query.meta } : {}),
    data: trusted.data,
    dataUpdatedAt: state.dataUpdatedAt,
    isInvalidated: state.isInvalidated === true,
  };
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
  return hydrateOwnerClient(queryClient, persister, persisted, now, ownerKey);
}

export async function restoreOwnerQueriesAsync(
  queryClient: QueryClient,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ownerKey: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (isCurrent() && restoreOwnerQueries(queryClient, storage, ownerKey)) return true;
  const revision = ownerRestoreRevisions.get(queryClient);
  const persister = createOwnerQueryPersister(storage, ownerKey);
  const persisted = await persister?.restoreClientAsync();
  persister?.cancel();
  if (!isCurrent() || ownerRestoreRevisions.get(queryClient) !== revision || !persister?.isRestoreCurrent()) return false;
  return hydrateOwnerClient(queryClient, persister, persisted, Date.now(), ownerKey);
}

function hydrateOwnerClient(
  queryClient: QueryClient,
  persister: ReturnType<typeof createOwnerQueryPersister>,
  persisted: unknown,
  now: number,
  ownerKey: string,
): boolean {
  if (!isRecord(persisted) || persisted.buster !== "home-query-v4" || typeof persisted.timestamp !== "number" ||
    !Number.isFinite(persisted.timestamp) || now - persisted.timestamp > ownerQueryCacheTtlMs) {
    if (persisted) persister?.removeClient();
    return false;
  }
  const persistedState: unknown = persisted.clientState;
  if (!isRecord(persistedState) || !Array.isArray(persistedState.queries)) {
    persister?.removeClient();
    return false;
  }
  const queries = persistedState.queries
    .map((query) => trustedRestoredQuery(query, ownerKey, now))
    .filter((query): query is TrustedRestoredQuery => query !== null)
    .map((query): DehydratedState["queries"][number] => ({
      queryKey: query.queryKey,
      queryHash: query.queryHash,
      ...(query.meta ? { meta: query.meta } : {}),
      state: {
        data: query.data,
        dataUpdatedAt: query.dataUpdatedAt,
        dataUpdateCount: 0,
        error: null,
        errorUpdatedAt: 0,
        errorUpdateCount: 0,
        fetchFailureCount: 0,
        fetchFailureReason: null,
        fetchMeta: null,
        isInvalidated: query.isInvalidated,
        status: "success",
        fetchStatus: "idle",
      },
    }));
  if (queries.length === 0) {
    persister?.removeClient();
    return false;
  }
  hydrate(queryClient, { mutations: [], queries });
  for (const query of queries) {
    if (query.queryKey[1] === "balances" && typeof query.state.data === "object" && query.state.data !== null &&
      queryClient.getQueryData(query.queryKey) === query.state.data) {
      recordRestoredBalance(query.state.data);
    }
  }
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
    let current = true;
    let stop: (() => void) | undefined;
    const revision = ownerRestoreRevisions.get(queryClient);
    const isCurrent = () => current && ownerRestoreRevisions.get(queryClient) === revision;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void startIndexedOwnerPersistence(queryClient, ownerKey, () => current, isCurrent).then((cleanup) => {
          if (current) stop = cleanup;
          else cleanup();
        });
      });
    });
    return () => { current = false; cancelAnimationFrame(frame); stop?.(); };
  }, [ownerKey, queryClient]);
  return null;
}

function browserOwnerStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

async function startIndexedOwnerPersistence(queryClient: QueryClient, ownerKey: string, alive: () => boolean, restoreCurrent: () => boolean) {
  const storage = browserOwnerStorage();
  const storageKey = ownerQueryStorageKey(ownerKey);
  try {
    let cache = await openIndexedOwnerCache(ownerKey);
    if (!alive()) return () => {};
    let legacy: string | null = null;
    try { legacy = storageKey ? storage?.getItem(storageKey) ?? null : null; } catch { legacy = null; }
    const value = cache.value ?? legacy;
    let restored = false;
    if (value) {
      try {
        const decoded: unknown = JSON.parse(await decodeOwnerCache(value));
        if (restoreCurrent() && await cache.isCurrent(cache.value) && restoreCurrent() &&
          (cache.value !== null || storageKey && storage?.getItem(storageKey) === legacy)) {
          restored = hydrateOwnerClient(queryClient, null, decoded, Date.now(), ownerKey);
          if (!restored && cache.value) await cache.remove(cache.value);
        }
      } catch { restored = false; }
    }
    if (!alive()) return () => {};
    recordHomeStartupCache(ownerRestoreCacheState(ownerKey, restored));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let writeRevision = 0;
    let paused = false;
    let renewLease = false;
    const valid = (revision: number) => alive() && !paused && revision === writeRevision;
    const persist = async (revision: number): Promise<boolean> => {
      try {
        if (renewLease) { cache = await openIndexedOwnerCache(ownerKey); renewLease = false; }
        if (!valid(revision)) return false;
        const startedAt = performance.now();
        const savedAt = Date.now();
        const serialized = JSON.stringify({ timestamp: savedAt, buster: "home-query-v4", clientState: dehydrateOwnerQueries(queryClient, ownerKey, savedAt) });
        recordHomeCachePersistence(startedAt, performance.now() - startedAt);
        const encoded = await encodeOwnerCache(serialized);
        const committed = await cache.write(encoded, savedAt, () => valid(revision));
        if (committed && storageKey && legacy !== null && storage?.getItem(storageKey) === legacy) storage.removeItem(storageKey);
        return committed;
      } catch { return false; }
    };
    const queue = () => {
      writeRevision += 1;
      if (timer === null) timer = setTimeout(() => { timer = null; void persist(writeRevision); }, ownerQueryPersistThrottleMs);
    };
    const cancel = () => { writeRevision += 1; if (timer !== null) clearTimeout(timer); timer = null; };
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (paused || event.type !== "removed" && queryClient.getQueryCache().get(event.query.queryHash) !== event.query) return;
      if (affectsPersistedOwner(event, ownerKey)) queue();
    });
    const subscriptions = ownerPersistenceSubscriptions.get(queryClient) ?? new Set();
    ownerPersistenceSubscriptions.set(queryClient, subscriptions);
    const subscription = { ownerKey, pause: () => { paused = true; cancel(); }, resume: () => { paused = false; renewLease = true; } };
    subscriptions.add(subscription);
    if (restoreCurrent()) queue();
    return () => { cancel(); unsubscribe(); subscriptions.delete(subscription); };
  } catch {
    if (storage && alive()) {
      const restored = await restoreOwnerQueriesAsync(queryClient, storage, ownerKey, restoreCurrent);
      if (alive()) {
        recordHomeStartupCache(ownerRestoreCacheState(ownerKey, restored));
        return subscribeOwnerQueryPersistence(queryClient, storage, ownerKey, recordHomeCachePersistence);
      }
    }
    return () => {};
  }
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
