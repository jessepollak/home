import type { InvestAsset } from "@/config/invest-assets";
import { getMarketDisplay, type MarketDataState } from "./invest-market";
import { AssetIcon } from "./asset-icon";
import styles from "./invest-experience.module.css";

export function DiscoverAssetRow({
  asset,
  market,
  onOpen,
}: {
  asset: InvestAsset;
  market: MarketDataState;
  onOpen: () => void;
}) {
  const price = getMarketDisplay(asset.id, market);
  const change = price.changeLabel ?? "—";
  const changeTone =
    change.startsWith("+") ? styles.changeUp : change.startsWith("-") ? styles.changeDown : "";

  return (
    <li>
      <button
        type="button"
        className={styles.row}
        onClick={onOpen}
        aria-label={`${asset.displayName} details`}
      >
        <AssetIcon assetId={asset.id} label={asset.displayName} />
        <span className={styles.identity}>
          <strong>{asset.displayName}</strong>
          <small>{asset.displaySymbol}</small>
        </span>
        <span className={styles.quote}>
          <span className={styles.quoteLine}>
            <strong>{price.value}</strong>
            {change !== "—" ? (
              <small className={`${styles.change} ${changeTone}`}>{change}</small>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}
