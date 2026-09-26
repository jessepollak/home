"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Query } from "@tanstack/react-query";
import {
  compareActivityTransferKeys,
  isVerifiedActivitySession,
  parseActivityPage,
} from "@/shared/activity/contract";
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
} from "@/client/query/after-action";
import { dataOwnerKey } from "@/client/account/owner-keys";
import type { RegionId } from "@/config/regions";
import { presentationMoneyMetadata } from "@/shared/formatting";

export const activityStaleTimeMs = 10_000;
export const activityContinuationBurstPages = 3;
export const activityContinuationYieldMs = 250;
export const activityValuationRetryDelaysMs = [15_000, 60_000, 180_000];
const activityContinuationRetryDelaysMs = [1_000, 3_000] as const;

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
  const expectedSession = validSession;
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
    queryKey: activityQueryKey,
    enabled: ownerKey !== null,
    initialPageParam: null as string | null,
    staleTime: activityStaleTimeMs,
    retry: false,
    refetchOnWindowFocus: true,
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: async ({ pageParam, queryKey, signal }) => {
      if (!expectedSession) throw new Error("Activity is unavailable.");
      const queryString = new URLSearchParams({
        to: windowEnd,
        ...(pageParam ? { cursor: pageParam } : {}),
        currency,
      }).toString();
      const page = parseActivityPage(
        await fetchActivity(queryString, signal),
        expectedSession,
        windowEnd,
        currency,
      );
      retainKnownValuations(
        page,
        queryClient.getQueryData<{ pages: ActivityPage[] }>(queryKey)?.pages ?? [],
      );
      if (pageParam && page.nextCursor === pageParam) {
        throw new Error("Activity cursor did not advance.");
      }
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
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

function mergeActivityPages(pages: ActivityPage[]): ActivityPage {
  const first = pages[0];
  if (!first) throw new Error("Activity page is missing.");
  const transfers: ActivityTransfer[] = [];
  const seen = new Map<string, ActivityTransfer>();
  let previous: ActivityTransfer | undefined;
  for (const page of pages) {
    if (page.window.to !== first.window.to) throw new Error("Activity window changed.");
    for (const transfer of page.transfers) {
      const existing = seen.get(transfer.id);
      if (existing) {
        if (!sameActivityTransfer(existing, transfer)) throw new Error("Activity overlap changed.");
        if (existing.valuation.status !== "priced" && transfer.valuation.status === "priced") {
          const index = transfers.indexOf(existing);
          transfers[index] = transfer;
          seen.set(transfer.id, transfer);
        }
        continue;
      }
      if (previous && compareActivityTransferKeys(previous, transfer) <= 0) {
        throw new Error("Activity page order did not advance.");
      }
      seen.set(transfer.id, transfer);
      transfers.push(transfer);
      previous = transfer;
    }
  }
  const last = pages.at(-1) ?? first;
  return {
    ...first,
    transfers,
    nextCursor: last.nextCursor,
  };
}

function sameActivityTransfer(left: ActivityTransfer, right: ActivityTransfer): boolean {
  return JSON.stringify(withoutValuation(left)) === JSON.stringify(withoutValuation(right));
}

function withoutValuation(transfer: ActivityTransfer): Omit<ActivityTransfer, "valuation"> {
  const { valuation, ...rest } = transfer;
  void valuation;
  return rest;
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
