"use client";

import { useState } from "react";
import type { InvestAsset } from "@/config/invest-assets";
import { TradeActions } from "@/features/trading/trade-actions";
import type { MarketDataState } from "./invest-market";
import { useMarketDisplay } from "./use-market-display";
import { AssetIcon } from "./asset-icon";
import { BackIcon } from "./category-screen";
import { PriceChart } from "./price-chart";
import { usePriceHistory } from "./use-price-history";
import type { MarketPriceRange } from "@/server/market-data/codex/history-contract";
import styles from "./invest-experience.module.css";

export function AssetDetailStatusScreen({
  status,
  onBack,
}: {
  status: "loading" | "unavailable";
  onBack: () => void;
}) {
  return (
    <section className={styles.experience} aria-labelledby="invest-asset-status-title">
      <header className={styles.screenHeader}>
        <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <h2 id="invest-asset-status-title">Asset details</h2>
      </header>
      <p className={styles.shelfStatus} role="status">
        {status === "loading"
          ? "Loading asset details."
          : "This Base asset is currently unavailable."}
      </p>
    </section>
  );
}

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
  const history = usePriceHistory(asset.id, range);
  const price = useMarketDisplay(asset.id, market);
  const change = price.changeLabel ?? "—";
  const changeTone =
    change.startsWith("+") ? styles.changeUp : change.startsWith("-") ? styles.changeDown : "";
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
          <AssetIcon
            assetId={asset.id}
            label={asset.displayName}
            initials={asset.initials}
            imageUrl={asset.imageUrl}
            size="md"
          />
          <h2 id="invest-asset-title">{asset.displayName}</h2>
        </span>
      </header>

      <div className={styles.priceHeader}>
        <strong data-tone={price.tone}>
          {price.tone === "ready" ? price.value : price.detail}
        </strong>
        {change !== "—" ? (
          <small className={`${styles.change} ${changeTone}`}>{change}</small>
        ) : null}
        <span>
          {asset.representation.tokenSymbol} · Base
        </span>
      </div>

      <PriceChart range={range} history={history} onRangeChange={setRange} />
      <TradeActions asset={asset} layout="sticky" />
    </section>
  );
}
