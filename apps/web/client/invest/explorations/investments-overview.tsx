"use client";

import { useState } from "react";
import { AssetChart } from "@/client/invest/asset-chart";
import { useChartClock } from "@/client/invest/asset-chart-support";
import { marketForAsset } from "@/client/invest/discover";
import { useMarketDisplay } from "@/client/invest/use-market-display";
import { useMarketPrices } from "@/client/invest/use-market-prices";
import { TradeActions } from "@/client/trading/trade-actions";
import { MoneyTicker } from "@/components/money-ticker";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { moneyChangeTone } from "@/shared/formatting";
import { matchesMarketPriceAssetIdentity, type MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { InvestmentsOverview } from "@/client/investments/investments-overview";
import { OwnedBalanceCard } from "@/client/investments/owned-asset-detail";
import { selectOwnedInvestments, type OwnedInvestment } from "@/shared/balances/owned-investments";



export type InvestmentsOverviewExplorationProps = {
  snapshot: BalancesSnapshot | null;
  balanceStatus: "ready" | "loading" | "failed";
  onOpenAsset: (key: string, opener: HTMLElement) => void;
  onRetryBalances: () => void;
  revealKey?: string | null;
};

type OwnedRow = OwnedInvestment;
export const ownedInvestmentRows = selectOwnedInvestments;

export function InvestmentsOverviewExploration({ snapshot, balanceStatus, onOpenAsset, onRetryBalances, revealKey }: InvestmentsOverviewExplorationProps) {
  const [visibleCount, setVisibleCount] = useState(20);
  const rows = snapshot ? selectOwnedInvestments(snapshot) : [];
  return <InvestmentsOverview snapshot={snapshot} balanceStatus={balanceStatus} visibleCount={Math.max(visibleCount, rows.findIndex((row) => row.key === revealKey) + 1)} onVisibleCountChange={setVisibleCount} onOpenAsset={(key) => onOpenAsset(key, document.activeElement as HTMLElement)} onRetryBalances={onRetryBalances} />;
}

export function OwnedAssetDetailExploration({ snapshot, assetKey, catalog = [], memeMarket, marketNow = Date.now }: { snapshot: BalancesSnapshot; assetKey: string; catalog?: readonly InvestAsset[]; memeMarket?: MarketDataState; marketNow?: () => number }) {
  const row = ownedInvestmentRows(snapshot).find((item) => item.key === assetKey);
  const address = row?.holding.contractAddress?.toLowerCase();
  const asset = catalog.find((item) => item.contractAddress.toLowerCase() === address && matchesMarketPriceAssetIdentity(item))
    ?? investAssets.find((item) => item.contractAddress.toLowerCase() === address);
  if (!row) return null;
  return <OwnedAssetDetailContent snapshot={snapshot} row={row} asset={asset} memeMarket={memeMarket} marketNow={marketNow} />;
}

function OwnedAssetDetailContent({ snapshot, row, asset, memeMarket, marketNow }: { snapshot: BalancesSnapshot; row: OwnedRow; asset: InvestAsset | undefined; memeMarket?: MarketDataState; marketNow: () => number }) {
  const name = row.holding.name || row.holding.symbol;
  return <section className="flex w-full flex-col gap-4 overflow-x-clip" aria-label={`${name} details`}>
    {asset ? <CatalogMarketDetail asset={asset} row={row} snapshot={snapshot} memeMarket={memeMarket} marketNow={marketNow} /> : <>
      <OwnedBalanceCard row={row} snapshot={snapshot} />
      <p className="text-sm text-muted-foreground">Trading isn&apos;t available for this asset.</p>
    </>}
  </section>;
}

function CatalogMarketDetail({ asset, row, snapshot, memeMarket, marketNow }: { asset: InvestAsset; row: OwnedRow; snapshot: BalancesSnapshot; memeMarket?: MarketDataState; marketNow: () => number }) {
  const [range, setRange] = useState<MarketPriceRange>("1W");
  const market = useMarketPrices({ now: marketNow });
  const price = useMarketDisplay(asset.id, marketForAsset(asset, { ...market, memeMarket: memeMarket ?? market.memeMarket }));
  const clock = useChartClock();
  const change = price.changeLabel ?? "—";
  const tone = moneyChangeTone(change);
  return <>
    <div className="@container space-y-1"><p className="text-sm text-muted-foreground">Price</p><strong className={price.tone === "ready" ? "block text-2xl @2xs:text-3xl @xs:text-4xl font-semibold tabular-nums" : "block text-lg font-semibold text-muted-foreground"}>{price.tone === "ready" ? <MoneyTicker align="start" reserveDigits={false} value={price.value} /> : price.detail}</strong>{change !== "—" ? <p className={`text-sm ${tone === "positive" ? "text-market-gain" : tone === "negative" ? "text-market-loss" : "text-muted-foreground"}`}>{change}</p> : null}<p className="text-sm text-muted-foreground">{asset.representation.tokenSymbol} · Base</p></div>
    <OwnedBalanceCard row={row} snapshot={snapshot} />
    <AssetChart key={asset.id} assetId={asset.id} range={range} onRangeChange={setRange} clock={clock} onReadout={() => {}} onResting={() => {}} />
    <TradeActions asset={asset} layout="sticky" />
  </>;
}
