import { investAssets, isDiscoverableAsset, type InvestAsset } from "@/config/invest-assets";
import { matchesMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import { INVEST_SETTINGS_DEFAULTS, isInvestAssetVisible, isInvestCategoryVisible, type InvestSettings } from "@/shared/operator-settings/invest";

export const STOCK_PREVIEW_COUNT = 6;
export const MEME_PREVIEW_COUNT = 4;

export function createDiscoverShelves(assets: readonly InvestAsset[]) {
  return [
    { id: "stocks" as const, title: "Stocks", category: "stock" as const, assets: assets.filter((asset) => asset.category === "stock" && isDiscoverableAsset(asset)), previewCount: STOCK_PREVIEW_COUNT },
    { id: "crypto" as const, title: "Crypto", category: "crypto" as const, assets: assets.filter((asset) => asset.category === "crypto" && isDiscoverableAsset(asset)), previewAssetIds: ["cbbtc", "cbxrp", "cbdoge", "cbltc"] },
    { id: "memes" as const, title: "Memes", category: "meme" as const, assets: [] as readonly InvestAsset[], previewAssetIds: [] as readonly string[] },
  ] as const;
}
export const discoverShelves = createDiscoverShelves(investAssets);

export type DiscoverShelfId = (typeof discoverShelves)[number]["id"];
export type MemeShelfStatus = "ready" | "empty" | "error" | "unavailable" | "loading";

export type MemePagination = {
  nextOffset: number | null;
  exhausted: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  autoLoadPaused: boolean;
  consecutiveEmptyPages: number;
};

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
  visibility: InvestSettings = INVEST_SETTINGS_DEFAULTS,
): readonly InvestAsset[] {
  return (shelf.id === "memes" ? memeAssets : shelf.assets).filter(
    (asset) => isDiscoverableAsset(asset) && isInvestAssetVisible(visibility, asset),
  );
}

export function getShelfPreviewAssets(
  shelf: (typeof discoverShelves)[number],
  memeAssets: readonly InvestAsset[] = [],
  visibility: InvestSettings = INVEST_SETTINGS_DEFAULTS,
): readonly InvestAsset[] {
  const assets = getShelfAssets(shelf, memeAssets, visibility);
  if (shelf.id === "memes") return assets.slice(0, MEME_PREVIEW_COUNT);
  if ("previewCount" in shelf) return assets.slice(0, shelf.previewCount);
  const ordered = shelf.previewAssetIds.flatMap((id) => assets.find((asset) => asset.id === id) ?? []);
  return [...ordered, ...assets.filter((asset) => !(shelf.previewAssetIds as readonly string[]).includes(asset.id))]
    .slice(0, shelf.previewAssetIds.length);
}

export function getVisibleShelves(
  memeAssets: readonly InvestAsset[] = [],
  visibility: InvestSettings = INVEST_SETTINGS_DEFAULTS,
): readonly (typeof discoverShelves)[number][] {
  return discoverShelves.filter(
    (shelf) =>
      isInvestCategoryVisible(visibility, shelf.category) &&
      (shelf.id === "memes" || getShelfAssets(shelf, memeAssets, visibility).length > 0),
  );
}

export function hasVisibleShelf(
  shelfId: DiscoverShelfId,
  memeAssets: readonly InvestAsset[] = [],
  visibility: InvestSettings = INVEST_SETTINGS_DEFAULTS,
): boolean {
  return getVisibleShelves(memeAssets, visibility).some((shelf) => shelf.id === shelfId);
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
