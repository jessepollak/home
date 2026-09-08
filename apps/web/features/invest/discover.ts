import {
  cryptoAssets,
  investAssets,
  stockAssets,
  type InvestAsset,
  type InvestAssetId,
} from "@/config/invest-assets";
import { unavailableMarketData, type MarketDataState } from "./invest-market";

export const MEME_PREVIEW_COUNT = 4;

export const discoverShelves = [
  {
    id: "stocks",
    title: "Stocks",
    category: "stock" as const,
    assets: stockAssets,
    previewAssetIds: ["nvdac", "metac", "aaplc", "googlc"],
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
  return extraAssets.find((asset) => asset.id === id) ?? assetById.get(id) ?? null;
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
  if (shelf.id === "memes") {
    return memeAssets.slice(0, MEME_PREVIEW_COUNT);
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

export function applyAssetIcon(
  asset: InvestAsset,
  icons: Readonly<Record<string, string | null>> = {},
): InvestAsset {
  const imageUrl = asset.imageUrl ?? icons[asset.id] ?? undefined;
  return imageUrl ? { ...asset, imageUrl } : asset;
}

export function isInvestAssetId(value: string): value is InvestAssetId {
  return assetById.has(value);
}
