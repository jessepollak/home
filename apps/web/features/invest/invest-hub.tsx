import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import { unavailableMarketData, type MarketDataState } from "./invest-market";
import {
  applyAssetIcon,
  discoverShelves,
  getShelfPreviewAssets,
  type DiscoverShelfId,
  type MemeShelfStatus,
} from "./discover";
import { DiscoverShelf } from "./discover-shelf";
import styles from "./invest-experience.module.css";

export type InvestHubProps = {
  stockMarket: MarketDataState;
  memeMarket: MarketDataState;
  cryptoMarket?: MarketDataState;
  memeAssets?: readonly InvestAsset[];
  memeStatus?: MemeShelfStatus;
  assetIcons?: Readonly<Record<string, string | null>>;
  iconsPending?: boolean;
  onSeeAll: (shelfId: DiscoverShelfId) => void;
  onOpenAsset: (asset: InvestAsset, from: "hub") => void;
};

export function InvestHub({
  stockMarket,
  memeMarket,
  cryptoMarket,
  memeAssets = [],
  memeStatus = "empty",
  assetIcons = {},
  iconsPending = false,
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
      className={styles.experience}
      aria-label={hosted ? "Invest" : undefined}
      aria-labelledby={hosted ? undefined : "invest-title"}
    >
      {hosted ? null : (
        <header className={styles.header}>
          <h2 id="invest-title">Invest</h2>
        </header>
      )}
      <div className={styles.shelves}>
        {discoverShelves.map((shelf) => (
          <DiscoverShelf
            key={shelf.id}
            title={shelf.title}
            assets={getShelfPreviewAssets(shelf, memeAssets).map((asset) =>
              applyAssetIcon(asset, assetIcons),
            )}
            market={markets[shelf.category]}
            status={shelf.id === "memes" ? memeStatus : "ready"}
            iconsPending={iconsPending}
            onSeeAll={() => onSeeAll(shelf.id)}
            onOpenAsset={(asset) => onOpenAsset(asset, "hub")}
          />
        ))}
      </div>
    </section>
  );
}
