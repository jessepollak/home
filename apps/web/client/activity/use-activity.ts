"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type ContinuationCursor = {
  fetchNextPage: (options: { cancelRefetch: boolean }) => Promise<{
    data?: { pages: ActivityPage[] };
    hasNextPage?: boolean;
    isError?: boolean;
    isFetchNextPageError?: boolean;
  }>;
  hasNextPage: boolean;
  nextCursor: string | null;
};

type ScopedFlag = {
  scope: string;
  value: boolean;
};

export function useActivity(
  session: VerifiedAccountSession | null,
  fetchActivity: FetchActivity,
  regionId: RegionId = "GLOBAL",
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

  const query = useHomeInfiniteQuery({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "activity", windowEnd, currency)
      : ["unauthenticated", "activity-disabled"],
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
    generation: 0,
    timer: null,
  });
  const latestRef = useRef<ContinuationCursor>({
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    nextCursor: mergedPage?.nextCursor ?? null,
  });
  const pumpRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    latestRef.current = {
      fetchNextPage: query.fetchNextPage,
      hasNextPage: query.hasNextPage,
      nextCursor: mergedPage?.nextCursor ?? null,
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
    if (state.running || state.failed || !state.visible) return;
    const latest = latestRef.current;
    const cursor = latest.nextCursor;
    if (!latest.hasNextPage || !cursor) return;
    if (state.consumed.has(cursor)) {
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
    current.running = false;
    if (generation !== current.generation) return;
    if (result.isError || result.isFetchNextPageError) {
      current.failed = true;
      markFailed(true);
      markContinuing(false);
      return;
    }
    const nextCursor = result.data?.pages.at(-1)?.nextCursor ?? null;
    latestRef.current = {
      ...latestRef.current,
      hasNextPage: nextCursor !== null,
      nextCursor,
    };
    current.consumed.add(cursor);
    current.burst += 1;
    markContinuing(nextCursor !== null && current.visible);
    if (nextCursor === null || !current.visible) return;
    schedule(0);
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
    state.visible = true;
    markFailed(false);
    markContinuing(true);
    void pumpRef.current();
  }, [markContinuing, markFailed]);

  const readError = loadMoreFailed || query.isFetchNextPageError;
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
    loadMoreError: readError,
    continuing,
    retry,
    refresh,
    setSentinelVisible,
    retryLoadMore,
  };
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

const transientUnpricedReasons = new Set(["quote-unavailable", "fx-unavailable"]);

function readActivityFailure(reason: unknown): { code: string | null; message: string | null } {
  if (!reason || typeof reason !== "object") return { code: null, message: null };
  const code = "code" in reason && typeof reason.code === "string" && /^[A-Z][A-Z0-9_]{1,64}$/.test(reason.code)
    ? reason.code : null;
  const message = "serverMessage" in reason && typeof reason.serverMessage === "string" && reason.serverMessage.length <= 200
    ? reason.serverMessage : null;
  return { code, message };
}
