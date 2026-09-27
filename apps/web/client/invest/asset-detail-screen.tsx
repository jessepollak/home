"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import { presentInvestAssetMark, type AssetMarkResolution } from "@/client/asset-mark/presentation";
import { TradeActions } from "@/client/trading/trade-actions";
import type { MarketDataState } from "@/shared/invest/invest-market";
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import { moneyChangeTone } from "@/shared/formatting";
import { useMarketDisplay } from "./use-market-display";
import { usePresentationQuote } from "./presentation-quote";
import { AssetIcon } from "./asset-icon";
import { AssetChart, useChartClock, type ChartReadout } from "./asset-chart";
import { AssetPosition } from "./asset-position";
import { AssetStats } from "./asset-stats";
import { PinnedTradeBar } from "./pinned-trade-bar";

export function AssetDetailStatusScreen({ status, onBack }: { status: "loading" | "unavailable"; onBack: () => void }) {
  const hosted = Boolean(useOptionalAppChrome());
  return (
    <section className="w-full space-y-4" aria-label={hosted ? "Asset details" : undefined}
      aria-labelledby={hosted ? undefined : "invest-asset-status-title"}>
      {hosted ? null : (
        <header className="flex items-center gap-2">
          <Button variant="ghost" size="icon-lg" onClick={onBack} aria-label="Back"><ArrowLeft className="size-4" /></Button>
          <h2 id="invest-asset-status-title" className="text-lg font-semibold">Asset details</h2>
        </header>
      )}
      <Empty><EmptyHeader>
        <EmptyTitle>{status === "loading" ? "Loading asset details" : "Asset unavailable"}</EmptyTitle>
        <EmptyDescription>{status === "loading"
          ? "Fetching the latest market information." : "This Base asset is currently unavailable."}</EmptyDescription>
      </EmptyHeader></Empty>
    </section>
  );
}

export function AssetDetailScreen({ asset, market, assetMarkResolution = {}, onBack, ownership }: {
  asset: InvestAsset;
  market: MarketDataState;
  assetMarkResolution?: AssetMarkResolution;
  onBack: () => void;
  ownership?: ReactNode;
}) {
  const [range, setRange] = useState<MarketPriceRange>("1W");
  const [scrub, setScrub] = useState<ChartReadout | null>(null);
  const [resting, setResting] = useState<{ change: string | null; pending: boolean }>({ change: null, pending: true });
  const clock = useChartClock();
  const price = useMarketDisplay(asset.id, market);
  const quote = usePresentationQuote();
  const hosted = Boolean(useOptionalAppChrome());
  const mark = presentInvestAssetMark(asset, assetMarkResolution);
  const onRangeChange = useCallback((next: MarketPriceRange) => {
    setScrub(null);
    setResting({ change: null, pending: true });
    setRange(next);
  }, []);
  const onResting = useCallback((change: string | null, pending: boolean) => {
    setResting((old) => old.change === change && old.pending === pending ? old : { change, pending });
  }, []);
  const change = resting.pending ? null : resting.change
    ? quote.valueCurrency === "USD" ? resting.change : resting.change.replace(" · ", " in USD · ") : null;
  return <section aria-label={hosted ? asset.displayName : undefined}
    aria-labelledby={hosted ? undefined : "invest-asset-title"}
    style={hosted ? { "--asset-surface": "var(--color-muted)" } as CSSProperties : undefined}
    className={hosted
      ? "-mx-4 flex min-w-0 flex-col gap-4 overflow-x-clip px-4 sm:mx-0 sm:px-0"
      : "mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-4 overflow-x-clip px-4 py-4 sm:px-0"}>
    {hosted ? null : <header className="flex min-w-0 items-center gap-2">
      <Button variant="ghost" size="icon" className="size-11" onClick={onBack} aria-label="Back">
        <ArrowLeft aria-hidden="true" />
      </Button>
      <AssetIcon mark={mark} />
      <h2 id="invest-asset-title" className="truncate text-lg font-semibold">{asset.displayName}</h2>
    </header>}
    <div className="min-w-0 space-y-1">
      <strong className={`block min-h-12 truncate text-3xl font-semibold tabular-nums sm:min-h-14 sm:text-4xl ${price.tone === "ready" ? "" : "text-muted-foreground"}`}
        data-tone={price.tone}>
        {scrub && !resting.pending ? `${scrub.value}${quote.valueCurrency !== "USD" ? " USD" : ""}`
          : price.tone === "ready" ? <MoneyTicker value={price.value} align="start" />
            : market.status === "loading" ? <Skeleton className="h-9 w-36" /> : "—"}
      </strong>
      {price.tone !== "ready" && market.status !== "loading" ? <p className="text-sm text-muted-foreground">{price.detail}</p> : null}
      {scrub && !resting.pending ? <p className="min-h-5 text-sm" data-scrub-readout>{scrub.time}</p>
        : <p aria-busy={resting.pending || undefined} data-money-change={change ? moneyChangeTone(change) : undefined}
          className={`min-h-5 text-sm ${resting.pending || !change ? "text-muted-foreground"
            : moneyChangeTone(change) === "positive" ? "text-market-gain"
              : moneyChangeTone(change) === "negative" ? "text-market-loss" : "text-muted-foreground"}`}>
          {change}
        </p>}
    </div>
    <AssetChart key={asset.id} assetId={asset.id} range={range} onRangeChange={onRangeChange}
      clock={clock} onReadout={setScrub} onResting={onResting} />
    {ownership ?? <AssetPosition asset={asset} assetMarkResolution={assetMarkResolution} />}
    <AssetStats asset={asset} market={market} clock={clock} />
    {asset.category === "stock" ? <TradeActions asset={asset} layout="sticky" /> : null}
    <p className="text-xs text-muted-foreground">Market prices in USD from Codex.</p>
    {asset.category !== "stock" ? <PinnedTradeBar asset={asset} /> : null}
  </section>;
}
