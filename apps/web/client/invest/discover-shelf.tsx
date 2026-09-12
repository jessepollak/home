import { Button, Heading, Inline, Text } from "@home/ui";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { MarketDataState } from "@/shared/invest/invest-market";
import type { MemeShelfStatus } from "./discover";
import { DiscoverAssetRow } from "./discover-asset-row";
import styles from "./invest-experience.module.css";

export function DiscoverShelf({
  title,
  assets,
  market,
  status = "ready",
  assetMarkResolution = {},
  onSeeAll,
  onOpenAsset,
}: {
  title: string;
  assets: readonly InvestAsset[];
  market: MarketDataState;
  status?: MemeShelfStatus;
  assetMarkResolution?: AssetMarkResolution;
  onSeeAll: () => void;
  onOpenAsset: (asset: InvestAsset) => void;
}) {
  return (
    <section className={`${styles.shelf} surface-primary`} aria-labelledby={`${title.toLowerCase()}-shelf-title`}>
      <Inline className={styles.shelfHeading} space="3">
        <Heading level={3} textStyle="row-label" id={`${title.toLowerCase()}-shelf-title`}>
          {title}
        </Heading>
        <Button variant="quiet" onClick={onSeeAll}>
          See all ›
        </Button>
      </Inline>
      {assets.length > 0 ? (
        <ul className={styles.rows}>
          {assets.map((asset) => (
            <DiscoverAssetRow
              key={asset.id}
              asset={asset}
              market={market}
              assetMarkResolution={assetMarkResolution}
              onOpen={() => onOpenAsset(asset)}
            />
          ))}
        </ul>
      ) : (
        <Text className={styles.shelfStatus} textStyle="metadata" tone="muted">
          {shelfStatusLabel(status)}
        </Text>
      )}
    </section>
  );
}

function shelfStatusLabel(status: MemeShelfStatus) {
  if (status === "loading") return "Loading";
  if (status === "error" || status === "unavailable") return "Unavailable";
  return "None trending";
}
