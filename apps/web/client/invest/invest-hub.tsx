import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import {
  discoverShelves,
  getShelfPreviewAssets,
  type DiscoverShelfId,
  type MemeShelfStatus,
} from "./discover";
import { DiscoverShelf } from "./discover-shelf";

export type InvestHubProps = {
  stockMarket: MarketDataState;
  memeMarket: MarketDataState;
  cryptoMarket?: MarketDataState;
  memeAssets?: readonly InvestAsset[];
  memeStatus?: MemeShelfStatus;
  assetMarkResolution?: AssetMarkResolution;
  onSeeAll: (shelfId: DiscoverShelfId) => void;
  onOpenAsset: (asset: InvestAsset, from: "hub") => void;
};

export function InvestHub({
  stockMarket,
  memeMarket,
  cryptoMarket,
  memeAssets = [],
  memeStatus = "empty",
  assetMarkResolution = {},
  onSeeAll,
  onOpenAsset,
}: InvestHubProps) {
  const hosted = Boolean(useOptionalAppChrome());
  const markets = {
    stock: stockMarket,
    crypto: cryptoMarket ?? unavailableMarketData,
    meme: memeMarket,
  } as const;

  return (
    <section
      className="w-full"
      aria-label={hosted ? "Invest" : undefined}
      aria-labelledby={hosted ? undefined : "invest-title"}
    >
      {hosted ? null : (
        <header className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight" id="invest-title">
            Invest
          </h2>
        </header>
      )}
      <div className="space-y-4">
        {discoverShelves.map((shelf) => (
          <DiscoverShelf
            key={shelf.id}
            title={shelf.title}
            assets={getShelfPreviewAssets(shelf, memeAssets)}
            market={markets[shelf.category]}
            status={shelf.id === "memes" ? memeStatus : "ready"}
            assetMarkResolution={assetMarkResolution}
            onSeeAll={() => onSeeAll(shelf.id)}
            onOpenAsset={(asset) => onOpenAsset(asset, "hub")}
          />
        ))}
      </div>
    </section>
  );
}
