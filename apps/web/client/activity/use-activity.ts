"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfiniteQueryObserver, infiniteQueryOptions, type InfiniteData, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  compareActivityTransferKeys,
  isVerifiedActivitySession,
  parseActivityPage,
} from "@/shared/activity/contract";
import { mergeActivityPages, sameActivityTransfer } from "@/shared/activity/pages";
import type {
  ActivityPage,
  ActivityState,
  ActivityTransfer,
  FetchActivity,
} from "./types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  browserHomeQueryClient,
  ownerQueryKey,
  ownerQueryMeta,
  useHomeInfiniteQuery,
  useHomeQuery,
  useHomeQueryClient,
} from "@/client/query/query-client";
import {
  activityWindowScope,
  advanceActivityWindowEnd,
  initialActivityWindowEnd,
  nextActivityWindowEnd,
} from "@/client/query/after-action";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { ResourceFailure } from "@/client/account/resource-failure";
import type { RegionId } from "@/config/regions";
import { presentationMoneyMetadata } from "@/shared/formatting";

export const activityStaleTimeMs = 10_000;
const activityRefreshExtraPages = 10;
export const activityContinuationBurstPages = 3;
export const activityContinuationYieldMs = 250;
export const activityValuationRetryDelaysMs = [15_000, 60_000, 180_000];
const activityContinuationRetryDelaysMs = [1_000, 3_000] as const;
export const activityFirstPageRetryDelaysMs = [500, 1_500] as const;

export type UseActivityResult = ActivityState & {
  retry: () => void;
  refresh: () => void;
  setSentinelVisible: (visible: boolean) => void;
  retryLoadMore: () => void;
};

export const activityOwnerKey = dataOwnerKey;

