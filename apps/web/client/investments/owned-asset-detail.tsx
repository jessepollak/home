"use client";

import { useMemo } from "react";
import { Lock, Wallet } from "lucide-react";
import { useNestedAppChrome } from "@/components/app-chrome";
import { compactFinancialValue } from "@/components/compact-financial-value";
import { GlyphMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Card, CardContent } from "@/components/ui/card";
import { AssetDetailScreen, AssetDetailStatusScreen, ExactAddressAssetScreen } from "@/client/invest/asset-detail-screen";
import { marketForAsset } from "@/client/invest/discover";
import type { PricedInvestMarketProps } from "@/client/invest/use-market-prices";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { addFractions, exactDecimalToFraction, roundFractionPreservingPositive } from "@/shared/balances/math";
import { selectOwnedInvestment, type OwnedInvestment } from "@/shared/balances/owned-investments";
import type { AssetKey, BalancesSnapshot } from "@/shared/balances/types";
import { matchesMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { buyRouteForToken } from "@/shared/trading/assets";
import { amountLabel, holdingsQuantity, ownedQuantity, quantity } from "./investments-overview";
import { BalancesCantLoad } from "@/client/balances/balances-cant-load";

export type OwnedAssetDetailProps = {
  snapshot: BalancesSnapshot | null;
  balanceStatus: "ready" | "loading" | "failed";
  onRetryBalances: () => void;
  assetKey: AssetKey;
  catalog: readonly InvestAsset[];
  markets: Pick<PricedInvestMarketProps, "stockMarket" | "memeMarket" | "cryptoMarket">;
  assetMarkResolution: AssetMarkResolution;
  onBack: () => void;
};

export function OwnedAssetDetail({ snapshot, balanceStatus, onRetryBalances, assetKey, catalog, markets, assetMarkResolution, onBack }: OwnedAssetDetailProps) {
  const row = useMemo(() => snapshot ? selectOwnedInvestment(snapshot, assetKey) : null, [snapshot, assetKey]);
  useNestedAppChrome({ title: row?.holding.name.trim() || row?.holding.symbol.trim() || "Asset details", backLabel: "Back", onBack });
  if (balanceStatus === "loading" && !snapshot) return <AssetDetailStatusScreen status="loading" onBack={onBack} />;
  if (!snapshot) return <BalancesCantLoad onRetry={onRetryBalances} />;
  if (!row) return <AssetDetailStatusScreen status="unavailable" onBack={onBack} />;
  const name = row.holding.name.trim() || row.holding.symbol.trim();
  const address = row.holding.contractAddress?.toLowerCase();
  const asset = catalog.find((item) => item.contractAddress.toLowerCase() === address && matchesMarketPriceAssetIdentity(item))
    ?? investAssets.find((item) => item.contractAddress.toLowerCase() === address);
  const card = <OwnedBalanceCard row={row} snapshot={snapshot} />;
  if (asset) return <AssetDetailScreen asset={asset} market={marketForAsset(asset, markets)} assetMarkResolution={assetMarkResolution} onBack={onBack} ownership={card} />;
  const exactAssetId = address ? buyRouteForToken({ chainId: snapshot.owner.chainId, address }) : null;
  if (exactAssetId) return <ExactAddressAssetScreen assetId={exactAssetId} name={name} onBack={onBack} ownership={card} />;
  return <section className="flex w-full flex-col gap-4 overflow-x-clip" aria-label={`${name} details`}>
    {card}<p className="text-sm text-muted-foreground">Trading isn&apos;t available for this asset.</p>
  </section>;
}

export function OwnedBalanceCard({ row, snapshot }: { row: OwnedInvestment; snapshot: BalancesSnapshot }) {
  const available = row.wallet ?? row.availableZero;
  const collateralValues = row.collateral.flatMap((item) => item.value.status === "priced" ? [exactDecimalToFraction(item.value.amount)] : []);
  const collateralAmount = collateralValues.length ? roundFractionPreservingPositive(addFractions(collateralValues)) : null;
  const quantityLabel = ownedQuantity(row, snapshot, true);
  return <Card><CardContent inset="hero"><div className="@container space-y-2">
    <p className="text-sm text-muted-foreground">Your balance</p>
    <div className={`text-xl @2xs:text-2xl font-semibold tabular-nums ${row.amount ? "" : "text-muted-foreground"}`}>{row.amount ? <MoneyTicker align="start" reserveDigits={false} animated={false} value={compactFinancialValue(amountLabel(row.amount, snapshot))} aria-label={amountLabel(row.amount, snapshot)} /> : quantityLabel}</div>
    {row.amount ? <p className="text-sm text-muted-foreground">{quantityLabel}</p> : null}
    {row.collateral.length ? <ul className="list-none p-0">
      {available ? <BalanceRow icon={<GlyphMark size="sm"><Wallet /></GlyphMark>} label="Available" context={available.value.status === "priced" ? quantity(available, snapshot) : undefined} value={available.value.status === "priced" ? <MoneyTicker animated={false} value={amountLabel(available.value.amount, snapshot)} /> : quantity(available, snapshot)} valueTone={available.value.status === "priced" ? "default" : "muted"} chevron={false} /> : null}
      <BalanceRow icon={<GlyphMark size="sm"><Lock /></GlyphMark>} label="Collateral" context={collateralAmount ? holdingsQuantity(row.collateral, row.holding, snapshot) : undefined} value={collateralAmount ? <MoneyTicker animated={false} value={amountLabel(collateralAmount, snapshot)} /> : holdingsQuantity(row.collateral, row.holding, snapshot)} valueTone={collateralAmount ? "default" : "muted"} chevron={false} />
    </ul> : null}
  </div></CardContent></Card>;
}
