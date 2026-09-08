import type { InvestAsset } from "@/config/invest-assets";
import { unavailableMarketData, type MarketDataState } from "./invest-market";
import {
  discoverShelves,
  getShelfPreviewAssets,
  type DiscoverShelfId,
} from "./discover";
import { DiscoverShelf } from "./discover-shelf";
import styles from "./invest-experience.module.css";

export type InvestHubProps = {
  stockMarket: MarketDataState;
  memeMarket: MarketDataState;
  cryptoMarket?: MarketDataState;
  onSeeAll: (shelfId: DiscoverShelfId) => void;
  onOpenAsset: (asset: InvestAsset, from: "hub") => void;
};

export function InvestHub({
  stockMarket,
  memeMarket,
  cryptoMarket,
  onSeeAll,
  onOpenAsset,
}: InvestHubProps) {
  const markets = {
    stock: stockMarket,
    crypto: cryptoMarket ?? unavailableMarketData,
    meme: memeMarket,
  } as const;

  return (
    <section className={styles.experience} aria-labelledby="invest-title">
      <header className={styles.header}>
        <h2 id="invest-title">Invest</h2>
        <p>Browse on Base</p>
      </header>
      <div className={styles.shelves}>
        {discoverShelves.map((shelf) => (
          <DiscoverShelf
            key={shelf.id}
            title={shelf.title}
            assets={getShelfPreviewAssets(shelf)}
            market={markets[shelf.assets[0].category]}
            onSeeAll={() => onSeeAll(shelf.id)}
            onOpenAsset={(asset) => onOpenAsset(asset, "hub")}
          />
        ))}
      </div>
    </section>
  );
}
