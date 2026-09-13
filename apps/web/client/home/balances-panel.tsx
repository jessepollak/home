"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
        ? { key, resetSignal, count: Math.min(current.count + BALANCES_BATCH_SIZE, rows.length) }
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
  const balanceStatusLabel = assetBalances?.totalStatus === "partial" ? undefined : assetBalances?.statusLabel;
  return (
    <section className="balances-panel nested-home-panel" aria-label="Balances">
      {assetBalances?.status !== "loading" && balanceStatusLabel ? (
        <p className="balance-status balance-status-panel text-metadata" data-total-status={assetBalances?.totalStatus}>
          {balanceStatusLabel}
        </p>
      ) : null}
      <IncrementalBalancesList
        active={active}
        rows={assetBalances?.rows ?? []}
        assetMarkResolution={assetMarkResolution}
        isLoading={isLoading}
        isUnavailable={assetBalances?.status === "unavailable"}
        revealedCount={revealedCount}
        onRevealMore={onRevealMore}
      />
    </section>
  );
}

export function HomeBalancesList({
  rows,
  assetMarkResolution,
  isLoading,
  isUnavailable = false,
}: {
  rows: readonly BalanceRowModel[];
  assetMarkResolution?: AssetMarkResolution;
  isLoading: boolean;
  isUnavailable?: boolean;
}) {
  if (rows.length > 0) {
    return (
      <ul className="supplied-asset-list">
        {rows.map((row) => (
          <HomeBalanceRowView
            key={row.key}
            row={row}
            assetMarkResolution={assetMarkResolution}
          />
        ))}
      </ul>
    );
  }
  if (isLoading) return <ShimmerRows count={2} />;
  if (isUnavailable) return null;
  return <p className="balances-empty text-metadata">No balances yet</p>;
}

function IncrementalBalancesList({
  active,
  rows,
  assetMarkResolution,
  isLoading,
  isUnavailable = false,
  revealedCount,
  onRevealMore,
}: {
  active: boolean;
  rows: readonly BalanceRowModel[];
  assetMarkResolution?: AssetMarkResolution;
  isLoading: boolean;
  isUnavailable?: boolean;
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
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) onRevealMore(); },
      { rootMargin: "0px 0px 40% 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [active, hasMore, onRevealMore, revealedCount, rows.length]);

  if (rows.length === 0) {
    if (isLoading) return <ShimmerRows count={2} />;
    if (isUnavailable) return null;
    return <p className="balances-empty text-metadata">No balances yet</p>;
  }

  return (
    <>
      <ul className="supplied-asset-list">
        {rows.slice(0, count).map((row) => (
          <HomeBalanceRowView
            key={row.key}
            row={row}
            assetMarkResolution={assetMarkResolution}
          />
        ))}
      </ul>
      {active && hasMore ? <div ref={sentinelRef} className="balances-sentinel" aria-hidden="true" /> : null}
    </>
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
