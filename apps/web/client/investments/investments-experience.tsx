"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import type { UseInvestDiscoverResult } from "@/client/invest/use-invest-discover";
import { PresentationQuoteProvider, presentationQuoteForRegion, usePresentationRegionId } from "@/client/invest/presentation-quote";
import { useMarketPrices } from "@/client/invest/use-market-prices";
import { type OwnedInvestment } from "@/shared/balances/owned-investments";
import type { AssetKey, BalancesSnapshot } from "@/shared/balances/types";
import { InvestmentsOverview } from "./investments-overview";
import { OwnedAssetDetail } from "./owned-asset-detail";
import { scheduleInvestmentSelection } from "./selection-task";

export type InvestmentsExperienceProps = {
  holding: AssetKey | null;
  onOpenHolding: (key: AssetKey) => void;
  onCloseHolding: () => void;
  balances: { status: "unavailable" | "loading" | "ready" | "error"; snapshot: BalancesSnapshot | null; refreshError?: true; retry: () => Promise<void> };
  discover: Pick<UseInvestDiscoverResult, "memeAssets" | "memeMarket" | "assetMarkResolution">;
};

const EMPTY_ROWS: OwnedInvestment[] = [];

type Selection = { snapshot: BalancesSnapshot; rows: OwnedInvestment[]; attempt: number; failed: boolean };

export function useInvestmentRows(snapshot: BalancesSnapshot | null, enabled: boolean) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [attempt, setAttempt] = useState(0);
  if (selection && selection.snapshot !== snapshot) setSelection(null);
  const current = selection?.snapshot === snapshot && selection.attempt === attempt ? selection : null;
  useEffect(() => {
    if (!enabled || !snapshot || current) return;
    const controller = new AbortController();
    scheduleInvestmentSelection(snapshot, controller.signal,
      (rows) => setSelection({ snapshot, rows, attempt, failed: false }),
      () => setSelection({ snapshot, rows: EMPTY_ROWS, attempt, failed: true }));
    return () => controller.abort();
  }, [snapshot, enabled, current, attempt]);
  return { rows: current?.rows ?? EMPTY_ROWS, pending: !!snapshot && !current,
    failed: current?.failed ?? false, retry: () => setAttempt((value) => value + 1) };
}

export function InvestmentsExperience({ holding, onOpenHolding, onCloseHolding, balances, discover }: InvestmentsExperienceProps): JSX.Element {
  const active = balances.status === "loading" || (balances.status === "error" && !balances.snapshot) ? null : balances.snapshot;
  const selection = useInvestmentRows(active, holding === null);
  const rows = selection.rows;
  const [returnKey, setReturnKey] = useState<AssetKey | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const [previousHolding, setPreviousHolding] = useState(holding);
  if (previousHolding !== holding) {
    setPreviousHolding(holding);
    setReturnKey(previousHolding && !holding ? previousHolding : null);
  }
  if (returnKey && !selection.pending && !selection.failed) {
    setVisibleCount((count) => Math.max(count, rows.findIndex((row) => row.key === returnKey) + 1));
    setReturnKey(null);
  }
  const regionId = usePresentationRegionId();
  const { fx, ...markets } = useMarketPrices();
  const quote = useMemo(() => presentationQuoteForRegion(regionId, fx), [regionId, fx]);
  const status = balances.status === "error" ? "failed" : balances.status === "ready" ? "ready" : "loading";
  return <PresentationQuoteProvider value={quote}>
    {holding ? <OwnedAssetDetail snapshot={balances.snapshot} balanceStatus={status} refreshFailed={balances.refreshError} onRetryBalances={() => void balances.retry()} assetKey={holding} catalog={discover.memeAssets} markets={{ ...markets, memeMarket: discover.memeMarket }} assetMarkResolution={discover.assetMarkResolution} onBack={onCloseHolding} />
      : <InvestmentsOverview ownedRows={rows} rowsPending={selection.pending} rowsFailed={selection.failed} onRetryRows={selection.retry} snapshot={balances.snapshot} balanceStatus={status} refreshFailed={balances.refreshError} visibleCount={Math.max(visibleCount, returnKey ? rows.findIndex((row) => row.key === returnKey) + 1 : 0)} onVisibleCountChange={setVisibleCount} onOpenAsset={onOpenHolding} onRetryBalances={() => void balances.retry()} />}
  </PresentationQuoteProvider>;
}
