"use client";

import { useMemo, useState, type JSX } from "react";
import type { UseInvestDiscoverResult } from "@/client/invest/use-invest-discover";
import { PresentationQuoteProvider, presentationQuoteForRegion, usePresentationRegionId } from "@/client/invest/presentation-quote";
import { useMarketPrices } from "@/client/invest/use-market-prices";
import { selectOwnedInvestments } from "@/shared/balances/owned-investments";
import type { AssetKey, BalancesSnapshot } from "@/shared/balances/types";
import { InvestmentsOverview } from "./investments-overview";
import { OwnedAssetDetail } from "./owned-asset-detail";

export type InvestmentsExperienceProps = {
  holding: AssetKey | null;
  onOpenHolding: (key: AssetKey) => void;
  onCloseHolding: () => void;
  balances: { status: "unavailable" | "loading" | "ready" | "error"; snapshot: BalancesSnapshot | null; refreshError?: true; retry: () => Promise<void> };
  discover: Pick<UseInvestDiscoverResult, "memeAssets" | "memeMarket" | "assetMarkResolution">;
};

function countForHolding(snapshot: BalancesSnapshot | null, holding: AssetKey | null) {
  if (!snapshot || !holding) return 20;
  return Math.max(20, selectOwnedInvestments(snapshot).findIndex((row) => row.key === holding) + 1);
}

export function InvestmentsExperience({ holding, onOpenHolding, onCloseHolding, balances, discover }: InvestmentsExperienceProps): JSX.Element {
  const [visibleCount, setVisibleCount] = useState(() => countForHolding(balances.snapshot, holding));
  const [previousHolding, setPreviousHolding] = useState(holding);
  if (previousHolding !== holding) {
    setPreviousHolding(holding);
    if (previousHolding && !holding) setVisibleCount((count) => Math.max(count, countForHolding(balances.snapshot, previousHolding)));
  }
  const regionId = usePresentationRegionId();
  const { fx, ...markets } = useMarketPrices();
  const quote = useMemo(() => presentationQuoteForRegion(regionId, fx), [regionId, fx]);
  const status = balances.status === "error" ? "failed" : balances.status === "ready" ? "ready" : "loading";
  return <PresentationQuoteProvider value={quote}>
    {holding ? <OwnedAssetDetail snapshot={balances.snapshot} balanceStatus={status} refreshFailed={balances.refreshError} onRetryBalances={() => void balances.retry()} assetKey={holding} catalog={discover.memeAssets} markets={{ ...markets, memeMarket: discover.memeMarket }} assetMarkResolution={discover.assetMarkResolution} onBack={onCloseHolding} />
      : <InvestmentsOverview snapshot={balances.snapshot} balanceStatus={status} refreshFailed={balances.refreshError} visibleCount={visibleCount} onVisibleCountChange={setVisibleCount} onOpenAsset={onOpenHolding} onRetryBalances={() => void balances.retry()} />}
  </PresentationQuoteProvider>;
}
