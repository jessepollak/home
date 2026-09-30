"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";
import type { RegionId } from "@/config/regions";
import {
  presentBalances,
  type BalanceRowModel,
  type BalancesPresentation,
  type HomeBalancesPresentation,
  type MoneyGroupPresentation,
} from "@/shared/balances/present";
import type { BalancesState } from "@/shared/balances/types";
import type { PendingCashoutEstimate } from "@/shared/balances/pending-cashout";
import { BalancesList, BalancesListFallback } from "./balances-list";

const BALANCES_BATCH_SIZE = 10;

const loadingBalances: BalancesPresentation = {
  status: "loading", displayTotal: null, breakdown: [], summary: null,
  groups: [], rows: [], hiddenRows: [], hiddenCount: 0,
};

export function useBalancesPresentation({ state, active, showSmallBalances, pendingCashout, fallback }: {
  state?: BalancesState;
  active: boolean;
  showSmallBalances: boolean;
  pendingCashout?: PendingCashoutEstimate;
  fallback?: HomeBalancesPresentation | BalancesPresentation;
}): BalancesPresentation {
  const status = state?.status;
  const snapshot = state?.snapshot;
  const revalidating = state?.status === "ready" ? state.revalidating : undefined;
  const presentation = useMemo(() => {
    if (!active) return loadingBalances;
    if (!status) return fallback && "groups" in fallback ? fallback : loadingBalances;
    if (status === "ready" && snapshot) {
      return presentBalances({ status, snapshot, error: null }, { showSmallBalances, pendingCashout });
    }
    return presentBalances(status === "error"
      ? { status, snapshot: null, error: "balances-unavailable" }
      : { status: status === "unavailable" ? "unavailable" : "loading", snapshot: null, error: null });
  }, [active, status, snapshot, showSmallBalances, pendingCashout, fallback]);
  return useMemo(() => active && status === "ready" && revalidating
    ? { ...presentation, revalidating } : presentation, [active, status, revalidating, presentation]);
}

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

export function balancesAnchorTopologyKey(presentation: Pick<BalancesPresentation, "groups" | "rows">): string {
  return JSON.stringify({
    groups: presentation.groups.map((group) => group.id),
    rows: presentation.rows.map(({ key, group }) => ({ key, group })),
  });
}

export function useBalancesRevealWindow(
  scope: string | null,
  rows: readonly BalanceRowModel[],
  resetSignal: number,
) {
  const [revealWindow, setRevealWindow] = useState<BalancesRevealWindow>(() => ({
    key: scope ?? "",
    resetSignal,
    count: BALANCES_BATCH_SIZE,
  }));
  const key = scope ?? revealWindow.key;
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
            count: Math.max(
              current.count,
              Math.min(current.count + BALANCES_BATCH_SIZE, rows.length),
            ),
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
  onRetryBalances,
}: {
  active: boolean;
  assetBalances?: BalancesPresentation;
  showSmallBalances: boolean;
  revealSmallBalances: boolean;
  onRevealSmallBalancesChange: (value: boolean) => void;
  isChecking: boolean;
  revealedCount: number;
  onRevealMore: () => void;
  onRetryBalances?: () => void;
}) {
  const isLoading = assetBalances?.status === "loading" || isChecking;
  const balanceStatusLabel = assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" && Boolean(balanceStatusLabel);
  return (
    <section className="space-y-3" aria-label="Your money">
      {showBalanceStatus ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground" data-total-status={assetBalances?.totalStatus}>
            {balanceStatusLabel}
          </p>
          {onRetryBalances && !assetBalances?.needsCountry && (assetBalances?.totalStatus === "partial" || assetBalances?.totalStatus === "unavailable") ? (
            <Button variant="ghost" size="icon" className="size-11" aria-label="Retry balances" onClick={onRetryBalances}>
              <RotateCw aria-hidden="true" />
            </Button>
          ) : null}
        </div>
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
    const closestRoot = sentinel.closest("[data-app-main-authenticated]");
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
    return <BalancesListFallback isLoading={isLoading} isUnavailable={isUnavailable} />;
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
      <GroupedBalancesList groups={visibleGroups} />
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

function GroupedBalancesList({ groups }: { groups: readonly MoneyGroupPresentation[] }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section
          key={group.id}
          id={group.id}
          className="scroll-mt-4"
          data-money-group={group.id}
          aria-labelledby={`panel-${group.id}-heading`}
        >
          <SectionHeader
            variant="group"
            headingId={`panel-${group.id}-heading`}
            label={group.label}
            subtotal={group.subtotal}
          />
          {group.rows.length > 0 ? <BalancesList rows={group.rows} /> : null}
        </section>
      ))}
    </div>
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
