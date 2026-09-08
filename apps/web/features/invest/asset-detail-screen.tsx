"use client";

import { useState } from "react";
import type { InvestAsset, InvestAssetId } from "@/config/invest-assets";
import { TradeActions } from "@/features/trading/trade-actions";
import { getMarketDisplay, type MarketDataState } from "./invest-market";
import { AssetIcon } from "./asset-icon";
import { BackIcon } from "./category-screen";
import { PriceChart } from "./price-chart";
import { usePriceHistory } from "./use-price-history";
import type { MarketPriceRange } from "@/server/market-data/codex/history-contract";
import styles from "./invest-experience.module.css";

export function AssetDetailScreen({
  asset,
  market,
  onBack,
}: {
  asset: InvestAsset;
  market: MarketDataState;
  onBack: () => void;
}) {
  const [range, setRange] = useState<MarketPriceRange>("1W");
  const history = usePriceHistory(asset.id as InvestAssetId, range);
  const price = getMarketDisplay(asset.id, market);
  return (
    <section
      className={`${styles.experience} ${styles.detailExperience}`}
      aria-labelledby="invest-asset-title"
    >
      <header className={styles.screenHeader}>
        <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <span className={styles.detailIdentity}>
          <AssetIcon assetId={asset.id} label={asset.displayName} size="md" />
          <h2 id="invest-asset-title">{asset.displayName}</h2>
        </span>
      </header>

      <div className={styles.priceHeader}>
        <strong>{price.value}</strong>
        <span>
          {asset.representation.tokenSymbol} · Base
        </span>
      </div>

      <PriceChart range={range} history={history} onRangeChange={setRange} />
      <TradeActions asset={asset} layout="sticky" />
    </section>
  );
}
