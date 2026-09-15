"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { MoneyTicker } from "@/components/money-ticker";
import { CurrencyMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import type { RegionId } from "@/config/regions";
import {
  HOME_MONEY_GROUP_PREVIEW_COUNT,
  type BalanceRowModel,
  type BalancesPresentation,
  type MoneyGroupPresentation,
} from "@/shared/balances/present";
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
  showSmallBalances,
  revealSmallBalances,
  onRevealSmallBalancesChange,
  isChecking,
  revealedCount,
  onRevealMore,
}: {
  active: boolean;
  assetBalances?: BalancesPresentation;
  showSmallBalances: boolean;
  revealSmallBalances: boolean;
  onRevealSmallBalancesChange: (value: boolean) => void;
  isChecking: boolean;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const isLoading = assetBalances?.status === "loading" || isChecking;
  const balanceStatusLabel = assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" && Boolean(balanceStatusLabel);
  return (
    <section className="space-y-3" aria-label="Your money">
      {showBalanceStatus ? (
        <p className="text-sm text-muted-foreground" data-total-status={assetBalances?.totalStatus}>
          {balanceStatusLabel}
        </p>
      ) : null}
      <Card>
        <CardContent inset="list">
          <IncrementalBalancesList
            active={active}
            groups={assetBalances?.groups ?? []}
            isLoading={isLoading}
            isUnavailable={assetBalances?.status === "unavailable"}
            hiddenCount={assetBalances?.hiddenCount ?? 0}
            showSmallBalances={showSmallBalances}
            revealSmallBalances={revealSmallBalances}
            onRevealSmallBalancesChange={onRevealSmallBalancesChange}
            revealedCount={revealedCount}
            onRevealMore={onRevealMore}
          />
        </CardContent>
      </Card>
    </section>
  );
}

export function HomeMoneyGroups({
  groups,
  hiddenRows = [],
  isLoading,
  isUnavailable = false,
  onOpenGroup,
}: {
  groups: readonly MoneyGroupPresentation[];
  hiddenRows?: readonly BalanceRowModel[];
  isLoading: boolean;
  isUnavailable?: boolean;
  onOpenGroup: (group: MoneyGroupPresentation["id"]) => void;
}) {
  if (groups.length > 0) {
    // Preview each group the snapshot presents; hidden dust rows never reach Home, and an absent
    // group (no investments yet) stays hidden rather than showing a header and a More row.
    const hiddenKeys = new Set(hiddenRows.map((row) => row.key));
    const previewGroups = groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => !hiddenKeys.has(row.key)),
      }))
      .filter((group) => group.id === "cash" || group.rows.length > 0);
    return (
      <GroupedBalancesList
        groups={previewGroups.map((group) => ({
          ...group,
          rows: group.rows.slice(0, HOME_MONEY_GROUP_PREVIEW_COUNT),
        }))}
        moreGroups={new Set(previewGroups.map((group) => group.id))}
        onOpenGroup={onOpenGroup}
      />
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-4">
        <LoadingMoneyGroup label="Cash" />
        <LoadingMoneyGroup label="Investments" />
      </div>
    );
  }
  if (isUnavailable) return null;
  return <BalancesEmpty />;
}

/** Kept as the single-row-list boundary used by focused row behavior tests. */
export function HomeBalancesList({
  rows,
  isLoading,
  isUnavailable = false,
}: {
  rows: readonly BalanceRowModel[];
  isLoading: boolean;
  isUnavailable?: boolean;
}) {
  if (rows.length > 0) {
    return <BalancesList rows={rows} />;
  }
  if (isLoading) return <ShimmerRows count={2} />;
  if (isUnavailable) return null;
  return <BalancesEmpty />;
}

