"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type LoadMoreRequest = {
  sequence: number;
  offset: number;
  controller: AbortController;
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
  now = Date.now,
  refreshCooldownMs = VISIBILITY_REFRESH_COOLDOWN_MS,
}: UseInvestDiscoverOptions = {}): UseInvestDiscoverResult {
  const [state, setState] = useState<InvestDiscoverState>(initialDiscoverState);
  const sequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const loadMoreRequest = useRef<LoadMoreRequest | null>(null);
  const attemptedOffsets = useRef(new Set<number>());
  const hasLoadedMore = useRef(false);
  const lastRequestAt = useRef(Number.NEGATIVE_INFINITY);

  const refresh = useCallback(async () => {
    // Once the user has paged, a background refresh would slice rows off the
    // top and desynchronize the loaded catalog. Keep the loaded content.
    if (hasLoadedMore.current) return;
    const requestTime = now();
    if (requestTime - lastRequestAt.current < refreshCooldownMs) return;
    lastRequestAt.current = requestTime;

    const requestSequence = ++sequence.current;
    loadMoreRequest.current?.controller.abort();
    loadMoreRequest.current = null;
    attemptedOffsets.current = new Set();
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;

    try {
      const response = await fetchImpl(endpoint, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = parseDiscoverResponse(await response.json());
      if (!payload) throw new Error("Invalid invest discover response");
      if (controller.signal.aborted || sequence.current !== requestSequence) {
        return;
      }
      setState(payload);
    } catch {
      if (controller.signal.aborted || sequence.current !== requestSequence) {
        return;
      }
      setState(errorDiscoverState);
    }
  }, [endpoint, fetchImpl, now, refreshCooldownMs]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestController.current?.abort();
      loadMoreRequest.current?.controller.abort();
      loadMoreRequest.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  const requestMore = useCallback(
    (manualRetry: boolean) => {
      const pagination = state.memePagination;
      const offset = pagination.nextOffset;
      // A non-null next offset on a successful initial load is the gate. Empty
      // catalog pages (zero normalized assets) must still be advanceable.
      if (
        offset === null ||
        pagination.exhausted ||
        pagination.loadingMore ||
        loadMoreRequest.current ||
        (!manualRetry && pagination.autoLoadPaused) ||
        (!manualRetry && attemptedOffsets.current.has(offset))
      ) {
        return;
      }

      // Claim ownership before any fetch: abort a background visibility
      // refresh and advance the sequence so a late refresh result cannot
      // overwrite appended rows or strand this attempted offset.
      hasLoadedMore.current = true;
      requestController.current?.abort();
      requestController.current = null;
      const requestSequence = ++sequence.current;

      const controller = new AbortController();
      const request: LoadMoreRequest = { sequence: requestSequence, offset, controller };
      loadMoreRequest.current = request;
      attemptedOffsets.current.add(offset);
      setState((current) =>
        current.memePagination.nextOffset === offset &&
        !current.memePagination.loadingMore
          ? {
              ...current,
              memePagination: {
                ...current.memePagination,
                loadingMore: true,
                loadMoreError: false,
              },
            }
          : current,
      );

      const query = new URLSearchParams({ offset: String(offset) }).toString();
      const url = endpoint.includes("?")
        ? `${endpoint}&${query}`
        : `${endpoint}?${query}`;

      void (async () => {
        try {
          const response = await fetchImpl(url, {
            headers: { accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!isCurrentLoadMoreRequest(loadMoreRequest.current, request, sequence.current)) {
            return;
          }
          if (!response.ok) {
            throw new Error("Discover page request failed.");
          }
          const next = parseDiscoverResponse(await response.json());
          if (!next) throw new Error("Invalid invest discover page");
          if (
            next.memeStatus === "error" ||
            next.memeStatus === "unavailable"
          ) {
            throw new Error("Discover page is unavailable.");
          }
          if (next.memePagination.nextOffset === offset) {
            throw new Error("Discover offset did not advance.");
          }
          setState((current) => {
            if (
              current.memePagination.nextOffset !== offset ||
              !current.memePagination.loadingMore
            ) {
              return current;
            }
            return mergeDiscoverPages(current, next);
          });
        } catch {
          if (!isCurrentLoadMoreRequest(loadMoreRequest.current, request, sequence.current)) {
            return;
          }
          setState((current) =>
            current.memePagination.nextOffset === offset
              ? {
                  ...current,
                  memePagination: {
                    ...current.memePagination,
                    loadingMore: false,
                    loadMoreError: true,
                  },
                }
              : current,
          );
        } finally {
          if (loadMoreRequest.current === request) {
            loadMoreRequest.current = null;
          }
        }
      })();
    },
    [endpoint, fetchImpl, state],
  );

  const loadMoreMemes = useCallback(() => requestMore(false), [requestMore]);
  const retryLoadMoreMemes = useCallback(() => requestMore(true), [requestMore]);

  return { ...state, loadMoreMemes, retryLoadMoreMemes };
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

function isCurrentLoadMoreRequest(
  current: LoadMoreRequest | null,
  expected: LoadMoreRequest,
  sequence: number,
): boolean {
  return (
    current === expected &&
    !expected.controller.signal.aborted &&
    expected.sequence === sequence
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
