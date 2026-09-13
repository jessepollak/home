"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import {
  browserHomeQueryClient,
  publicQueryKey,
  useHomeInfiniteQuery,
  useHomeQueryClient,
} from "@/client/query/query-client";
import type { InvestAsset } from "@/config/invest-assets";
import { parseDiscoverResponse, type InvestDiscoverState } from "@/shared/invest/contracts/discover";
import type { MemePagination } from "./discover";

const DISCOVER_ENDPOINT = "/api/invest/discover";
const VISIBILITY_REFRESH_COOLDOWN_MS = 60_000;
/** Bound consecutive provider pages that normalize away before we stop. */
const MAX_CONSECUTIVE_EMPTY_PAGES = 3;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type UseInvestDiscoverResult = InvestDiscoverState & {
  loadMoreMemes: () => void;
  retryLoadMoreMemes: () => void;
};

export type UseInvestDiscoverOptions = {
  endpoint?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshCooldownMs?: number;
};

const emptyIcons = {} as const;

const emptyPagination: MemePagination = {
  nextOffset: null,
  exhausted: true,
  loadingMore: false,
  loadMoreError: false,
  autoLoadPaused: false,
  consecutiveEmptyPages: 0,
};

const initialDiscoverState: InvestDiscoverState = {
  memeAssets: [],
  memeStatus: "loading",
  memeMarket: { status: "loading" },
  assetMarkResolution: { images: emptyIcons, pending: true },
  memePagination: emptyPagination,
};

const errorDiscoverState: InvestDiscoverState = {
  memeAssets: [],
  memeStatus: "error",
  memeMarket: {
    status: "error",
    message: "Trending memes are unavailable.",
  },
  assetMarkResolution: { images: emptyIcons, pending: false },
  memePagination: emptyPagination,
};

export function useInvestDiscover({
  endpoint = DISCOVER_ENDPOINT,
  fetchImpl = fetch,
  refreshCooldownMs = VISIBILITY_REFRESH_COOLDOWN_MS,
}: UseInvestDiscoverOptions = {}): UseInvestDiscoverResult {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const loadMoreInFlightRef = useRef(false);
  const [manualLoadState, setManualLoadState] = useState<"idle" | "loading" | "error">("idle");
  const queryKey = publicQueryKey("invest-discover", endpoint);
  const fetchPage = useCallback(async (pageParam: number | null, signal: AbortSignal) => {
    const queryString = pageParam === null ? "" : new URLSearchParams({ offset: String(pageParam) }).toString();
    const url = !queryString ? endpoint : endpoint.includes("?") ? `${endpoint}&${queryString}` : `${endpoint}?${queryString}`;
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error("Discover page request failed.");
    const payload = parseDiscoverResponse(await response.json());
    if (!payload) throw new Error("Invalid invest discover response");
    if (pageParam !== null && (payload.memeStatus === "error" || payload.memeStatus === "unavailable")) {
      throw new Error("Discover page provider failed.");
    }
    return payload;
  }, [endpoint, fetchImpl]);
  const query = useHomeInfiniteQuery({
    queryKey,
    initialPageParam: null as number | null,
    staleTime: refreshCooldownMs,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    getNextPageParam: (page) => page.memePagination.nextOffset ?? undefined,
  });
  const state = useMemo(() => {
    const pages = query.data?.pages;
    if (!pages?.length) return query.isError ? errorDiscoverState : initialDiscoverState;
    return pages.slice(1).reduce(mergeDiscoverPages, pages[0]!);
  }, [query.data?.pages, query.isError]);
  const visibleState: InvestDiscoverState = {
    ...state,
    memePagination: {
      ...state.memePagination,
      loadingMore: query.isFetchingNextPage || manualLoadState === "loading",
      loadMoreError: query.isFetchNextPageError || manualLoadState === "error",
    },
  };
  const requestNextPage = useCallback(() => {
    const nextOffset = visibleState.memePagination.nextOffset;
    if (nextOffset === null || visibleState.memePagination.exhausted || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    setManualLoadState("loading");
    if (query.isFetching) void queryClient.cancelQueries({ queryKey, exact: true });
    void fetchPage(nextOffset, new AbortController().signal).then((page) => {
      queryClient.setQueryData<InfiniteData<InvestDiscoverState>>(queryKey, (current) => current
        ? {
            pages: [...current.pages, page],
            pageParams: [...current.pageParams, nextOffset],
          }
        : current);
      setManualLoadState("idle");
    }).catch(() => {
      setManualLoadState("error");
    }).finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, [fetchPage, query.isFetching, queryClient, queryKey, visibleState.memePagination.exhausted, visibleState.memePagination.nextOffset]);
  const loadMoreMemes = useCallback(() => {
    if (visibleState.memePagination.autoLoadPaused) return;
    requestNextPage();
  }, [requestNextPage, visibleState.memePagination.autoLoadPaused]);
  const retryLoadMoreMemes = useCallback(() => {
    setManualLoadState("idle");
    requestNextPage();
  }, [requestNextPage]);
  return { ...visibleState, loadMoreMemes, retryLoadMoreMemes };
}

function mergeDiscoverPages(
  previous: InvestDiscoverState,
  next: InvestDiscoverState,
): InvestDiscoverState {
  const seenAddresses = new Set(
    previous.memeAssets.map((asset) => asset.contractAddress.toLowerCase()),
  );
  const newAssets: InvestAsset[] = [];
  for (const asset of next.memeAssets) {
    const key = asset.contractAddress.toLowerCase();
    if (seenAddresses.has(key)) continue;
    seenAddresses.add(key);
    newAssets.push(asset);
  }
  const assets = [...previous.memeAssets, ...newAssets];
  const emptyFullPage = !next.memePagination.exhausted && newAssets.length === 0;

  const seenSnapshots = new Set(
    previous.memeMarket.status === "ready"
      ? previous.memeMarket.snapshots.map((snapshot) => snapshot.assetId)
      : [],
  );
  const previousSnapshots =
    previous.memeMarket.status === "ready" ? previous.memeMarket.snapshots : [];
  const nextSnapshots =
    next.memeMarket.status === "ready" ? next.memeMarket.snapshots : [];
  const snapshots = [
    ...previousSnapshots,
    ...nextSnapshots.filter((snapshot) => !seenSnapshots.has(snapshot.assetId)),
  ];

  const previousImages = previous.assetMarkResolution.images ?? {};
  const nextImages = next.assetMarkResolution.images ?? {};

  return {
    memeAssets: assets,
    memeStatus: assets.length > 0 ? "ready" : "empty",
    memeMarket: { status: "ready", snapshots },
    assetMarkResolution: {
      images: { ...previousImages, ...nextImages },
      pending: Boolean(
        previous.assetMarkResolution.pending || next.assetMarkResolution.pending,
      ),
    },
    memePagination: {
      nextOffset: next.memePagination.nextOffset,
      exhausted: next.memePagination.exhausted,
      loadingMore: false,
      loadMoreError: false,
      consecutiveEmptyPages: emptyFullPage
        ? previous.memePagination.consecutiveEmptyPages + 1
        : 0,
      autoLoadPaused:
        emptyFullPage &&
        previous.memePagination.consecutiveEmptyPages + 1 >=
          MAX_CONSECUTIVE_EMPTY_PAGES,
    },
  };
}
