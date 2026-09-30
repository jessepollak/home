"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import type { UseInvestDiscoverResult } from "@/client/invest/use-invest-discover";
import { PresentationQuoteProvider, presentationQuoteForRegion, usePresentationRegionId } from "@/client/invest/presentation-quote";
import { useMarketPrices } from "@/client/invest/use-market-prices";
import { selectOwnedInvestments, type OwnedInvestment } from "@/shared/balances/owned-investments";
import type { AssetKey, BalancesSnapshot } from "@/shared/balances/types";
import { isRecord } from "@/shared/guards";
import { InvestmentsOverview } from "./investments-overview";
import { OwnedAssetDetail } from "./owned-asset-detail";

export type InvestmentsExperienceProps = {
  holding: AssetKey | null;
  onOpenHolding: (key: AssetKey) => void;
  onCloseHolding: () => void;
  balances: { status: "unavailable" | "loading" | "ready" | "error"; snapshot: BalancesSnapshot | null; refreshError?: true; retry: () => Promise<void> };
  discover: Pick<UseInvestDiscoverResult, "memeAssets" | "memeMarket" | "assetMarkResolution">;
};

const EMPTY_ROWS: OwnedInvestment[] = [];

type Selection = { snapshot: BalancesSnapshot; rows: OwnedInvestment[] };

export function useInvestmentRows(snapshot: BalancesSnapshot | null, enabled: boolean) {
  const [selection, setSelection] = useState<Selection | null>(() => enabled && snapshot
    ? { snapshot, rows: selectOwnedInvestments(snapshot) } : null);
  if ((selection !== null && selection.snapshot !== snapshot) || (selection === null && enabled && snapshot !== null)) {
    const next = enabled && snapshot ? { snapshot, rows: selectOwnedInvestments(snapshot) } : null;
    setSelection(next);
    return next?.rows ?? EMPTY_ROWS;
  }
  return selection?.rows ?? EMPTY_ROWS;
}

function countForHolding(snapshot: BalancesSnapshot | null, holding: AssetKey | null) {
  if (!snapshot || !holding) return 20;
  return Math.max(20, selectOwnedInvestments(snapshot).findIndex((row) => row.key === holding) + 1);
}

const visibleCountHistoryKey = "__homeInvestmentsVisibleCount";

function readVisibleCount(snapshot: BalancesSnapshot | null, holding: AssetKey | null): number {
  const base = countForHolding(snapshot, holding);
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/investments")) return base;
  const state: unknown = window.history.state;
  const saved = isRecord(state) ? state[visibleCountHistoryKey] : null;
  return typeof saved === "number" && Number.isInteger(saved) && saved >= 20
    ? Math.max(base, snapshot ? Math.min(selectOwnedInvestments(snapshot).length, saved) : saved)
    : base;
}

export function InvestmentsExperience({ holding, onOpenHolding, onCloseHolding, balances, discover }: InvestmentsExperienceProps): JSX.Element {
  const active = balances.status === "loading" || (balances.status === "error" && !balances.snapshot) ? null : balances.snapshot;
  const rows = useInvestmentRows(active, holding === null);
  const [visibleCount, setVisibleCount] = useState(() => readVisibleCount(balances.snapshot, holding));
  const [previousHolding, setPreviousHolding] = useState(holding);
  if (previousHolding !== holding) {
    setPreviousHolding(holding);
    if (previousHolding && !holding) setVisibleCount((count) => Math.max(count, rows.findIndex((row) => row.key === previousHolding) + 1));
  }
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setVisibleCount(readVisibleCount(balances.snapshot, holding));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [balances.snapshot, holding]);
  const growVisibleCount = (next: number) => {
    setVisibleCount(next);
    if (window.location.pathname.startsWith("/investments")) {
      window.history.replaceState({ ...window.history.state, [visibleCountHistoryKey]: next }, "");
    }
  };
  const regionId = usePresentationRegionId();
  const { fx, ...markets } = useMarketPrices();
  const quote = useMemo(() => presentationQuoteForRegion(regionId, fx), [regionId, fx]);
  const status = balances.status === "error" ? "failed" : balances.status === "ready" ? "ready" : "loading";
  return <PresentationQuoteProvider value={quote}>
    {holding ? <OwnedAssetDetail snapshot={balances.snapshot} balanceStatus={status} refreshFailed={balances.refreshError} onRetryBalances={() => void balances.retry()} assetKey={holding} catalog={discover.memeAssets} markets={{ ...markets, memeMarket: discover.memeMarket }} assetMarkResolution={discover.assetMarkResolution} onBack={onCloseHolding} />
      : <InvestmentsOverview ownedRows={rows} snapshot={balances.snapshot} balanceStatus={status} refreshFailed={balances.refreshError} visibleCount={visibleCount} onVisibleCountChange={growVisibleCount} onOpenAsset={onOpenHolding} onRetryBalances={() => void balances.retry()} />}
  </PresentationQuoteProvider>;
}
