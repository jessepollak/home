"use client";

import { useCallback, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppDrawer, MoneyModalActions, MoneyModalBody, MoneyModalHeader } from "@/client/money-modal";
import { deferStep } from "@/client/money-modal/deferred-sheet";
import { TradeActions } from "@/client/trading/trade-actions";
import { presentInvestAssetMark } from "@/client/asset-mark/presentation";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvestAsset } from "@/config/invest-assets";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { moneyChangeTone } from "@/shared/formatting";
import { AssetIcon } from "../asset-icon";
import { AssetPosition } from "../asset-position";
import { useChartClock, type ChartReadout } from "../asset-chart-support";
import { useMarketDisplay } from "../use-market-display";
import { usePresentationQuote } from "../presentation-quote";

function SparklineLoadFallback({ failed, retry }: { failed: boolean; retry: () => void }) {
  return <section className="min-w-0" aria-label="Market price history">
    <div role="status" aria-label={failed ? "Couldn't load price history" : "Loading price history"}
      dir="ltr" className="relative -mx-4 h-20 min-w-0 overflow-hidden">
      {failed ? <div className="flex h-full items-center justify-between gap-3 px-4 text-sm text-muted-foreground">
        <span>{"Couldn't load price history"}</span><Button variant="outline" size="touch" onClick={retry}>Try again</Button>
      </div> : <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/20" />}
    </div>
  </section>;
}
const AssetSparkline = deferStep(() => import("./asset-sparkline").then(({ AssetSparkline }) => AssetSparkline));

type AssetSheetProps = {
  asset: InvestAsset;
  market: MarketDataState;
  open: boolean;
  opener?: HTMLElement | null;
  details?: "body" | "header";
  onClose: () => void;
  onViewDetails: () => void;
};

export function AssetSheetProposal(props: AssetSheetProps) {
  return <AssetSheetContent key={props.asset.id} {...props} />;
}

function AssetSheetContent({ asset, market, open, opener, details = "body", onClose, onViewDetails }: AssetSheetProps) {
  const titleId = useId();
  const [scrub, setScrub] = useState<ChartReadout | null>(null);
  const [resting, setResting] = useState<{ change: string | null; pending: boolean }>({ change: null, pending: true });
  const clock = useChartClock();
  const sparklineFallback = useCallback((state: { failed: boolean; retry: () => void }) => <SparklineLoadFallback {...state} />, []);
  const price = useMarketDisplay(asset.id, market);
  const quote = usePresentationQuote();
  const onResting = useCallback((change: string | null, pending: boolean) => {
    setResting((old) => old.change === change && old.pending === pending ? old : { change, pending });
  }, []);
  const change = resting.pending ? null : resting.change
    ? quote.valueCurrency === "USD" ? resting.change : resting.change.replace(" · ", " in USD · ") : null;
  const snapshot = market.status === "ready" ? market.snapshots.find((entry) => entry.assetId === asset.id) : undefined;
  return <AppDrawer open={open} opener={opener} labelledBy={titleId} variant="money" onCancel={onClose}>
    <div className="relative shrink-0">
      <MoneyModalHeader title={asset.displayName} titleId={titleId} closeLabel="Close"
        assetControl={<AssetIcon mark={presentInvestAssetMark(asset, {})} />} />
      {details === "header" ? <div className="absolute inset-x-15 inset-y-0 flex items-center justify-center bg-background">
        <Button variant="outline" size="touch" role="link" className="min-w-0 max-w-full" render={<a href={`/invest/${asset.id}`} aria-label={`View ${asset.displayName} details`} />} nativeButton={false}
          onClick={(event) => { event.preventDefault(); onViewDetails(); }}>
          <span className="min-w-0 truncate">{asset.displayName}</span><ChevronRight aria-hidden="true" />
        </Button>
      </div> : null}
    </div>
    <MoneyModalBody hasFooter="flush" className="gap-4">
      <div className="@container min-w-0 space-y-1 pt-2">
        <strong className={`block min-h-12 text-[min(1.875rem,16cqi)] leading-9 font-semibold tabular-nums ${price.tone === "ready" ? "" : "text-muted-foreground"}`}
          data-tone={price.tone}>
          <span dir="ltr" className="inline-block max-w-full">
            {scrub && !resting.pending ? `${scrub.value}${quote.valueCurrency !== "USD" ? " USD" : ""}`
              : price.tone === "ready" ? <MoneyTicker value={price.value} align="start" />
                : market.status === "loading" ? <Skeleton className="h-9 w-36" /> : "—"}
          </span>
        </strong>
        {asset.listing === "removed" ? <p className="text-sm text-muted-foreground">No longer listed</p>
          : market.status !== "loading" && (price.tone !== "ready" || price.context) ? <p className="text-sm text-muted-foreground">{price.context ?? price.detail}</p> : null}
        {scrub && !resting.pending ? <p className="min-h-5 text-sm" data-scrub-readout>{scrub.time}</p>
          : <p aria-busy={resting.pending || undefined} data-money-change={change ? moneyChangeTone(change) : undefined}
            className={`min-h-5 text-sm ${resting.pending || !change ? "text-muted-foreground"
              : moneyChangeTone(change) === "positive" ? "text-market-gain"
                : moneyChangeTone(change) === "negative" ? "text-market-loss" : "text-muted-foreground"}`}>
            {change}
          </p>}
      </div>
      <AssetSparkline key={asset.id} assetId={asset.id}
        clock={clock} onReadout={setScrub} onResting={onResting}
        fallback={sparklineFallback} />
      <AssetPosition asset={asset} assetMarkResolution={{}} headerAsOf={snapshot?.asOf} />
      {details === "body" ? <Button variant="outline" size="touch" className="w-full"
        aria-label={`View ${asset.displayName} details`} onClick={onViewDetails}>View details<ChevronRight aria-hidden="true" /></Button> : null}
    </MoneyModalBody>
    <MoneyModalActions><div className="flow-root -mt-7"><TradeActions asset={asset} layout="sticky" /></div></MoneyModalActions>
  </AppDrawer>;
}
