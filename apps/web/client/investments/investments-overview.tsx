"use client";

import { useEffect, useRef } from "react";
import { RotateCw } from "lucide-react";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import { ShimmerRows } from "@/client/home/panel-shared";
import { CurrencyMark } from "@/components/currency-mark";
import { compactFinancialValue } from "@/components/compact-financial-value";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { selectOwnedInvestments, type OwnedInvestment } from "@/shared/balances/owned-investments";
import { presentBalances, presentMoneyGroups, type BalanceRowModel } from "@/shared/balances/present";
import type { AssetKey, BalancesSnapshot, ExactDecimal, Holding } from "@/shared/balances/types";
import { holdingValueContext } from "@/shared/balances/value-label";
import { formatExactPresentationTokenAmount, formatFiatAmount, formatPresentationTokenAmount } from "@/shared/formatting";

export type InvestmentsOverviewProps = {
  snapshot: BalancesSnapshot | null;
  balanceStatus: "ready" | "loading" | "failed";
  refreshFailed?: boolean;
  visibleCount: number;
  onVisibleCountChange: (count: number) => void;
  onOpenAsset: (key: AssetKey) => void;
  onRetryBalances: () => void;
};

export function quantity(holding: Holding, snapshot: BalancesSnapshot, exact = false) {
  if (holding.balance.status !== "ready") return "Balance unavailable";
  return exact
    ? formatExactPresentationTokenAmount(holding.balance.baseUnits, holding.decimals, holding.symbol, { regionId: snapshot.region })
    : formatPresentationTokenAmount(holding.balance.baseUnits, holding.decimals, holding.symbol, { category: holding.kind === "native" ? "crypto" : undefined, regionId: snapshot.region });
}

export function holdingsQuantity(entries: Holding[], holding: Holding, snapshot: BalancesSnapshot, exact = false) {
  if (entries.some((entry) => entry.balance.status !== "ready")) return "Balance unavailable";
  const baseUnits = entries.reduce((sum, entry) => sum + BigInt(entry.balance.status === "ready" ? entry.balance.baseUnits : "0"), BigInt(0)).toString();
  return exact
    ? formatExactPresentationTokenAmount(baseUnits, holding.decimals, holding.symbol, { regionId: snapshot.region })
    : formatPresentationTokenAmount(baseUnits, holding.decimals, holding.symbol, { category: holding.kind === "native" ? "crypto" : undefined, regionId: snapshot.region });
}

export function ownedBalanceUnreadable(row: OwnedInvestment) {
  return [...(row.wallet ? [row.wallet] : []), ...row.collateral].some((holding) => holding.balance.status !== "ready");
}

export function ownedQuantity(row: OwnedInvestment, snapshot: BalancesSnapshot, exact = false) {
  return holdingsQuantity([...(row.wallet ? [row.wallet] : []), ...row.collateral], row.holding, snapshot, exact);
}

export function amountLabel(value: ExactDecimal, snapshot: BalancesSnapshot) {
  return formatFiatAmount(BigInt(value.atoms), value.scale, snapshot.quoteCurrency ?? "USD", { regionId: snapshot.region, fractionDigits: 2 });
}

export function unavailableValue() {
  return <><span aria-hidden="true">—</span><span className="sr-only">Value unavailable</span></>;
}

