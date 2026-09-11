"use client";

import { useState } from "react";
import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import {
  presentInvestAssetMark,
  type AssetMarkResolution,
} from "@/features/asset-mark/presentation";
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
  const hosted = Boolean(useOptionalAppChrome());
  return (
    <section
      className={styles.experience}
      aria-label={hosted ? "Asset details" : undefined}
      aria-labelledby={hosted ? undefined : "invest-asset-status-title"}
    >
      {hosted ? null : (
        <header className={styles.screenHeader}>
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
          <h2 id="invest-asset-status-title">Asset details</h2>
        </header>
      )}
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
  assetMarkResolution = {},
  onBack,
}: {
  asset: InvestAsset;
  market: MarketDataState;
  assetMarkResolution?: AssetMarkResolution;
  onBack: () => void;
}) {
  const [range, setRange] = useState<MarketPriceRange>("1W");
  const history = usePriceHistory(asset.id, range);
  const price = useMarketDisplay(asset.id, market);
  const change = price.changeLabel ?? "—";
  const changeTone =
    change.startsWith("+") ? styles.changeUp : change.startsWith("-") ? styles.changeDown : "";
  const hosted = Boolean(useOptionalAppChrome());
  const mark = presentInvestAssetMark(asset, assetMarkResolution);
  return (
    <section
      className={`${styles.experience} ${styles.detailExperience}`}
      aria-label={hosted ? asset.displayName : undefined}
      aria-labelledby={hosted ? undefined : "invest-asset-title"}
    >
      {hosted ? null : (
        <header className={styles.screenHeader}>
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
          <span className={styles.detailIdentity}>
            <AssetIcon mark={mark} />
            <h2 id="invest-asset-title">{asset.displayName}</h2>
          </span>
        </header>
      )}

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
