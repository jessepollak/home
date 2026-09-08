import {
  cryptoAssets,
  investAssets,
  memeAssets,
  stockAssets,
  type InvestAsset,
  type InvestAssetId,
} from "@/config/invest-assets";
import { unavailableMarketData, type MarketDataState } from "./invest-market";

export const discoverShelves = [
  {
    id: "stocks",
    title: "Stocks",
    assets: stockAssets,
    previewAssetIds: ["nvdac", "metac", "aaplc", "googlc"],
  },
  {
    id: "crypto",
    title: "Crypto",
    assets: cryptoAssets,
    previewAssetIds: ["cbbtc", "cbxrp", "cbdoge", "cbltc"],
  },
  {
    id: "memes",
    title: "Memes",
    assets: memeAssets,
    previewAssetIds: ["degen", "toshi"],
  },
] as const;

export type DiscoverShelfId = (typeof discoverShelves)[number]["id"];

const assetById = new Map<string, InvestAsset>(
  investAssets.map((asset) => [asset.id, asset]),
);
const shelfById = new Map(discoverShelves.map((shelf) => [shelf.id, shelf]));

export function getDiscoverShelf(id: string) {
  return shelfById.get(id as DiscoverShelfId) ?? null;
}

export function getDiscoverAsset(id: string) {
  return assetById.get(id) ?? null;
}

export function getShelfPreviewAssets(
  shelf: (typeof discoverShelves)[number],
): readonly InvestAsset[] {
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