type ContinuationState = {
  visible: boolean;
  failed: boolean;
  running: boolean;
  scheduled: boolean;
  consumed: Set<string>;
  burst: number;
  retries: number;
  retryAt: number;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type ScheduleValuationRetry = (run: () => void, delayMs: number) => () => void;

type ValuationRetryState = {
  attempts: number;
  cancel: (() => void) | null;
  consumers: number;
};

const valuationRetries = new WeakMap<Query, ValuationRetryState>();

function scheduleValuationRetryTimeout(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

function valuationRetryState(query: Query): ValuationRetryState {
  let state = valuationRetries.get(query);
  if (!state) {
    state = { attempts: 0, cancel: null, consumers: 0 };
    valuationRetries.set(query, state);
  }
  return state;
}

function cancelValuationRetry(state: ValuationRetryState) {
  state.cancel?.();
  state.cancel = null;
}

type ContinuationCursor = {
  fetchNextPage: (options: { cancelRefetch: boolean }) => Promise<{
    data?: { pages: ActivityPage[]; pageParams: unknown[] };
    hasNextPage?: boolean;
    isError?: boolean;
    isFetchNextPageError?: boolean;
  }>;
  hasNextPage: boolean;
  nextCursor: string | null;
  pageParams: readonly unknown[];
  pageCount: number;
};

type ScopedFlag = {
  scope: string;
  value: boolean;
};

function isTransientActivityFailure(error: unknown): boolean {
  if (!(error instanceof ResourceFailure)) return false;
  const code = "code" in error ? error.code : undefined;
  if (code === "ACTIVITY_UNAUTHORIZED" || code === "ACTIVITY_INVALID_RESPONSE" ||
    code === "ACTIVITY_NOT_CONFIGURED") return false;
  return error.kind === "network" || (error.kind === "http" && (error.status === 429 ||
    (typeof error.status === "number" && error.status >= 500 && error.status <= 599)));
}

function waitForActivityRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function activityQueryOptions(input: {
  session: VerifiedAccountSession | null;
  ownerKey: string;
  windowEnd: string;
  currency: ReturnType<typeof presentationMoneyMetadata>["currency"];
  fetchActivity: FetchActivity;
  queryClient: QueryClient;
  previousPages?: readonly ActivityPage[];
}) {
  const { session, ownerKey, windowEnd, currency, fetchActivity, queryClient, previousPages } = input;
  return infiniteQueryOptions({
    queryKey: ownerQueryKey(ownerKey, "activity", windowEnd, currency),
    initialPageParam: null as string | null,
    staleTime: activityStaleTimeMs,
    retry: false,
    refetchOnWindowFocus: true,
    meta: session ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: async ({ pageParam, queryKey, signal }) => {
      if (!session) throw new Error("Activity is unavailable.");
      const requestedWindow = queryKey[2] as string;
      const requestedCurrency = queryKey[3] as typeof currency;
      const queryString = new URLSearchParams({
        to: requestedWindow,
        ...(pageParam ? { cursor: pageParam } : {}),
        currency: requestedCurrency,
      }).toString();
      const knownPages = [
        ...(queryClient.getQueryData<InfiniteData<ActivityPage>>(queryKey)?.pages ?? []),
        ...(previousPages ?? []),
      ];
      const hasHealthyHistory = knownPages.some((known) => known.onchainStatus !== "unavailable");
      const readPage = async () => {
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        const result = parseActivityPage(
          await fetchActivity(queryString, signal), session, requestedWindow, requestedCurrency,
        );
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        return result;
      };
      let page: ActivityPage;
      if (pageParam) {
        page = await readPage();
      } else {
        for (let attempt = 0; ; attempt += 1) {
          const result = await readPage().then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
          if (!result.ok) {
            if (signal.aborted || !isTransientActivityFailure(result.error) || attempt === activityFirstPageRetryDelaysMs.length) throw result.error;
          } else {
            page = result.value;
            if (page.onchainStatus !== "unavailable") break;
            if (attempt === activityFirstPageRetryDelaysMs.length) {
              if (hasHealthyHistory) throw new Error("Activity onchain history is unavailable.");
              break;
            }
          }
          await waitForActivityRetry(activityFirstPageRetryDelaysMs[attempt] ?? 0, signal);
        }
      }
      retainKnownValuations(page, knownPages);
      if (pageParam && page.nextCursor === pageParam) {
        throw new Error("Activity cursor did not advance.");
      }
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export async function refreshLatestActivity(input: {
  queryClient: QueryClient;
  ownerKey: string;
  session: VerifiedAccountSession;
  regionId: RegionId;
  fetchActivity: FetchActivity;
  isCurrent: () => boolean;
  onPrefetchKey: (key: QueryKey | null) => void;
}): Promise<void> {
  const { queryClient, ownerKey, session, regionId, fetchActivity, isCurrent, onPrefetchKey } = input;
  const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
  const windowEnd = queryClient.getQueryData<string>(windowKey) ?? initialActivityWindowEnd();
  const currency = presentationMoneyMetadata(regionId).currency;
  const currentKey = ownerQueryKey(ownerKey, "activity", windowEnd, currency);
  const current = queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey);
  const currentPages = current?.pages ?? [];
  if (!currentPages.length && queryClient.getQueryCache().findAll({ queryKey: currentKey, exact: true, type: "active" }).length === 0) return;
  const boundary = currentPages.length ? mergeActivityPages(currentPages).transfers.at(-1) : undefined;
  const nextEnd = nextActivityWindowEnd(windowEnd);
  const nextKey = ownerQueryKey(ownerKey, "activity", nextEnd, currency);
  const options = activityQueryOptions({ session, ownerKey, windowEnd: nextEnd, currency, fetchActivity, queryClient, previousPages: currentPages });
  onPrefetchKey(nextKey);
  try {
    let next: InfiniteData<ActivityPage> = await queryClient.fetchInfiniteQuery({
      ...options,
      pages: Math.max(1, currentPages.length),
      staleTime: 0,
    });
    if (!isCurrent()) return;
    if (boundary) {
      const reachedBoundary = (pages: ActivityPage[]) => {
        const transfers = mergeActivityPages(pages).transfers;
        return transfers.some((transfer) => transfer.id === boundary.id) ||
          (transfers.length > 0 && compareActivityTransferKeys(transfers.at(-1)!, boundary) <= 0);
      };
      const observer = new InfiniteQueryObserver(queryClient, options);
      while (!reachedBoundary(next.pages) && next.pages.at(-1)?.nextCursor) {
        if (next.pages.length >= currentPages.length + activityRefreshExtraPages) {
          throw new Error("Activity refresh did not reach the previous boundary.");
        }
        const result = await observer.fetchNextPage({ cancelRefetch: false, throwOnError: true });
        if (!isCurrent()) return;
        if (!result.data || result.isFetchNextPageError) throw new Error("Activity refresh page failed.");
        next = result.data;
      }
    }
    if (!isCurrent()) return;
    if (queryClient.getQueryData<string>(windowKey) !== windowEnd) {
      await queryClient.cancelQueries({ queryKey: nextKey, exact: true });
      queryClient.removeQueries({ queryKey: nextKey, exact: true });
      return;
    }
    queryClient.setQueryData(windowKey, nextEnd);
  } catch (error) {
    if (!isCurrent()) throw error;
    await queryClient.cancelQueries({ queryKey: nextKey, exact: true });
    queryClient.removeQueries({ queryKey: nextKey, exact: true });
    throw error;
  } finally {
    onPrefetchKey(null);
  }
}

export function useActivity(
  session: VerifiedAccountSession | null,
  fetchActivity: FetchActivity,
  regionId: RegionId = "GLOBAL",
  scheduleValuationRetry: ScheduleValuationRetry = scheduleValuationRetryTimeout,
): UseActivityResult {
  const currency = presentationMoneyMetadata(regionId).currency;
  const validSession = isVerifiedActivitySession(session) ? session : null;
  const ownerKey = validSession ? activityOwnerKey(validSession) : null;
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const windowQuery = useHomeQuery({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, activityWindowScope)
      : ["unauthenticated", "activity-window-disabled"],
    enabled: false,
    initialData: ownerKey ? initialActivityWindowEnd : "",
    staleTime: Infinity,
    gcTime: Infinity,
    meta: ownerKey ? ownerQueryMeta(ownerKey, "memory") : undefined,
    queryFn: async () => ownerKey ? initialActivityWindowEnd() : "",
  });
  const windowEnd = windowQuery.data ?? "";
  const activityQueryKey = useMemo(() => ownerKey
    ? ownerQueryKey(ownerKey, "activity", windowEnd, currency)
    : ["unauthenticated", "activity-disabled"], [ownerKey, windowEnd, currency]);

  const query = useHomeInfiniteQuery({
    ...activityQueryOptions({
      session: validSession, ownerKey: ownerKey ?? "unauthenticated", windowEnd, currency, fetchActivity, queryClient,
    }),
    queryKey: activityQueryKey,
    enabled: ownerKey !== null,
  });

  const mergedPage = useMemo(() => {
    const pages = query.data?.pages;
    if (!pages?.length) return null;
    return mergeActivityPages(pages);
  }, [query.data?.pages]);

  const continuationScope = `${ownerKey ?? "signed-out"}\u0000${windowEnd}\u0000${currency}`;
  const activityQuery = ownerKey
    ? queryClient.getQueryCache().find({ queryKey: activityQueryKey, exact: true })
    : undefined;
  const valuationReady = Boolean(ownerKey && query.isSuccess && !query.isFetching &&
    hasRecoverableUnpriced(query.data?.pages));
  useEffect(() => {
    if (!activityQuery) return;
    const state = valuationRetryState(activityQuery);
    state.consumers += 1;
    return () => {
      state.consumers -= 1;
      if (state.consumers === 0) cancelValuationRetry(state);
    };
  }, [activityQuery]);
  useEffect(() => {
    if (!activityQuery) return;
    const state = valuationRetryState(activityQuery);
    const readyNow = () => activityQuery.state.status === "success" &&
      activityQuery.state.fetchStatus !== "fetching" &&
      hasRecoverableUnpriced((activityQuery.state.data as { pages: ActivityPage[] } | undefined)?.pages);
    const sync = (ready: boolean) => {
      if (!ready || queryClient.getQueryCache().find({ queryKey: activityQueryKey, exact: true }) !== activityQuery) {
        cancelValuationRetry(state);
        return;
      }
      if (state.consumers === 0 || state.cancel || state.attempts >= activityValuationRetryDelaysMs.length) return;
      state.cancel = scheduleValuationRetry(() => {
        state.cancel = null;
        if (state.consumers === 0 ||
          queryClient.getQueryCache().find({ queryKey: activityQueryKey, exact: true }) !== activityQuery ||
          document.visibilityState === "hidden" || !readyNow()) return;
        state.attempts += 1;
        void queryClient.refetchQueries({ queryKey: activityQueryKey, exact: true }, { cancelRefetch: false });
      }, activityValuationRetryDelaysMs[state.attempts]);
    };
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query === activityQuery) sync(readyNow());
    });
    sync(valuationReady);
    return unsubscribe;
  }, [activityQuery, activityQueryKey, queryClient, scheduleValuationRetry, valuationReady]);

  const scopeRef = useRef(continuationScope);
  const [continuingFlag, setContinuingFlag] = useState<ScopedFlag>({
    scope: continuationScope,
    value: false,
  });
  const [failedFlag, setFailedFlag] = useState<ScopedFlag>({
    scope: continuationScope,
    value: false,
  });
  const continuing = continuingFlag.scope === continuationScope && continuingFlag.value;
  const loadMoreFailed = failedFlag.scope === continuationScope && failedFlag.value;
  const markContinuing = useCallback((value: boolean) => {
    setContinuingFlag({ scope: scopeRef.current, value });
  }, []);
  const markFailed = useCallback((value: boolean) => {
    setFailedFlag({ scope: scopeRef.current, value });
  }, []);

  const continuationRef = useRef<ContinuationState>({
    visible: false,
    failed: false,
    running: false,
    scheduled: false,
    consumed: new Set<string>(),
    burst: 0,
    retries: 0,
    generation: 0,
    retryAt: 0,
    timer: null,
  });
  const latestRef = useRef<ContinuationCursor>({
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    nextCursor: mergedPage?.nextCursor ?? null,
    pageParams: query.data?.pageParams ?? [],
    pageCount: query.data?.pages.length ?? 0,
  });
  const pumpRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    latestRef.current = {
      fetchNextPage: query.fetchNextPage,
      hasNextPage: query.hasNextPage,
      nextCursor: mergedPage?.nextCursor ?? null,
      pageParams: query.data?.pageParams ?? [],
      pageCount: query.data?.pages.length ?? 0,
    };
  });

  const schedule = useCallback((delayMs: number) => {
    const state = continuationRef.current;
    if (state.scheduled || state.running) return;
    state.scheduled = true;
    const generation = state.generation;
    state.timer = setTimeout(() => {
      const current = continuationRef.current;
      current.timer = null;
      current.scheduled = false;
      if (generation !== current.generation) return;
      void pumpRef.current();
    }, delayMs);
  }, []);

  const pump = useCallback(async () => {
    const state = continuationRef.current;
    if (state.running || state.failed || !state.visible || state.scheduled) return;
    const retryWaitMs = state.retryAt - Date.now();
    if (retryWaitMs > 0) {
      schedule(retryWaitMs);
      return;
    }
    const latest = latestRef.current;
    const cursor = latest.nextCursor;
    if (!latest.hasNextPage || !cursor) return;
    if (state.consumed.has(cursor) || latest.pageParams.includes(cursor)) {
      state.failed = true;
      markFailed(true);
      markContinuing(false);
      return;
    }
    if (state.burst >= activityContinuationBurstPages) {
      state.burst = 0;
      schedule(activityContinuationYieldMs);
      return;
    }
    const generation = state.generation;
    state.running = true;
    const result = await latest.fetchNextPage({ cancelRefetch: false });
    const current = continuationRef.current;
    if (generation !== current.generation) return;
    current.running = false;
    const data = result.data;
    const appended = !!data && data.pages.length > latest.pageCount && data.pageParams.at(-1) === cursor;
    if (result.isError || result.isFetchNextPageError) {
      if (current.retries >= activityContinuationRetryDelaysMs.length) {
        current.failed = true;
        markFailed(true);
        markContinuing(false);
      } else {
        const delay = activityContinuationRetryDelaysMs[current.retries]!;
        current.retries += 1;
        current.retryAt = Date.now() + delay;
        if (current.visible) schedule(delay);
      }
      return;
    }
    if (data) {
      const nextCursor = data.pages.at(-1)?.nextCursor ?? null;
      latestRef.current = {
        ...latestRef.current,
        hasNextPage: nextCursor !== null,
        nextCursor,
        pageParams: data.pageParams,
        pageCount: data.pages.length,
      };
      if (appended) {
        current.consumed.add(cursor);
        current.retries = 0;
        current.retryAt = 0;
        current.burst += 1;
        current.failed = false;
        markFailed(false);
        if (nextCursor !== null && (current.consumed.has(nextCursor) || data.pageParams.includes(nextCursor))) {
          current.failed = true;
          markFailed(true);
          markContinuing(false);
          return;
        }
      }
      markContinuing(nextCursor !== null && current.visible);
      if (nextCursor === null || !current.visible) return;
    }
    schedule(appended ? 0 : activityContinuationYieldMs);
  }, [markContinuing, markFailed, schedule]);
  useEffect(() => {
    pumpRef.current = pump;
  });

  useEffect(() => {
    const state = continuationRef.current;
    scopeRef.current = continuationScope;
    state.generation += 1;
    state.visible = false;
    state.failed = false;
    state.running = false;
    state.scheduled = false;
    state.consumed = new Set<string>();
    state.burst = 0;
    state.retries = 0;
    state.retryAt = 0;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    return () => {
      state.generation += 1;
      state.visible = false;
      state.failed = false;
      state.running = false;
      state.scheduled = false;
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    };
  }, [continuationScope]);

  const retry = useCallback(() => { void query.refetch(); }, [query]);
  const refresh = useCallback(() => {
    if (ownerKey) advanceActivityWindowEnd(queryClient, ownerKey);
    markFailed(false);
  }, [markFailed, ownerKey, queryClient]);
  const setSentinelVisible = useCallback((visible: boolean) => {
    const state = continuationRef.current;
    state.visible = visible;
    if (!visible) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      state.scheduled = false;
      state.burst = 0;
      markContinuing(false);
      return;
    }
    if (state.failed) return;
    if (!latestRef.current.hasNextPage) {
      markContinuing(false);
      return;
    }
    markContinuing(true);
    void pumpRef.current();
  }, [markContinuing]);
  const retryLoadMore = useCallback(() => {
    const state = continuationRef.current;
    state.failed = false;
    state.consumed = new Set<string>();
    state.burst = 0;
    state.retries = 0;
    state.retryAt = 0;
    state.visible = true;
    markFailed(false);
    markContinuing(true);
    void pumpRef.current();
  }, [markContinuing, markFailed]);

  if (!ownerKey) {
    return {
      status: "unavailable", page: null, loadingMore: false,
      loadMoreError: false, continuing: false,
      retry, refresh, setSentinelVisible, retryLoadMore,
    };
  }
  if (query.isPending) {
    return {
      status: "loading", page: null, loadingMore: false,
      loadMoreError: false, continuing: false,
      retry, refresh, setSentinelVisible, retryLoadMore,
    };
  }
  if (!mergedPage) {
    return {
      status: "error", page: null, loadingMore: false,
      loadMoreError: false, continuing: false,
      error: readActivityFailure(query.error),
      retry, refresh, setSentinelVisible, retryLoadMore,
    };
  }
  return {
    status: "ready",
    page: mergedPage,
    loadingMore: query.isFetchingNextPage,
    loadMoreError: loadMoreFailed,
    continuing,
    retry,
    refresh,
    setSentinelVisible,
    retryLoadMore,
  };
}

