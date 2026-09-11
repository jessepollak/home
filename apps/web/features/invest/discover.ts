import {
  cryptoAssets,
  investAssets,
  stockAssets,
  type InvestAsset,
  type InvestAssetId,
} from "@/config/invest-assets";
import { matchesMarketPriceAssetIdentity } from "@/server/market-data/codex/history-contract";
import { unavailableMarketData, type MarketDataState } from "./invest-market";

export const STOCK_PREVIEW_COUNT = 6;
export const MEME_PREVIEW_COUNT = 4;

export const discoverShelves = [
  {
    id: "stocks",
    title: "Stocks",
    category: "stock" as const,
    assets: stockAssets,
    previewCount: STOCK_PREVIEW_COUNT,
  },
  {
    id: "crypto",
    title: "Crypto",
    category: "crypto" as const,
    assets: cryptoAssets,
    previewAssetIds: ["cbbtc", "cbxrp", "cbdoge", "cbltc"],
  },
  {
    id: "memes",
    title: "Memes",
    category: "meme" as const,
    assets: [] as readonly InvestAsset[],
    previewAssetIds: [] as readonly string[],
  },
] as const;

export type DiscoverShelfId = (typeof discoverShelves)[number]["id"];
export type MemeShelfStatus = "ready" | "empty" | "error" | "unavailable" | "loading";

const assetById = new Map<string, InvestAsset>(
  investAssets.map((asset) => [asset.id, asset]),
);
const shelfById = new Map(discoverShelves.map((shelf) => [shelf.id, shelf]));

export function getDiscoverShelf(id: string) {
  return shelfById.get(id as DiscoverShelfId) ?? null;
}

export function getDiscoverAsset(
  id: string,
  extraAssets: readonly InvestAsset[] = [],
) {
  return (
    extraAssets.find(
      (asset) => asset.id === id && matchesMarketPriceAssetIdentity(asset),
    ) ??
    assetById.get(id) ??
    null
  );
}

export function getShelfAssets(
  shelf: (typeof discoverShelves)[number],
  memeAssets: readonly InvestAsset[] = [],
): readonly InvestAsset[] {
  return shelf.id === "memes" ? memeAssets : shelf.assets;
}

export function getShelfPreviewAssets(
  shelf: (typeof discoverShelves)[number],
  memeAssets: readonly InvestAsset[] = [],
): readonly InvestAsset[] {
  const assets = getShelfAssets(shelf, memeAssets);
  if (shelf.id === "memes") {
    return assets.slice(0, MEME_PREVIEW_COUNT);
  }
  if ("previewCount" in shelf) {
    return assets.slice(0, shelf.previewCount);
  }
  return shelf.previewAssetIds.flatMap((assetId) => {
    const asset = assetById.get(assetId);
    return asset ? [asset] : [];
  });
}

export function marketForAsset(
  asset: InvestAsset,
  markets: {
    stockMarket: MarketDataState;
    memeMarket: MarketDataState;
    cryptoMarket?: MarketDataState;
  },
) {
  if (asset.category === "stock") return markets.stockMarket;
  if (asset.category === "meme") return markets.memeMarket;
  return markets.cryptoMarket ?? unavailableMarketData;
}

export function isInvestAssetId(value: string): value is InvestAssetId {
  return assetById.has(value);
}
