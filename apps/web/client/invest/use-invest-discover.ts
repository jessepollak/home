"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { deploymentHeaders } from "@/client/query/deployment-headers";
import {
  browserHomeQueryClient,
  publicQueryKey,
  useHomeInfiniteQuery,
  useHomeQueryClient,
} from "@/client/query/query-client";
import type { InvestAsset } from "@/config/invest-assets";
import {
  assetMarkResolutionFromDiscover,
  type AssetMarkResolution,
} from "@/client/asset-mark/presentation";
import { INVEST_DISCOVER_VERSION } from "@/shared/invest/invest-discover-contract";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/history-contract";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import type { MemePagination, MemeShelfStatus } from "./discover";

const DISCOVER_ENDPOINT = "/api/invest/discover";
const VISIBILITY_REFRESH_COOLDOWN_MS = 60_000;
/** Bound consecutive provider pages that normalize away before we stop. */
const MAX_CONSECUTIVE_EMPTY_PAGES = 3;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type InvestDiscoverState = {
  memeAssets: readonly InvestAsset[];
  memeStatus: MemeShelfStatus;
  memeMarket: MarketDataState;
  assetMarkResolution: AssetMarkResolution;
  memePagination: MemePagination;
};

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
      headers: { ...deploymentHeaders(), accept: "application/json" },
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

function parseDiscoverResponse(
  value: unknown,
): InvestDiscoverState | null {
  const record = readRecord(value);
  if (
    !record ||
    record.version !== INVEST_DISCOVER_VERSION ||
    record.provider !== "codex"
  ) {
    return null;
  }

  const icons = parseIconMap(record.icons);
  const memes = readRecord(record.memes);
  if (!icons || !memes || typeof memes.status !== "string") return null;
  if (
    memes.status !== "ready" &&
    memes.status !== "empty" &&
    memes.status !== "error" &&
    memes.status !== "unavailable"
  ) {
    return null;
  }

  const pagination = parsePagination(memes);
  if (!pagination) return null;

  if (memes.status !== "ready") {
    return {
      memeAssets: [],
      memeStatus: memes.status,
      memeMarket:
        memes.status === "error"
          ? { status: "error", message: "Trending memes are unavailable." }
          : memes.status === "unavailable"
            ? unavailableMarketData
            : { status: "ready", snapshots: [] },
      assetMarkResolution: assetMarkResolutionFromDiscover({ icons }),
      memePagination: { ...emptyPagination, ...pagination },
    };
  }

  if (!Array.isArray(memes.assets) || !Array.isArray(memes.snapshots)) {
    return null;
  }

  const assets: InvestAsset[] = [];
  for (const item of memes.assets) {
    const asset = parseInvestAsset(item);
    if (!asset) return null;
    assets.push(asset);
  }

  const assetIds = new Set(assets.map((asset) => asset.id));
  const snapshots = [];
  for (const item of memes.snapshots) {
    const snapshot = readRecord(item);
    if (
      !snapshot ||
      typeof snapshot.assetId !== "string" ||
      !assetIds.has(snapshot.assetId) ||
      typeof snapshot.displayPrice !== "string" ||
      snapshot.displayPrice.length === 0 ||
      typeof snapshot.asOf !== "string" ||
      typeof snapshot.sourceLabel !== "string"
    ) {
      return null;
    }
    snapshots.push({
      assetId: snapshot.assetId,
      displayPrice: snapshot.displayPrice,
      asOf: snapshot.asOf,
      sourceLabel: snapshot.sourceLabel,
      ...(typeof snapshot.sourceUrl === "string"
        ? { sourceUrl: snapshot.sourceUrl }
        : {}),
      ...(typeof snapshot.changeLabel === "string"
        ? { changeLabel: snapshot.changeLabel }
        : {}),
    });
  }

  return {
    memeAssets: assets,
    memeStatus: assets.length > 0 ? "ready" : "empty",
    memeMarket: { status: "ready", snapshots },
    assetMarkResolution: assetMarkResolutionFromDiscover({
      icons,
      memeAssets: assets,
    }),
    memePagination: { ...emptyPagination, ...pagination },
  };
}

function parsePagination(
  memes: Record<string, unknown>,
): { nextOffset: number | null; exhausted: boolean } | null {
  const exhausted = memes.exhausted;
  if (typeof exhausted !== "boolean") return null;
  if (exhausted) {
    if (memes.nextOffset !== null) return null;
    return { nextOffset: null, exhausted: true };
  }
  const nextOffset = memes.nextOffset;
  if (
    typeof nextOffset !== "number" ||
    !Number.isSafeInteger(nextOffset) ||
    nextOffset < 0
  ) {
    return null;
  }
  return { nextOffset, exhausted: false };
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

function parseInvestAsset(value: unknown): InvestAsset | null {
  const record = readRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    record.category !== "meme" ||
    typeof record.displayName !== "string" ||
    typeof record.displaySymbol !== "string" ||
    typeof record.initials !== "string" ||
    record.chainId !== 8453 ||
    typeof record.contractAddress !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(record.contractAddress) ||
    record.availability !== "informational" ||
    typeof record.descriptor !== "string" ||
    typeof record.contractUrl !== "string"
  ) {
    return null;
  }

  const representation = readRecord(record.representation);
  const identity = resolveMarketPriceAssetIdentity(record.id);
  if (
    !representation ||
    typeof representation.tokenSymbol !== "string" ||
    !identity ||
    identity.chainId !== record.chainId ||
    identity.contractAddress.toLowerCase() !== record.contractAddress.toLowerCase()
  ) {
    return null;
  }

  return {
    id: record.id,
    category: "meme",
    displayName: record.displayName,
    displaySymbol: record.displaySymbol,
    initials: record.initials,
    chainId: 8453,
    contractAddress: record.contractAddress as `0x${string}`,
    availability: "informational",
    descriptor: record.descriptor,
    representation: {
      tokenSymbol: representation.tokenSymbol,
      ...(typeof representation.decimals === "number"
        ? { decimals: representation.decimals }
        : {}),
      ...(typeof representation.relationship === "string"
        ? { relationship: representation.relationship }
        : { relationship: "Base ERC-20 token." }),
    },
    contractUrl: record.contractUrl,
    ...(typeof record.imageUrl === "string" ? { imageUrl: record.imageUrl } : {}),
    ...(typeof record.projectUrl === "string" ? { projectUrl: record.projectUrl } : {}),
  };
}

function parseIconMap(value: unknown): Record<string, string | null> | null {
  const record = readRecord(value);
  if (!record) return null;
  const icons: Record<string, string | null> = {};
  for (const [id, imageUrl] of Object.entries(record)) {
    if (imageUrl !== null && typeof imageUrl !== "string") return null;
    icons[id] = imageUrl;
  }
  return icons;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
