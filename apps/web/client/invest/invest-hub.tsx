import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { INVEST_SETTINGS_DEFAULTS, type InvestSettings } from "@/shared/operator-settings/invest";
import {
  getShelfPreviewAssets,
  getVisibleShelves,
  type DiscoverShelfId,
  type MemeShelfStatus,
} from "./discover";
import { DiscoverShelf } from "./discover-shelf";
import { InvestSearch, type InvestSearchState } from "./invest-search";

export type InvestHubProps = {
  stockMarket: MarketDataState;
  memeMarket: MarketDataState;
  cryptoMarket?: MarketDataState;
  memeAssets?: readonly InvestAsset[];
  memeStatus?: MemeShelfStatus;
  assetMarkResolution?: AssetMarkResolution;
  investVisibility?: InvestSettings;
  query?: string;
  onQueryChange?: (query: string) => void;
  composing?: boolean;
  onComposingChange?: (composing: boolean) => void;
  search?: InvestSearchState;
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
  investVisibility = INVEST_SETTINGS_DEFAULTS,
  query = "",
  onQueryChange = () => {},
  composing = false,
  onComposingChange = () => {},
  search,
  onSeeAll,
  onOpenAsset,
}: InvestHubProps) {
  const hosted = Boolean(useOptionalAppChrome());
  const markets = {
    stockMarket,
    cryptoMarket: cryptoMarket ?? unavailableMarketData,
    memeMarket,
  };
  const shelfMarkets = {
    stock: stockMarket,
    crypto: cryptoMarket ?? unavailableMarketData,
    meme: memeMarket,
  } as const;
  const visibleShelves = getVisibleShelves(memeAssets, investVisibility);

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
      {search && visibleShelves.length > 0 ? (
        <InvestSearch
          query={query}
          onQueryChange={onQueryChange}
          composing={composing}
          onComposingChange={onComposingChange}
          search={search}
          markets={markets}
          assetMarkResolution={assetMarkResolution}
          onOpenAsset={(asset) => onOpenAsset(asset, "hub")}
        />
      ) : null}
      {!query.trim() || visibleShelves.length === 0 ? (
        <div className={search && visibleShelves.length > 0 ? "mt-4 space-y-4" : "space-y-4"}>
          {visibleShelves.map((shelf) => (
            <DiscoverShelf
              key={shelf.id}
              title={shelf.title}
              assets={getShelfPreviewAssets(shelf, memeAssets, investVisibility)}
              market={shelfMarkets[shelf.category]}
              status={shelf.id === "memes" ? memeStatus : "ready"}
              assetMarkResolution={assetMarkResolution}
              onSeeAll={() => onSeeAll(shelf.id)}
              onOpenAsset={(asset) => onOpenAsset(asset, "hub")}
            />
          ))}
          {visibleShelves.length === 0 ? (
            <Empty><EmptyHeader><EmptyTitle>Nothing to invest in right now.</EmptyTitle></EmptyHeader></Empty>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
