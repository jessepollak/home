"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  compareActivityTransferKeys,
  isVerifiedActivitySession,
  parseActivityPage,
} from "./parse";
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

export const activityStaleTimeMs = 10_000;

export type UseActivityResult = ActivityState & {
  retry: () => void;
  refresh: () => void;
  loadMore: () => void;
  retryLoadMore: () => void;
};

export const activityOwnerKey = dataOwnerKey;

export function useActivity(
  session: VerifiedAccountSession | null,
  fetchActivity: FetchActivity,
): UseActivityResult {
  const validSession = isVerifiedActivitySession(session) ? session : null;
  const ownerKey = validSession ? activityOwnerKey(validSession) : null;
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const requestedCursorsRef = useRef(new Map<string, Set<string>>());
  const loadMoreInFlightRef = useRef(false);
  const [autoLoadPaused, setAutoLoadPaused] = useState(false);
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
      ? ownerQueryKey(ownerKey, "activity", windowEnd)
      : ["unauthenticated", "activity-disabled"],
    enabled: ownerKey !== null,
    initialPageParam: null as string | null,
    staleTime: activityStaleTimeMs,
    retry: false,
    refetchOnWindowFocus: true,
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (!expectedSession) throw new Error("Activity is unavailable.");
      const queryString = new URLSearchParams({
        to: windowEnd,
        ...(pageParam ? { cursor: pageParam } : {}),
      }).toString();
      const page = parseActivityPage(
        await fetchActivity(queryString, signal),
        expectedSession,
        windowEnd,
      );
      if (ownerKey && pageParam) {
        // Cursors are deterministic per window; a new window restarts the set.
        const cursorScope = `${ownerKey}\u0000${windowEnd}`;
        const requested = requestedCursorsRef.current.get(cursorScope) ?? new Set<string>();
        requested.add(pageParam);
        requestedCursorsRef.current.set(cursorScope, requested);
        if (page.nextCursor && requested.has(page.nextCursor)) {
          throw new Error("Activity cursor did not advance.");
        }
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

  const retry = useCallback(() => { void query.refetch(); }, [query]);
  const refresh = useCallback(() => {
    if (ownerKey) advanceActivityWindowEnd(queryClient, ownerKey);
    setAutoLoadPaused(false);
  }, [ownerKey, queryClient, setAutoLoadPaused]);
  const requestMore = useCallback(async () => {
    if (!query.hasNextPage || query.isFetchingNextPage || loadMoreInFlightRef.current || autoLoadPaused) return;
    loadMoreInFlightRef.current = true;
    try {
      const previousCount = mergedPage?.transfers.length ?? 0;
      const result = await query.fetchNextPage({ cancelRefetch: false });
      const next = result.data ? mergeActivityPages(result.data.pages) : null;
      if (next?.nextCursor && (next.transfers.length ?? 0) === previousCount) {
        setAutoLoadPaused(true);
      }
    } finally {
      loadMoreInFlightRef.current = false;
    }
  }, [autoLoadPaused, mergedPage?.transfers.length, query]);
  const retryLoadMore = useCallback(() => {
    if (loadMoreInFlightRef.current) return;
    setAutoLoadPaused(false);
    loadMoreInFlightRef.current = true;
    void query.fetchNextPage({ cancelRefetch: false }).finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, [query, setAutoLoadPaused]);

  if (!ownerKey) {
    return {
      status: "unavailable", page: null, loadingMore: false,
      loadMoreError: false, autoLoadPaused: false,
      retry, refresh, loadMore: requestMore, retryLoadMore,
    };
  }
  if (query.isPending) {
    return {
      status: "loading", page: null, loadingMore: false,
      loadMoreError: false, autoLoadPaused: false,
      retry, refresh, loadMore: requestMore, retryLoadMore,
    };
  }
  if (!mergedPage) {
    return {
      status: "error", page: null, loadingMore: false,
      loadMoreError: false, autoLoadPaused: false,
      error: readActivityFailure(query.error),
      retry, refresh, loadMore: requestMore, retryLoadMore,
    };
  }
  return {
    status: "ready",
    page: mergedPage,
    loadingMore: query.isFetchingNextPage,
    loadMoreError: query.isFetchNextPageError,
    autoLoadPaused,
    retry,
    refresh,
    loadMore: requestMore,
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
  return JSON.stringify(left) === JSON.stringify(right);
}

function readActivityFailure(reason: unknown): { code: string | null; message: string | null } {
  if (!reason || typeof reason !== "object") return { code: null, message: null };
  const code = "code" in reason && typeof reason.code === "string" && /^[A-Z][A-Z0-9_]{1,64}$/.test(reason.code)
    ? reason.code : null;
  const message = "serverMessage" in reason && typeof reason.serverMessage === "string" && reason.serverMessage.length <= 200
    ? reason.serverMessage : null;
  return { code, message };
}
