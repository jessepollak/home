import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/features/asset-mark/presentation";
import type { MarketDataState } from "./invest-market";
import { DiscoverAssetRow } from "./discover-asset-row";
import type { DiscoverShelfId, MemeShelfStatus } from "./discover";
import styles from "./invest-experience.module.css";

export function CategoryScreen({
  title,
  shelfId,
  assets,
  market,
  status = "ready",
  assetMarkResolution = {},
  onBack,
  onOpenAsset,
}: {
  title: string;
  shelfId: DiscoverShelfId;
  assets: readonly InvestAsset[];
  market: MarketDataState;
  status?: MemeShelfStatus;
  assetMarkResolution?: AssetMarkResolution;
  onBack: () => void;
  onOpenAsset: (asset: InvestAsset, from: DiscoverShelfId) => void;
}) {
  const hosted = Boolean(useOptionalAppChrome());
  return (
    <section
      className={styles.experience}
      aria-label={hosted ? title : undefined}
      aria-labelledby={hosted ? undefined : "invest-category-title"}
    >
      {hosted ? null : (
        <header className={styles.screenHeader}>
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back to Invest">
            <BackIcon />
          </button>
          <h2 id="invest-category-title">{title}</h2>
        </header>
      )}
      {assets.length > 0 ? (
        <ul className={styles.rows}>
          {assets.map((asset) => (
            <DiscoverAssetRow
              key={asset.id}
              asset={asset}
              market={market}
              assetMarkResolution={assetMarkResolution}
              onOpen={() => onOpenAsset(asset, shelfId)}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.shelfStatus}>
          {status === "error" || status === "unavailable"
            ? "Unavailable"
            : status === "loading"
              ? "Loading"
              : "None trending"}
        </p>
      )}
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
