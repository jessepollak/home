"use client";

import { compactFinancialValue } from "@/components/compact-financial-value";
import { CurrencyMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import type { BalanceRowModel } from "@/shared/balances/present";
import { ShimmerRows } from "./panel-shared";

export function BalancesList({ rows }: { rows: readonly BalanceRowModel[] }) {
  return (
    <ul className="list-none p-0" data-balance-list="">
      {rows.map((row) => <HomeBalanceRowView key={row.key} row={row} />)}
    </ul>
  );
}

export function BalancesListFallback({
  isLoading,
  isUnavailable,
}: {
  isLoading: boolean;
  isUnavailable: boolean;
}) {
  if (isLoading) return <ShimmerRows count={2} />;
  if (isUnavailable) return null;
  return <BalancesEmpty />;
}

export function BalancesEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No money yet</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

export function HomeBalanceRowView({ row }: { row: BalanceRowModel }) {
  const symbolMark = row.mark.kind === "symbol"
    ? presentPortfolioAssetMark({
        assetKey: row.key,
        name: row.name,
        symbol: row.mark.symbol,
        currency: null,
      })
    : null;
  const icon = row.mark.kind === "flag"
    ? <CurrencyMark currency={row.mark.currency} size="sm" />
    : row.mark.kind === "image"
      ? <CurrencyMark assetKey={row.key} src={row.mark.url} symbol={row.mark.fallbackSymbol} size="sm" />
      : row.mark.kind === "eth"
        ? <CurrencyMark assetKey={row.key} symbol="ETH" size="sm" />
        : (
            <CurrencyMark
              assetKey={row.key}
              src={symbolMark?.imageUrl}
              symbol={symbolMark?.symbol}
              pending={symbolMark?.pending}
              size="sm"
            />
          );
  return (
    <BalanceRow
      icon={icon}
      iconTone="mark"
      label={row.name}
      context={row.secondary ?? undefined}
      value={
        <MoneyTicker
          value={compactFinancialValue(row.primary)}
          aria-label={row.primary}
          reserveDigits={false}
        />
      }
      valueTone={row.tone}
    />
  );
}
