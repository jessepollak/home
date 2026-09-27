"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, RotateCw, Wallet } from "lucide-react";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import { ShimmerRows } from "@/client/home/panel-shared";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { AssetChart, useChartClock } from "@/client/invest/asset-chart";
import { marketForAsset } from "@/client/invest/discover";
import { useMarketDisplay } from "@/client/invest/use-market-display";
import { useMarketPrices } from "@/client/invest/use-market-prices";
import { TradeActions } from "@/client/trading/trade-actions";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { addFractions, exactDecimalToFraction, roundFractionPreservingPositive } from "@/shared/balances/math";
import { presentBalances, presentMoneyGroups, type BalanceRowModel } from "@/shared/balances/present";
import { selectCollateralHoldings, selectMoneyGroups } from "@/shared/balances/select";
import type { BalancesSnapshot, BorrowCollateralHolding, ExactDecimal, Holding } from "@/shared/balances/types";
import { formatExactPresentationTokenAmount, formatFiatAmount, formatPresentationTokenAmount, moneyChangeTone } from "@/shared/formatting";
import { matchesMarketPriceAssetIdentity, type MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { MarketDataState } from "@/shared/invest/invest-market";

export type InvestmentsOverviewExplorationProps = {
  snapshot: BalancesSnapshot | null;
  balanceStatus: "ready" | "loading" | "failed";
  refreshFailed?: boolean;
  onOpenAsset: (key: string, opener: HTMLElement) => void;
  onRetryBalances: () => void;
  revealKey?: string | null;
};

type OwnedRow = { key: string; holding: Holding; wallet: Holding | null; availableZero: Holding | null; availableUnknown: boolean; collateral: BorrowCollateralHolding[]; amount: ExactDecimal | null };

function walletInventoryComplete(snapshot: BalancesSnapshot) {
  return snapshot.coverage.registry === "complete" && snapshot.coverage.catalog === "complete";
}

function inventoryComplete(snapshot: BalancesSnapshot) {
  return walletInventoryComplete(snapshot) && snapshot.borrow.coverage === "complete";
}

export function ownedInvestmentRows(snapshot: BalancesSnapshot): OwnedRow[] {
  const wallet = selectMoneyGroups(snapshot).investments;
  const unavailable = snapshot.holdings.filter((holding) => holding.cashCurrency === null && holding.kind !== "vault-share" && !holding.collateral && holding.source !== "borrow" && holding.source !== "registry" && holding.balance.status === "unavailable");
  const rows = new Map<string, OwnedRow>();
  for (const holding of [...wallet, ...unavailable]) rows.set(holding.key, { key: holding.key, holding, wallet: holding, availableZero: null, availableUnknown: false, collateral: [], amount: null });
  for (const holding of selectCollateralHoldings(snapshot)) {
    const row = rows.get(holding.key);
    if (row) row.collateral.push(holding);
    else rows.set(holding.key, { key: holding.key, holding, wallet: null, availableZero: null, availableUnknown: false, collateral: [holding], amount: null });
  }
  for (const row of rows.values()) {
    if (row.wallet || !row.collateral.length) continue;
    row.availableZero = snapshot.holdings.find((holding) => holding.key === row.key && holding.cashCurrency === null && holding.kind !== "vault-share" && !holding.collateral && holding.source !== "borrow" && holding.balance.status === "ready" && holding.balance.baseUnits === "0") ?? null;
    row.availableUnknown = snapshot.holdings.some((holding) => holding.key === row.key && holding.cashCurrency === null && holding.kind !== "vault-share" && !holding.collateral && holding.source !== "borrow" && holding.balance.status === "unavailable") || (!row.availableZero && snapshot.coverage.catalog !== "complete");
  }
  return [...rows.values()].map((row) => {
    const holdings = [...(row.wallet ? [row.wallet] : []), ...row.collateral];
    return { ...row, amount: !row.availableUnknown && holdings.every((holding) => holding.balance.status === "ready" && holding.value.status === "priced")
      ? roundFractionPreservingPositive(addFractions(holdings.map((holding) => exactDecimalToFraction((holding.value as Extract<Holding["value"], { status: "priced" }>).amount))))
      : null };
  }).sort((a, b) => {
    if (a.amount && b.amount) {
      const left = exactDecimalToFraction(a.amount);
      const right = exactDecimalToFraction(b.amount);
      const difference = right.numerator * left.denominator - left.numerator * right.denominator;
      if (difference !== BigInt(0)) return difference > BigInt(0) ? 1 : -1;
    } else if (a.amount || b.amount) return a.amount ? -1 : 1;
    const nameOrder = (a.holding.name || a.holding.symbol).localeCompare(b.holding.name || b.holding.symbol, "en", { sensitivity: "base" });
    return nameOrder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
}

function quantity(holding: Holding, snapshot: BalancesSnapshot, exact = false) {
  if (holding.balance.status !== "ready") return "Balance unavailable";
  return exact
    ? formatExactPresentationTokenAmount(holding.balance.baseUnits, holding.decimals, holding.symbol, { regionId: snapshot.region })
    : formatPresentationTokenAmount(holding.balance.baseUnits, holding.decimals, holding.symbol, { category: holding.kind === "native" ? "crypto" : undefined, regionId: snapshot.region });
}

function holdingsQuantity(entries: Holding[], holding: Holding, snapshot: BalancesSnapshot, exact = false) {
  if (entries.some((entry) => entry.balance.status !== "ready")) return "Balance unavailable";
  const baseUnits = entries.reduce((sum, entry) => sum + BigInt(entry.balance.baseUnits!), BigInt(0)).toString();
  return exact
    ? formatExactPresentationTokenAmount(baseUnits, holding.decimals, holding.symbol, { regionId: snapshot.region })
    : formatPresentationTokenAmount(baseUnits, holding.decimals, holding.symbol, { category: holding.kind === "native" ? "crypto" : undefined, regionId: snapshot.region });
}

function ownedQuantity(row: OwnedRow, snapshot: BalancesSnapshot, exact = false) {
  return row.availableUnknown ? "Balance unavailable" : holdingsQuantity([...(row.wallet ? [row.wallet] : []), ...row.collateral], row.holding, snapshot, exact);
}

function amountLabel(value: ExactDecimal, snapshot: BalancesSnapshot) {
  return formatFiatAmount(BigInt(value.atoms), value.scale, snapshot.quoteCurrency ?? "USD", { regionId: snapshot.region, fractionDigits: 2 });
}

function unavailableValue() {
  return <><span aria-hidden="true">—</span><span className="sr-only">Value unavailable</span></>;
}

function holdingMark(holding: Holding, mark: BalanceRowModel["mark"]) {
  const symbolMark = mark.kind === "symbol"
    ? presentPortfolioAssetMark({ assetKey: holding.key, name: holding.name, symbol: mark.symbol, currency: null })
    : null;
  return mark.kind === "flag"
    ? <CurrencyMark currency={mark.currency} size="sm" />
    : mark.kind === "image"
      ? <CurrencyMark assetKey={holding.key} src={mark.url} symbol={mark.fallbackSymbol} size="sm" />
      : mark.kind === "eth"
        ? <CurrencyMark assetKey={holding.key} symbol="ETH" size="sm" />
        : <CurrencyMark assetKey={holding.key} src={symbolMark?.imageUrl} symbol={symbolMark?.symbol} pending={symbolMark?.pending} size="sm" />;
}

function holdingRowMark(holding: Holding, marks: Map<string, BalanceRowModel["mark"]>) {
  return holdingMark(holding, marks.get(holding.key) ?? (holding.imageUrl
    ? { kind: "image", url: holding.imageUrl, fallbackSymbol: holding.symbol }
    : holding.kind === "native" ? { kind: "eth" } : { kind: "symbol", symbol: holding.symbol }));
}

export function InvestmentsOverviewExploration({ snapshot, balanceStatus, refreshFailed = false, onOpenAsset, onRetryBalances, revealKey }: InvestmentsOverviewExplorationProps) {
  const loading = balanceStatus === "loading";
  const failed = balanceStatus === "failed" && !snapshot;
  const active = loading || failed ? null : snapshot;
  const summary = active ? presentBalances({ status: "ready", snapshot: active, error: null }).summary?.investments : null;
  const rows = active ? ownedInvestmentRows(active) : [];
  const coverageIncomplete = !!active && !inventoryComplete(active);
  const caveat = active && coverageIncomplete ? rows.length || summary?.value ? "Some balances couldn't be loaded" : "Balances aren't available right now." : summary && summary.status !== "complete" ? "Some values are unavailable" : null;
  const [visibleCount, setVisibleCount] = useState(() => Math.max(20, rows.findIndex((row) => row.key === revealKey) + 1));
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinel.current || visibleCount >= rows.length) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setVisibleCount((count) => Math.min(count + 20, rows.length));
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [visibleCount, rows.length]);
  const marks = new Map(active ? presentMoneyGroups(active).flatMap((group) => group.rows.map((row) => [row.key, row.mark] as const)) : []);
  return <div className="space-y-4">
    <Card variant="flush" aria-label={failed ? "Balance unavailable" : "Investments balance"} aria-busy={loading || undefined}><CardContent inset="hero">
      <div className="@container flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Investments</p>
        {loading ? <div data-shimmer="hero"><Skeleton className="h-14 w-48" /><span className="sr-only">Updating…</span></div> : <div data-tone={summary?.status === "complete" ? "default" : "muted"} className={`text-2xl @2xs:text-3xl @xs:text-4xl font-semibold tabular-nums ${summary?.status !== "complete" ? "text-muted-foreground" : ""}`}>
          {summary?.value ? <MoneyTicker align="start" reserveDigits={false} value={summary.value} /> : unavailableValue()}
        </div>}
        {caveat ? coverageIncomplete && !refreshFailed ? <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{caveat}</span><Button variant="link" size="inline" className="-my-3 min-h-11" onClick={onRetryBalances}>Try again</Button></div> : <p className="text-sm text-muted-foreground">{caveat}</p> : null}
        {failed ? <p className="text-sm text-muted-foreground">Couldn&apos;t load your balance. Check your connection.</p> : null}
        {refreshFailed && active ? <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Couldn&apos;t refresh</span><Button variant="link" size="inline" className="-my-3 min-h-11" onClick={onRetryBalances}>Try again</Button></div> : null}
      </div>
      {failed ? <Button variant="outline" size="touch" className="w-full" onClick={onRetryBalances}><RotateCw aria-hidden="true" />Try again</Button> : null}
    </CardContent></Card>
    {loading || rows.length > 0 ? <section aria-labelledby="investments-held-heading" aria-busy={loading || undefined}><Card><CardHeader><HomeSectionHeading id="investments-held-heading">Your investments</HomeSectionHeading></CardHeader><CardContent inset="list">
      {loading ? <><ShimmerRows count={3} /><span className="sr-only">Updating…</span></> : <><ul className="list-none p-0">{rows.slice(0, visibleCount).map((row) => {
        const context = ownedQuantity(row, active!);
        return <BalanceRow key={row.key} icon={holdingRowMark(row.holding, marks)} iconTone="mark" label={<span data-holding-key={row.key}>{row.holding.name || row.holding.symbol}</span>} context={context} contextTitle={ownedQuantity(row, active!, true)} value={row.amount ? <MoneyTicker animated={false} value={amountLabel(row.amount, active!)} /> : unavailableValue()} valueTone={row.amount ? "default" : "muted"} valueContext={row.collateral.length ? row.wallet ? "Includes collateral" : "Collateral" : undefined} onActivate={(opener) => onOpenAsset(row.key, opener)} activateLabel={`Open ${row.holding.name || row.holding.symbol}`} chevron />;
      })}</ul>{visibleCount < rows.length ? <><span role="status" className="sr-only">Showing {visibleCount} of {rows.length} investments</span><div ref={sentinel} aria-hidden="true" /></> : null}</>}
    </CardContent></Card></section> : null}
  </div>;
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

function OwnedBalanceCard({ row, snapshot }: { row: OwnedRow; snapshot: BalancesSnapshot }) {
  const availableIsZero = !row.wallet && !row.availableUnknown;
  return <Card><CardContent inset="hero"><div className="@container space-y-2">
    <p className="text-sm text-muted-foreground">Your balance</p>
    <div className={`text-xl @2xs:text-2xl font-semibold tabular-nums ${row.amount ? "" : "text-muted-foreground"}`}>{row.amount ? <MoneyTicker align="start" reserveDigits={false} animated={false} value={amountLabel(row.amount, snapshot)} /> : unavailableValue()}</div>
    <p className="text-sm text-muted-foreground">{ownedQuantity(row, snapshot, true)}</p>
    {row.collateral.length ? <ul className="list-none p-0"><BalanceRow icon={<GlyphMark size="sm"><Wallet /></GlyphMark>} label="Available" context={row.wallet ? quantity(row.wallet, snapshot) : row.availableZero ? quantity(row.availableZero, snapshot) : availableIsZero ? `0 ${row.holding.symbol}` : "Balance unavailable"} value={row.wallet?.balance.status === "ready" && row.wallet.value.status === "priced" ? <MoneyTicker animated={false} value={amountLabel(row.wallet.value.amount, snapshot)} /> : availableIsZero ? <MoneyTicker animated={false} value={amountLabel({ atoms: "0", scale: 2 }, snapshot)} /> : unavailableValue()} valueTone={row.wallet?.balance.status === "ready" && row.wallet.value.status === "priced" || availableIsZero ? "default" : "muted"} chevron={false} /><BalanceRow icon={<GlyphMark size="sm"><Lock /></GlyphMark>} label="Collateral" context={holdingsQuantity(row.collateral, row.holding, snapshot)} value={row.collateral.every((item) => item.value.status === "priced") ? <MoneyTicker animated={false} value={amountLabel(roundFractionPreservingPositive(addFractions(row.collateral.map((item) => exactDecimalToFraction((item.value as Extract<Holding["value"], { status: "priced" }>).amount)))), snapshot)} /> : unavailableValue()} valueTone={row.collateral.every((item) => item.value.status === "priced") ? "default" : "muted"} chevron={false} /></ul> : null}
  </div></CardContent></Card>;
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
