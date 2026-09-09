import {
  BASE_CHAIN_ID,
  investAssets,
  type InvestAssetId,
} from "@/config/invest-assets";

export const MARKET_PRICE_HISTORY_VERSION = 1 as const;
export const MARKET_PRICE_RANGES = ["1D", "1W", "1M", "3M", "1Y"] as const;

export type MarketPriceRange = (typeof MARKET_PRICE_RANGES)[number];

export type DynamicMarketPriceAssetId = `base:0x${string}`;
export type MarketPriceAssetId = InvestAssetId | DynamicMarketPriceAssetId;

export type MarketPriceAssetIdentity = {
  assetId: MarketPriceAssetId;
  chainId: typeof BASE_CHAIN_ID;
  contractAddress: `0x${string}`;
};

export type MarketPriceHistoryPoint = {
  time: string;
  value: string;
};

export type MarketPriceHistoryResponse = {
  version: typeof MARKET_PRICE_HISTORY_VERSION;
  provider: "codex";
  assetId: MarketPriceAssetId | null;
  range: MarketPriceRange | null;
  currency: "USD";
  fetchedAt: string | null;
  status: "ready" | "empty" | "unavailable" | "error";
  points: readonly MarketPriceHistoryPoint[];
  unavailableReason?:
    | "not-configured"
    | "unknown-asset"
    | "invalid-range"
    | "overloaded";
};

const configuredAssetById = new Map<string, MarketPriceAssetIdentity>(
  investAssets.map((asset) => [
    asset.id,
    {
      assetId: asset.id,
      chainId: asset.chainId,
      contractAddress: asset.contractAddress,
    },
  ]),
);
const configuredAssetIdsByAddress = new Map(
  investAssets.map((asset) => [asset.contractAddress.toLowerCase(), asset.id]),
);
const dynamicBaseAssetPattern = /^base:(0x[0-9a-f]{40})$/;

/**
 * Resolves read-only market-data identity only. Dynamic IDs must be canonical,
 * lowercase Base contract IDs and cannot alias a configured static asset.
 */
export function resolveMarketPriceAssetIdentity(
  value: string,
): MarketPriceAssetIdentity | null {
  const configured = configuredAssetById.get(value);
  if (configured) return configured;

  const dynamic = dynamicBaseAssetPattern.exec(value);
  const contractAddress = dynamic?.[1];
  if (!contractAddress || configuredAssetIdsByAddress.has(contractAddress)) {
    return null;
  }

  return {
    assetId: value as DynamicMarketPriceAssetId,
    chainId: BASE_CHAIN_ID,
    contractAddress: contractAddress as `0x${string}`,
  };
}

export function isDynamicMarketPriceAssetId(
  value: MarketPriceAssetId,
): value is DynamicMarketPriceAssetId {
  return dynamicBaseAssetPattern.test(value);
}

export function matchesMarketPriceAssetIdentity(asset: {
  id: string;
  chainId: number;
  contractAddress: string;
}): boolean {
  const identity = resolveMarketPriceAssetIdentity(asset.id);
  return Boolean(
    identity &&
      identity.chainId === asset.chainId &&
      identity.contractAddress.toLowerCase() === asset.contractAddress.toLowerCase(),
  );
}

export function isMarketPriceRange(value: string): value is MarketPriceRange {
  return (MARKET_PRICE_RANGES as readonly string[]).includes(value);
}
