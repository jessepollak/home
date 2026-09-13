"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";

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
      className="w-full space-y-4"
      aria-label={hosted ? "Asset details" : undefined}
      aria-labelledby={hosted ? undefined : "invest-asset-status-title"}
    >
      {hosted ? null : (
        <header className="flex items-center gap-2">
          <Button variant="ghost" size="icon-lg" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h2 id="invest-asset-status-title" className="text-lg font-semibold">
            Asset details
          </h2>
        </header>
      )}
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {status === "loading" ? "Loading asset details" : "Asset unavailable"}
          </EmptyTitle>
          <EmptyDescription>
            {status === "loading"
              ? "Fetching the latest market information."
              : "This Base asset is currently unavailable."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
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
      className="flex w-full flex-col gap-4 overflow-x-clip"
      aria-label={hosted ? asset.displayName : undefined}
      aria-labelledby={hosted ? undefined : "invest-asset-title"}
    >
      {hosted ? null : (
        <header className="flex items-center gap-2">
          <Button variant="ghost" size="icon-lg" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <span className="flex min-w-0 items-center gap-2">
            <AssetIcon mark={mark} />
            <h2 id="invest-asset-title" className="text-lg font-semibold">
              {asset.displayName}
            </h2>
          </span>
        </header>
      )}

      <div className="space-y-1">
        <strong
          className={
            price.tone === "ready"
              ? "block whitespace-nowrap text-4xl font-semibold tabular-nums"
              : "block text-lg font-semibold text-muted-foreground"
          }
          data-tone={price.tone}
        >
          {price.tone === "ready" ? <MoneyTicker value={price.value} /> : price.detail}
        </strong>
        {change !== "—" ? (
          <p
            className={`text-sm ${
              changeTone === "positive"
                ? "text-[var(--market-gain)]"
                : changeTone === "negative"
                  ? "text-[var(--market-loss)]"
                  : "text-muted-foreground"
            }`}
            data-money-change={changeTone}
          >
            {change}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {asset.representation.tokenSymbol} · Base
        </p>
      </div>

      <PriceChart range={range} history={history} onRangeChange={setRange} />
      <TradeActions asset={asset} layout="sticky" />
    </section>
  );
}
