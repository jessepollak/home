"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { MoneyTicker } from "@/components/money-ticker";
import { CurrencyMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import {
  presentPortfolioAssetMark,
  type AssetMarkResolution,
} from "@/client/asset-mark/presentation";
import type { RegionId } from "@/config/regions";
import type { BalanceRowModel, BalancesPresentation } from "@/shared/balances/present";
import { ShimmerRows } from "./panel-shared";

const BALANCES_BATCH_SIZE = 10;

type BalancesRevealWindow = {
  key: string;
  resetSignal: number;
  count: number;
};

export function clampHomeScrollTop(main: HTMLElement | null, top: number): number {
  if (!main || top <= 0) return Math.max(0, top);
  const maxTop = Math.max(0, main.scrollHeight - main.clientHeight);
  return maxTop > 0 ? Math.min(top, maxTop) : top;
}

export function homeBalancesRestoreScope(input: {
  ownerKey: string | null;
  provider: string | null;
  subject: string | null;
  smartAccount: string | null;
  region: RegionId;
}): string | null {
  const { ownerKey, provider, subject, smartAccount, region } = input;
  if (!ownerKey || !provider || !subject || !smartAccount) return null;
  return `${ownerKey}\u0000${provider}\u0000${subject}\u0000${smartAccount.toLowerCase()}\u0000${region}`;
}

export function balancesListKey(rows: readonly BalanceRowModel[]): string {
  return JSON.stringify(rows);
}

export function useBalancesRevealWindow(
  scope: string | null,
  rows: readonly BalanceRowModel[],
  resetSignal: number,
) {
  const [revealWindow, setRevealWindow] = useState<BalancesRevealWindow>(() => {
    const key = `${scope ?? ""}\u0000${balancesListKey(rows)}`;
    return { key, resetSignal, count: BALANCES_BATCH_SIZE };
  });
  const key = `${scope ?? ""}\u0000${balancesListKey(rows)}`;
  if (revealWindow.key !== key || revealWindow.resetSignal !== resetSignal) {
    setRevealWindow({ key, resetSignal, count: BALANCES_BATCH_SIZE });
  }

  const count = Math.min(revealWindow.count, rows.length);
  const extend = useCallback(() => {
    setRevealWindow((current) =>
      current.key === key && current.resetSignal === resetSignal
        ? {
            key,
            resetSignal: current.resetSignal,
            count: Math.min(current.count + BALANCES_BATCH_SIZE, rows.length),
          }
        : current,
    );
  }, [key, resetSignal, rows.length]);

  return { count, extend };
}

export function BalancesPage({
  active,
  assetBalances,
  assetMarkResolution,
  isChecking,
  revealedCount,
  onRevealMore,
}: {
  active: boolean;
  assetBalances?: BalancesPresentation;
  assetMarkResolution?: AssetMarkResolution;
  isChecking: boolean;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const isLoading = assetBalances?.status === "loading" || isChecking;
  const balanceStatusLabel =
    assetBalances?.totalStatus === "partial" ? undefined : assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" && Boolean(balanceStatusLabel);
  return (
    <section className="space-y-3" aria-label="Balances">
      {showBalanceStatus ? (
        <p className="text-sm text-muted-foreground" data-total-status={assetBalances?.totalStatus}>
          {balanceStatusLabel}
        </p>
      ) : null}
      <Card>
        <CardContent className="px-2">
          <IncrementalBalancesList
            active={active}
            rows={assetBalances?.rows ?? []}
            isLoading={isLoading}
            isUnavailable={assetBalances?.status === "unavailable"}
            assetMarkResolution={assetMarkResolution}
            revealedCount={revealedCount}
            onRevealMore={onRevealMore}
          />
        </CardContent>
      </Card>
    </section>
  );
}

export function HomeBalancesList({
  rows,
  isLoading,
  isUnavailable = false,
  assetMarkResolution,
}: {
  rows: readonly BalanceRowModel[];
  isLoading: boolean;
  isUnavailable?: boolean;
  assetMarkResolution?: AssetMarkResolution;
}) {
  if (rows.length > 0) {
    return <BalancesList rows={rows} assetMarkResolution={assetMarkResolution} />;
  }
  if (isLoading) return <ShimmerRows count={2} />;
  if (isUnavailable) return null;
  return <BalancesEmpty />;
}

function IncrementalBalancesList({
  active,
  rows,
  isLoading,
  isUnavailable = false,
  assetMarkResolution,
  revealedCount,
  onRevealMore,
}: {
  active: boolean;
  rows: readonly BalanceRowModel[];
  isLoading: boolean;
  isUnavailable?: boolean;
  assetMarkResolution?: AssetMarkResolution;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const count = Math.min(revealedCount, rows.length);
  const hasMore = count < rows.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active || !hasMore || typeof IntersectionObserver === "undefined") return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const closestRoot = sentinel.closest(".app-main-authenticated");
    const root = closestRoot instanceof HTMLElement ? closestRoot : null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onRevealMore();
      },
      { root, rootMargin: "0px 0px 100% 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [active, hasMore, onRevealMore, revealedCount, rows.length]);

  if (rows.length === 0) {
    if (isLoading) return <ShimmerRows count={2} />;
    if (isUnavailable) return null;
    return <BalancesEmpty />;
  }

  return (
    <>
      <BalancesList
        rows={rows.slice(0, count)}
        assetMarkResolution={assetMarkResolution}
      />
      {active && hasMore ? (
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
      ) : null}
    </>
  );
}

function BalancesList({
  rows,
  assetMarkResolution,
}: {
  rows: readonly BalanceRowModel[];
  assetMarkResolution?: AssetMarkResolution;
}) {
  return (
    <ItemGroup className="gap-0">
      <ul className="list-none p-0" data-balance-list="">
        {rows.map((row) => (
          <HomeBalanceRowView
            key={row.key}
            row={row}
            assetMarkResolution={assetMarkResolution}
          />
        ))}
      </ul>
    </ItemGroup>
  );
}

function BalancesEmpty() {
  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyTitle>No balances yet</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

export function HomeBalanceRowView({
  row,
  assetMarkResolution,
}: {
  row: BalanceRowModel;
  assetMarkResolution?: AssetMarkResolution;
}) {
  const symbolMark = row.mark.kind === "symbol"
    ? presentPortfolioAssetMark(
        {
          assetKey: row.key,
          name: row.name,
          symbol: row.mark.symbol,
          currency: null,
        },
        assetMarkResolution,
      )
    : null;
  const icon = row.mark.kind === "flag"
    ? <CurrencyMark currency={row.mark.currency} />
    : row.mark.kind === "image"
      ? <CurrencyMark src={row.mark.url} symbol={row.mark.fallbackSymbol} />
      : row.mark.kind === "eth"
        ? <CurrencyMark symbol="ETH" />
        : (
            <CurrencyMark
              src={symbolMark?.imageUrl}
              symbol={symbolMark?.symbol}
              pending={symbolMark?.pending}
            />
          );
  return (
    <BalanceRow
      icon={icon}
      iconTone="mark"
      label={row.name}
      context={row.secondary ?? undefined}
      value={<MoneyTicker value={row.primary} />}
      valueTone={row.tone}
    />
  );
}
