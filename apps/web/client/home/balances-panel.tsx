"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import { CurrencyMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import {
  presentHomeBalanceMark,
  presentHomeBalanceRow,
} from "@/client/portfolio";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { RegionId } from "@/config/regions";
import type {
  HomeAssetBalanceItem,
  HomeAssetBalancesPresentation,
} from "./home-types";
import { ShimmerRows } from "./panel-shared";

const BALANCES_BATCH_SIZE = 10;

type BalancesRevealWindow = {
  key: string;
  resetSignal: number;
  count: number;
};

export function clampHomeScrollTop(
  main: HTMLElement | null,
  top: number,
): number {
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

export function balancesListKey(
  items: readonly HomeAssetBalanceItem[],
): string {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      assetKey: item.assetKey ?? null,
      group: item.group ?? null,
      name: item.name,
      detail: item.detail ?? null,
      displayBalance: item.displayBalance,
      displayContext: item.displayContext ?? null,
      currencyCode: item.currencyCode ?? null,
      tone: item.tone ?? null,
    })),
  );
}

export function useBalancesRevealWindow(
  scope: string | null,
  items: readonly HomeAssetBalanceItem[],
  resetSignal: number,
) {
  const [revealWindow, setRevealWindow] = useState<BalancesRevealWindow>(() => {
    const key = `${scope ?? ""}\u0000${balancesListKey(items)}`;
    return { key, resetSignal, count: BALANCES_BATCH_SIZE };
  });
  const key = `${scope ?? ""}\u0000${balancesListKey(items)}`;
  if (revealWindow.key !== key || revealWindow.resetSignal !== resetSignal) {
    setRevealWindow({ key, resetSignal, count: BALANCES_BATCH_SIZE });
  }

  const count = Math.min(revealWindow.count, items.length);
  const extend = useCallback(() => {
    setRevealWindow((current) =>
      current.key === key && current.resetSignal === resetSignal
        ? {
            key,
            resetSignal: current.resetSignal,
            count: Math.min(current.count + BALANCES_BATCH_SIZE, items.length),
          }
        : current,
    );
  }, [key, items.length, resetSignal]);

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
  assetBalances?: HomeAssetBalancesPresentation;
  assetMarkResolution?: AssetMarkResolution;
  isChecking: boolean;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const isLoading = assetBalances?.status === "loading" || isChecking;
  const balanceStatusLabel =
    assetBalances?.totalStatus === "partial" ? undefined : assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" &&
    balanceStatusLabel !== "Updating…" &&
    Boolean(balanceStatusLabel);
  return (
    <section className="balances-panel nested-home-panel" aria-label="Balances">
      {showBalanceStatus ? (
        <Text
          textStyle="metadata"
          className="balance-status balance-status-panel"
          data-total-status={assetBalances?.totalStatus}
        >
          {balanceStatusLabel}
        </Text>
      ) : null}
      <IncrementalBalancesList
        active={active}
        items={assetBalances?.items ?? []}
        isLoading={isLoading}
        isUnavailable={assetBalances?.status === "unavailable"}
        assetMarkResolution={assetMarkResolution}
        revealedCount={revealedCount}
        onRevealMore={onRevealMore}
      />
    </section>
  );
}

export function HomeBalancesList({
  items,
  isLoading,
  isUnavailable = false,
  assetMarkResolution,
}: {
  items: readonly HomeAssetBalanceItem[];
  isLoading: boolean;
  isUnavailable?: boolean;
  assetMarkResolution?: AssetMarkResolution;
}) {
  if (items.length > 0) {
    return (
      <ul className="supplied-asset-list">
        {items.map((asset) => (
          <HomeBalanceRowView
            key={asset.id}
            asset={asset}
            assetMarkResolution={assetMarkResolution}
          />
        ))}
      </ul>
    );
  }
  if (isLoading) return <ShimmerRows count={2} />;
  if (isUnavailable) return null;
  return <Text textStyle="metadata" className="balances-empty">No balances yet</Text>;
}

function IncrementalBalancesList({
  active,
  items,
  isLoading,
  isUnavailable = false,
  assetMarkResolution,
  revealedCount,
  onRevealMore,
}: {
  active: boolean;
  items: readonly HomeAssetBalanceItem[];
  isLoading: boolean;
  isUnavailable?: boolean;
  assetMarkResolution?: AssetMarkResolution;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const count = Math.min(revealedCount, items.length);
  const hasMore = count < items.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active || !hasMore || typeof IntersectionObserver === "undefined") return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onRevealMore();
      },
      { rootMargin: "0px 0px 40% 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [active, revealedCount, items.length, hasMore, onRevealMore]);

  if (items.length === 0) {
    if (isLoading) return <ShimmerRows count={2} />;
    if (isUnavailable) return null;
    return <Text textStyle="metadata" className="balances-empty">No balances yet</Text>;
  }

  return (
    <>
      <ul className="supplied-asset-list">
        {items.slice(0, count).map((asset) => (
          <HomeBalanceRowView
            key={asset.id}
            asset={asset}
            assetMarkResolution={assetMarkResolution}
          />
        ))}
      </ul>
      {active && hasMore ? (
        <div ref={sentinelRef} className="balances-sentinel" aria-hidden="true" />
      ) : null}
    </>
  );
}

function HomeBalanceRowView({
  asset,
  assetMarkResolution,
}: {
  asset: HomeAssetBalanceItem;
  assetMarkResolution?: AssetMarkResolution;
}) {
  if (asset.displayContext === "Updating…") {
    return (
      <li className="shimmer-row" data-shimmer="row">
        <CurrencyMark pending />
        <span className="shimmer-identity">
          <span className="shimmer shimmer-line shimmer-line-wide" aria-hidden="true" />
          <span className="shimmer shimmer-line shimmer-line-narrow" aria-hidden="true" />
        </span>
        <span className="shimmer shimmer-pill" aria-hidden="true" />
        <span className="sr-status">Updating…</span>
      </li>
    );
  }

  const row = presentHomeBalanceRow(asset);
  const mark = presentHomeBalanceMark(asset, assetMarkResolution);
  return (
    <BalanceRow
      icon={
        <CurrencyMark
          currency={mark.currency}
          symbol={mark.symbol}
          src={mark.imageUrl}
          pending={mark.pending}
        />
      }
      iconTone="mark"
      label={asset.name}
      context={asset.displayContext}
      value={
        <MoneyTicker
          value={row.visualBalance}
          aria-label={row.accessibleBalance}
          title={row.accessibleBalance}
        />
      }
      valueTone={row.tone}
    />
  );
}
