"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InvestAsset } from "@/config/invest-assets";
import { INVEST_DISCOVER_VERSION } from "@/server/market-data/invest-discover-contract";
import { resolveMarketPriceAssetIdentity } from "@/server/market-data/codex/history-contract";
import { unavailableMarketData, type MarketDataState } from "./invest-market";
import type { MemeShelfStatus } from "./discover";

const DISCOVER_ENDPOINT = "/api/invest/discover";
const VISIBILITY_REFRESH_COOLDOWN_MS = 60_000;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type InvestDiscoverState = {
  memeAssets: readonly InvestAsset[];
  memeStatus: MemeShelfStatus;
  memeMarket: MarketDataState;
  assetIcons: Readonly<Record<string, string | null>>;
};

export type UseInvestDiscoverOptions = {
  endpoint?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshCooldownMs?: number;
};

const emptyIcons = {} as const;

export function useInvestDiscover({
  endpoint = DISCOVER_ENDPOINT,
  fetchImpl = fetch,
  now = Date.now,
  refreshCooldownMs = VISIBILITY_REFRESH_COOLDOWN_MS,
}: UseInvestDiscoverOptions = {}): InvestDiscoverState {
  const [state, setState] = useState<InvestDiscoverState>({
    memeAssets: [],
    memeStatus: "loading",
    memeMarket: { status: "loading" },
    assetIcons: emptyIcons,
  });
  const requestController = useRef<AbortController | null>(null);
  const lastRequestAt = useRef(Number.NEGATIVE_INFINITY);

  const refresh = useCallback(async () => {
    const requestTime = now();
    if (requestTime - lastRequestAt.current < refreshCooldownMs) return;
    lastRequestAt.current = requestTime;
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
      setState(payload);
    } catch {
      if (controller.signal.aborted) return;
      setState({
        memeAssets: [],
        memeStatus: "error",
        memeMarket: {
          status: "error",
          message: "Trending memes are unavailable.",
        },
        assetIcons: emptyIcons,
      });
    }
  }, [endpoint, fetchImpl, now, refreshCooldownMs]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestController.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  return useMemo(() => state, [state]);
}

function parseDiscoverResponse(value: unknown): InvestDiscoverState | null {
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
      assetIcons: icons,
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
    assetIcons: icons,
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
