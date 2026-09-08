import type { InvestAsset } from "@/config/invest-assets";
import type { MarketDataState } from "./invest-market";
import type { MemeShelfStatus } from "./discover";
import { DiscoverAssetRow } from "./discover-asset-row";
import styles from "./invest-experience.module.css";

export function DiscoverShelf({
  title,
  assets,
  market,
  status = "ready",
  onSeeAll,
  onOpenAsset,
}: {
  title: string;
  assets: readonly InvestAsset[];
  market: MarketDataState;
  status?: MemeShelfStatus;
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
      {assets.length > 0 ? (
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
      ) : (
        <p className={styles.shelfStatus}>{shelfStatusLabel(status)}</p>
      )}
    </section>
  );
}

function shelfStatusLabel(status: MemeShelfStatus) {
  if (status === "loading") return "Loading";
  if (status === "error" || status === "unavailable") return "Unavailable";
  return "None trending";
}
