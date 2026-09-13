"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyTicker } from "@/components/money-ticker";
import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import {
  presentInvestAssetMark,
  type AssetMarkResolution,
} from "@/client/asset-mark/presentation";
import { TradeActions } from "@/client/trading/trade-actions";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { moneyChangeTone } from "@/shared/formatting";
import { useMarketDisplay } from "./use-market-display";
import { AssetIcon } from "./asset-icon";
import { PriceChart } from "./price-chart";
import { usePriceHistory } from "./use-price-history";
import type { MarketPriceRange } from "@/shared/invest/history-contract";
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
          <Button
            variant="ghost"
            size="icon"
            className={`${styles.back} min-h-11 min-w-11`}
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowRight />
          </Button>
          <h2 id="invest-asset-status-title" className="text-section-title font-semibold">
            Asset details
          </h2>
        </header>
      )}
      <p className={`${styles.shelfStatus} text-metadata text-muted-foreground`} role="status">
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
  const changeTone = moneyChangeTone(change);
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
          <Button
            variant="ghost"
            size="icon"
            className={`${styles.back} min-h-11 min-w-11`}
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowRight />
          </Button>
          <span className={styles.detailIdentity}>
            <AssetIcon mark={mark} />
            <h2 id="invest-asset-title" className="text-section-title font-semibold">
              {asset.displayName}
            </h2>
          </span>
        </header>
      )}

      <div className={styles.priceHeader}>
        <strong
          className={`${styles.price} ${
            price.tone === "ready"
              ? "font-mono text-amount font-semibold"
              : "text-section-title font-semibold text-muted-foreground"
          }`}
          data-tone={price.tone}
        >
          {price.tone === "ready" ? <MoneyTicker value={price.value} /> : price.detail}
        </strong>
        {change !== "—" ? (
          <small
            className={`${styles.change} text-caption`}
            data-money-change={changeTone}
          >
            {change}
          </small>
        ) : null}
        <span className="text-caption text-muted-foreground">
          {asset.representation.tokenSymbol} · Base
        </span>
      </div>

      <PriceChart range={range} history={history} onRangeChange={setRange} />
      <TradeActions asset={asset} layout="sticky" />
    </section>
  );
}
