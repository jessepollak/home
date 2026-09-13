// Route contract.
// GET /api/invest/discover

import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { assetKeyForErc20 } from "@/config/portfolio-assets";
import { resolveMarketPriceAssetIdentity } from "./market-price-history";
import { unavailableMarketData, type MarketDataState, type MarketSnapshot } from "@/shared/invest/invest-market";

export const INVEST_DISCOVER_VERSION = 1 as const;

export type InvestDiscoverStatus = "ready" | "empty" | "error" | "unavailable";
export type InvestDiscoverResponse = {
  version: typeof INVEST_DISCOVER_VERSION;
  provider: "codex";
  fetchedAt: string | null;
  icons: Readonly<Record<string, string | null>>;
  memes: {
    status: InvestDiscoverStatus;
    message?: string;
    assets: InvestAsset[];
    snapshots: MarketSnapshot[];
    nextOffset: number | null;
    exhausted: boolean;
  };
};
export type AssetMarkResolution = {
  images?: Readonly<Record<string, string | null>>;
  pending?: boolean;
};
export type MemePagination = {
  nextOffset: number | null;
  exhausted: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  autoLoadPaused: boolean;
  consecutiveEmptyPages: number;
};
export type InvestDiscoverState = {
  memeAssets: readonly InvestAsset[];
  memeStatus: InvestDiscoverStatus | "loading";
  memeMarket: MarketDataState;
  assetMarkResolution: AssetMarkResolution;
  memePagination: MemePagination;
};

const discoverEmptyPagination: MemePagination = {
  nextOffset: null, exhausted: true, loadingMore: false, loadMoreError: false,
  autoLoadPaused: false, consecutiveEmptyPages: 0,
};

export function parseDiscoverResponse(
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
      memePagination: { ...discoverEmptyPagination, ...pagination },
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
    memePagination: { ...discoverEmptyPagination, ...pagination },
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


function assetMarkResolutionFromDiscover({
  icons,
  memeAssets = [],
  pending = false,
}: {
  icons: Readonly<Record<string, string | null>>;
  memeAssets?: readonly InvestAsset[];
  pending?: boolean;
}): AssetMarkResolution {
  const images: Record<string, string | null> = {};
  const assetsById = new Map<string, InvestAsset>(
    [...investAssets, ...memeAssets].map((asset) => [asset.id, asset]),
  );
  for (const [assetId, imageUrl] of Object.entries(icons)) {
    const asset = assetsById.get(assetId);
    if (!asset) continue;
    images[assetKeyForErc20(asset.contractAddress)] = imageUrl?.trim() || null;
  }
  for (const asset of memeAssets) {
    if (asset.imageUrl === undefined) continue;
    images[assetKeyForErc20(asset.contractAddress)] = asset.imageUrl?.trim() || null;
  }
  return { images, pending };
}
