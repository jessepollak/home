import type { InvestAsset } from "@/config/invest-assets";
import type { MarketDataState } from "./invest-market";
import { DiscoverAssetRow } from "./discover-asset-row";
import styles from "./invest-experience.module.css";

export function DiscoverShelf({
  title,
  assets,
  market,
  onSeeAll,
  onOpenAsset,
}: {
  title: string;
  assets: readonly InvestAsset[];
  market: MarketDataState;
  onSeeAll: () => void;
  onOpenAsset: (asset: InvestAsset) => void;
}) {
  return (
    <section className={styles.shelf} aria-labelledby={`${title.toLowerCase()}-shelf-title`}>
      <div className={styles.shelfHeading}>
        <h3 id={`${title.toLowerCase()}-shelf-title`}>{title}</h3>
        <button type="button" className={styles.seeAll} onClick={onSeeAll}>
          See all ›
        </button>
      </div>
      <ul className={styles.rows}>
        {assets.map((asset) => (
          <DiscoverAssetRow
            key={asset.id}
            asset={asset}
            market={market}
            onOpen={() => onOpenAsset(asset)}
          />
        ))}
      </ul>
    </section>
  );
}
