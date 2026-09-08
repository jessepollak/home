import type { InvestAsset } from "@/config/invest-assets";
import type { MarketDataState } from "./invest-market";
import { DiscoverAssetRow } from "./discover-asset-row";
import type { DiscoverShelfId } from "./discover";
import styles from "./invest-experience.module.css";

export function CategoryScreen({
  title,
  shelfId,
  assets,
  market,
  onBack,
  onOpenAsset,
}: {
  title: string;
  shelfId: DiscoverShelfId;
  assets: readonly InvestAsset[];
  market: MarketDataState;
  onBack: () => void;
  onOpenAsset: (asset: InvestAsset, from: DiscoverShelfId) => void;
}) {
  return (
    <section className={styles.experience} aria-labelledby="invest-category-title">
      <header className={styles.screenHeader}>
        <button type="button" className={styles.back} onClick={onBack} aria-label="Back to Invest">
          <BackIcon />
        </button>
        <h2 id="invest-category-title">{title}</h2>
      </header>
      <ul className={styles.rows}>
        {assets.map((asset) => (
          <DiscoverAssetRow
            key={asset.id}
            asset={asset}
            market={market}
            onOpen={() => onOpenAsset(asset, shelfId)}
          />
        ))}
      </ul>
    </section>
  );
}

export function BackIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M11.5 3.5 6 9l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