function IncrementalBalancesList({
  active,
  groups,
  isLoading,
  isUnavailable = false,
  hiddenCount,
  showSmallBalances,
  revealSmallBalances,
  onRevealSmallBalancesChange,
  revealedCount,
  onRevealMore,
}: {
  active: boolean;
  groups: readonly MoneyGroupPresentation[];
  isLoading: boolean;
  isUnavailable?: boolean;
  hiddenCount: number;
  showSmallBalances: boolean;
  revealSmallBalances: boolean;
  onRevealSmallBalancesChange: (value: boolean) => void;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const rowCount = groups.reduce((count, group) => count + group.rows.length, 0);
  const count = Math.min(revealedCount, rowCount);
  const hasMore = count < rowCount;
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
  }, [active, hasMore, onRevealMore, revealedCount, rowCount]);

  if (rowCount === 0) {
    if (isLoading) return <ShimmerRows count={2} />;
    if (isUnavailable) return null;
    return <BalancesEmpty />;
  }

  const visibleGroups = groups.map((group, index) => {
    const priorRowCount = groups
      .slice(0, index)
      .reduce((total, prior) => total + prior.rows.length, 0);
    const remaining = Math.max(0, count - priorRowCount);
    return { ...group, rows: group.rows.slice(0, remaining) };
  });

  return (
    <>
      <GroupedBalancesList groups={visibleGroups} withAnchors />
      {!hasMore && !showSmallBalances && hiddenCount > 0 ? (
        <SmallBalancesControl
          hiddenCount={hiddenCount}
          revealSmallBalances={revealSmallBalances}
          onRevealSmallBalancesChange={onRevealSmallBalancesChange}
        />
      ) : null}
      {active && hasMore ? (
        <div
          ref={sentinelRef}
          className="h-px"
          data-balances-sentinel=""
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

function GroupedBalancesList({
  groups,
  moreGroups = new Set(),
  onOpenGroup,
  withAnchors = false,
}: {
  groups: readonly MoneyGroupPresentation[];
  moreGroups?: ReadonlySet<MoneyGroupPresentation["id"]>;
  onOpenGroup?: (group: MoneyGroupPresentation["id"]) => void;
  withAnchors?: boolean;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section
          key={group.id}
          id={withAnchors ? group.id : undefined}
          className="scroll-mt-4"
          data-money-group={group.id}
          aria-labelledby={`${withAnchors ? "panel" : "home"}-${group.id}-heading`}
        >
          <MoneyGroupHeader
            id={`${withAnchors ? "panel" : "home"}-${group.id}-heading`}
            label={group.label}
            subtotal={group.displaySubtotal}
          />
          {group.rows.length > 0 ? <BalancesList rows={group.rows} /> : null}
          {moreGroups.has(group.id) && onOpenGroup ? (
            <Item
              render={<Button type="button" variant="ghost" />}
              size="sm"
              className="min-h-10 flex-nowrap text-left"
              onClick={() => onOpenGroup(group.id)}
              aria-label={`More ${group.label}`}
            >
              <ItemContent>
                <ItemTitle tone="muted">More</ItemTitle>
              </ItemContent>
              <ItemActions aria-hidden="true">
                <ChevronRight className="size-4 text-muted-foreground" />
              </ItemActions>
            </Item>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function MoneyGroupHeader({
  id,
  label,
  subtotal,
}: {
  id: string;
  label: string;
  subtotal: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
      <h3 id={id}>{label}</h3>
      {subtotal ? (
        <MoneyTicker
          className="text-right tracking-normal normal-case"
          value={subtotal}
          reserveDigits={false}
        />
      ) : null}
    </div>
  );
}

function LoadingMoneyGroup({ label }: { label: string }) {
  return (
    <section aria-busy="true">
      <MoneyGroupHeader id={`loading-${label.toLowerCase()}-heading`} label={label} subtotal={null} />
      <ShimmerRows count={2} />
    </section>
  );
}

function BalancesList({ rows }: { rows: readonly BalanceRowModel[] }) {
  return (
    <ul className="list-none p-0" data-balance-list="">
      {rows.map((row) => <HomeBalanceRowView key={row.key} row={row} />)}
    </ul>
  );
}

function SmallBalancesControl({
  hiddenCount,
  revealSmallBalances,
  onRevealSmallBalancesChange,
}: {
  hiddenCount: number;
  revealSmallBalances: boolean;
  onRevealSmallBalancesChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-16 items-center justify-center px-3 text-sm text-muted-foreground">
      {revealSmallBalances ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRevealSmallBalancesChange(false)}
        >
          Hide small balances
        </Button>
      ) : (
        <p>
          {hiddenCount} small {hiddenCount === 1 ? "balance" : "balances"} hidden ·{" "}
          <Button
            type="button"
            variant="ghost"
            size="inline"
            onClick={() => onRevealSmallBalancesChange(true)}
          >
            Show
          </Button>
        </p>
      )}
    </div>
  );
}

function BalancesEmpty() {
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
    ? presentPortfolioAssetMark(
        {
          assetKey: row.key,
          name: row.name,
          symbol: row.mark.symbol,
          currency: null,
        },
      )
    : null;
  const icon = row.mark.kind === "flag"
    ? <CurrencyMark currency={row.mark.currency} size="sm" />
    : row.mark.kind === "image"
      ? <CurrencyMark src={row.mark.url} symbol={row.mark.fallbackSymbol} size="sm" />
      : row.mark.kind === "eth"
        ? <CurrencyMark symbol="ETH" size="sm" />
        : (
            <CurrencyMark
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
      value={<MoneyTicker value={row.primary} />}
      valueTone={row.tone}
    />
  );
}