export function RefreshFailedNotice({ onRetry }: { onRetry: () => void }) {
  return <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Couldn&apos;t refresh</span><Button variant="link" size="inline" className="-my-3 min-h-11" onClick={onRetry}>Try again</Button></div>;
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

export function InvestmentsOverview({ snapshot, balanceStatus, refreshFailed = false, visibleCount, onVisibleCountChange, onOpenAsset, onRetryBalances }: InvestmentsOverviewProps) {
  const loading = balanceStatus === "loading";
  const failed = balanceStatus === "failed" && !snapshot;
  const active = loading || failed ? null : snapshot;
  const summary = active ? presentBalances({ status: "ready", snapshot: active, error: null }).summary?.investments : null;
  const rows = active ? selectOwnedInvestments(active) : [];
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinel.current || visibleCount >= rows.length || typeof IntersectionObserver === "undefined") return;
    const rootElement = sentinel.current.closest("[data-app-main-authenticated]");
    const root = rootElement instanceof HTMLElement ? rootElement : null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) onVisibleCountChange(Math.min(visibleCount + 20, rows.length));
    }, { root, rootMargin: "0px 0px 100% 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [visibleCount, rows.length, onVisibleCountChange]);
  const marks = new Map<string, BalanceRowModel["mark"]>(active ? presentMoneyGroups(active).flatMap((group) => group.rows.map((row) => [row.key, row.mark] as const)) : []);
  return <div className="space-y-4">
    <Card variant="flush" aria-label={failed ? "Balance unavailable" : "Investments balance"} aria-busy={loading || undefined}><CardContent inset="hero">
      <div className="@container flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Investments</p>
        {loading ? <div data-shimmer="hero"><Skeleton className="h-14 w-48" /><span className="sr-only">Updating…</span></div> : <div data-tone={summary?.status === "complete" ? "default" : "muted"} className={`text-2xl @2xs:text-3xl @xs:text-4xl font-semibold tabular-nums ${summary?.status !== "complete" ? "text-muted-foreground" : ""}`}>
          {summary?.value ? <MoneyTicker align="start" reserveDigits={false} value={compactFinancialValue(summary.value)} aria-label={summary.value} /> : unavailableValue()}
        </div>}
        {summary && summary.status !== "complete" ? <p className="text-sm text-muted-foreground">Some values are unavailable</p> : null}
        {failed ? <p className="text-sm text-muted-foreground">Couldn&apos;t load your balance. Check your connection.</p> : null}
        {refreshFailed && active ? <RefreshFailedNotice onRetry={onRetryBalances} /> : null}
      </div>
      {failed ? <Button variant="outline" size="touch" className="w-full" onClick={onRetryBalances}><RotateCw aria-hidden="true" />Try again</Button> : null}
    </CardContent></Card>
    {loading || rows.length > 0 ? <section aria-labelledby="investments-held-heading" aria-busy={loading || undefined}><Card><CardHeader><HomeSectionHeading id="investments-held-heading">Your investments</HomeSectionHeading></CardHeader><CardContent inset="list">
      {loading ? <><ShimmerRows count={3} /><span className="sr-only">Updating…</span></> : <><ul className="list-none p-0">{rows.slice(0, visibleCount).map((row) => {
        const context = ownedQuantity(row, active!);
        const unreadable = ownedBalanceUnreadable(row);
        const value = row.amount ? amountLabel(row.amount, active!) : null;
        const reason = holdingValueContext(row.holding.value);
        return <BalanceRow key={row.key} icon={holdingRowMark(row.holding, marks)} iconTone="mark" label={<span data-holding-key={row.key}>{row.holding.name.trim() || row.holding.symbol.trim()}</span>} context={unreadable ? undefined : context} contextTitle={unreadable ? undefined : ownedQuantity(row, active!, true)} value={unreadable ? "Unavailable" : value ? <MoneyTicker animated={false} value={compactFinancialValue(value)} aria-label={value} /> : unavailableValue()} valueTone={row.amount ? "default" : "muted"} valueContext={row.collateral.length ? row.wallet ? "Includes collateral" : "Collateral" : unreadable || reason === "Value unavailable" ? undefined : reason} onActivate={() => onOpenAsset(row.key)} activateLabel={`Open ${row.holding.name.trim() || row.holding.symbol.trim()}`} chevron />;
      })}</ul>{visibleCount < rows.length ? <><span role="status" className="sr-only">Showing {visibleCount} of {rows.length} investments</span><div ref={sentinel} aria-hidden="true" /></> : null}</>}
    </CardContent></Card></section> : null}
  </div>;
}
