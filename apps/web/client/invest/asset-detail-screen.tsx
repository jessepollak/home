"use client";

import { useState } from "react";
import { Heading, IconButton, Text } from "@home/ui";
import { ArrowRightIcon } from "@home/ui/icons";
import { MoneyTicker } from "@home/ui/money-ticker";
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
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
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
          <IconButton
            icon={ArrowRightIcon}
            className={styles.back}
            onClick={onBack}
            aria-label="Back"
          />
          <Heading level={2} textStyle="section-title" id="invest-asset-status-title">
            Asset details
          </Heading>
        </header>
      )}
      <Text className={styles.shelfStatus} textStyle="metadata" tone="muted" role="status">
        {status === "loading"
          ? "Loading asset details."
          : "This Base asset is currently unavailable."}
      </Text>
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
          <IconButton
            icon={ArrowRightIcon}
            className={styles.back}
            onClick={onBack}
            aria-label="Back"
          />
          <span className={styles.detailIdentity}>
            <AssetIcon mark={mark} />
            <Heading level={2} textStyle="section-title" id="invest-asset-title">
              {asset.displayName}
            </Heading>
          </span>
        </header>
      )}

      <div className={styles.priceHeader}>
        <Text
          as="strong"
          textStyle={price.tone === "ready" ? "amount" : "section-title"}
          tone={price.tone === "ready" ? "default" : "muted"}
          className={styles.price}
          data-tone={price.tone}
        >
          {price.tone === "ready" ? <MoneyTicker value={price.value} /> : price.detail}
        </Text>
        {change !== "—" ? (
          <Text
            as="small"
            textStyle="secondary"
            className={styles.change}
            data-money-change={changeTone}
          >
            {change}
          </Text>
        ) : null}
        <Text as="span" textStyle="secondary" tone="muted">
          {asset.representation.tokenSymbol} · Base
        </Text>
      </div>

      <PriceChart range={range} history={history} onRangeChange={setRange} />
      <TradeActions asset={asset} layout="sticky" />
    </section>
  );
}