function hasRecoverableUnpriced(pages: readonly ActivityPage[] | undefined): boolean {
  if (!pages?.length) return false;
  const merged = mergeActivityPages([...pages]);
  return merged.transfers.some((transfer) => isRecoverableUnpriced(transfer, merged.window.to));
}

function isRecoverableUnpriced(transfer: ActivityTransfer, windowEnd: string): boolean {
  if (transfer.valuation.status !== "unpriced") return false;
  if (transfer.valuation.reason === "quote-unavailable" || transfer.valuation.reason === "fx-unavailable") return true;
  if (transfer.valuation.reason !== "no-recent-close") return false;
  const ageMs = Date.parse(windowEnd) - Date.parse(transfer.blockTimestamp);
  return ageMs >= 0 && ageMs <= 60 * 60_000;
}


function retainKnownValuations(page: ActivityPage, previousPages: readonly ActivityPage[]) {
  const known = new Map<string, ActivityTransfer>();
  for (const previous of previousPages) {
    if (previous.currency !== page.currency) continue;
    for (const transfer of previous.transfers) {
      if (transfer.valuation.status === "priced") known.set(transfer.id, transfer);
    }
  }
  if (known.size === 0) return;
  page.transfers = page.transfers.map((transfer) => {
    const previous = known.get(transfer.id);
    return previous &&
      transfer.valuation.status === "unpriced" &&
      transientUnpricedReasons.has(transfer.valuation.reason) &&
      sameActivityTransfer(previous, transfer)
      ? { ...transfer, valuation: previous.valuation }
      : transfer;
  });
}

const transientUnpricedReasons = new Set(["quote-unavailable", "fx-unavailable", "no-recent-close"]);

function readActivityFailure(reason: unknown): { code: string | null; message: string | null } {
  if (!reason || typeof reason !== "object") return { code: null, message: null };
  const code = "code" in reason && typeof reason.code === "string" && /^[A-Z][A-Z0-9_]{1,64}$/.test(reason.code)
    ? reason.code : null;
  const message = "serverMessage" in reason && typeof reason.serverMessage === "string" && reason.serverMessage.length <= 200
    ? reason.serverMessage : null;
  return { code, message };
}
