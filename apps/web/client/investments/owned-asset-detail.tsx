"use client";

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
import type { AssetKey, BalancesSnapshot, Holding } from "@/shared/balances/types";
import { matchesMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { buyRouteForToken } from "@/shared/trading/assets";
import { RefreshFailedNotice, amountLabel, holdingsQuantity, ownedBalanceUnreadable, ownedQuantity, quantity, unavailableValue } from "./investments-overview";

export type OwnedAssetDetailProps = {
  snapshot: BalancesSnapshot | null;
  balanceStatus: "ready" | "loading" | "failed";
  refreshFailed?: boolean;
  onRetryBalances: () => void;
  assetKey: AssetKey;
  catalog: readonly InvestAsset[];
  markets: Pick<PricedInvestMarketProps, "stockMarket" | "memeMarket" | "cryptoMarket">;
  assetMarkResolution: AssetMarkResolution;
  onBack: () => void;
};

export function OwnedAssetDetail({ snapshot, balanceStatus, refreshFailed = false, onRetryBalances, assetKey, catalog, markets, assetMarkResolution, onBack }: OwnedAssetDetailProps) {
  const row = snapshot ? selectOwnedInvestment(snapshot, assetKey) : null;
  useNestedAppChrome({ title: row?.holding.name.trim() || row?.holding.symbol.trim() || "Asset details", backLabel: "Back", onBack });
  if (balanceStatus === "loading" && !snapshot) return <AssetDetailStatusScreen status="loading" onBack={onBack} />;
  if (!snapshot || !row) return <AssetDetailStatusScreen status="unavailable" onBack={onBack} />;
  const name = row.holding.name.trim() || row.holding.symbol.trim();
  const address = row.holding.contractAddress?.toLowerCase();
  const asset = catalog.find((item) => item.contractAddress.toLowerCase() === address && matchesMarketPriceAssetIdentity(item))
    ?? investAssets.find((item) => item.contractAddress.toLowerCase() === address);
  const card = <OwnedBalanceCard row={row} snapshot={snapshot} refreshFailed={refreshFailed} onRetryBalances={onRetryBalances} />;
  if (asset) return <AssetDetailScreen asset={asset} market={marketForAsset(asset, markets)} assetMarkResolution={assetMarkResolution} onBack={onBack} ownership={card} />;
  const exactAssetId = address ? buyRouteForToken({ chainId: snapshot.owner.chainId, address }) : null;
  if (exactAssetId) return <ExactAddressAssetScreen assetId={exactAssetId} name={name} onBack={onBack} ownership={card} />;
  return <section className="flex w-full flex-col gap-4 overflow-x-clip" aria-label={`${name} details`}>
    {card}<p className="text-sm text-muted-foreground">Trading isn&apos;t available for this asset.</p>
  </section>;
}

function OwnedBalanceCard({ row, snapshot, refreshFailed, onRetryBalances }: { row: OwnedInvestment; snapshot: BalancesSnapshot; refreshFailed: boolean; onRetryBalances: () => void }) {
  const availableIsZero = !!row.availableZero || (!row.wallet && snapshot.coverage.registry === "complete" && snapshot.coverage.catalog === "complete");
  const availableValue = row.wallet?.balance.status === "ready" && row.wallet.value.status === "priced";
  const collateralPriced = row.collateral.every((item) => item.value.status === "priced");
  const unreadable = ownedBalanceUnreadable(row);
  const walletUnreadable = row.wallet?.balance.status === "unavailable";
  return <Card><CardContent inset="hero"><div className="@container space-y-2">
    <p className="text-sm text-muted-foreground">Your balance</p>
    <div className="text-xl @2xs:text-2xl font-semibold tabular-nums">{unreadable ? <span className="text-muted-foreground">Unavailable</span> : row.amount ? <MoneyTicker align="start" reserveDigits={false} animated={false} value={compactFinancialValue(amountLabel(row.amount, snapshot))} aria-label={amountLabel(row.amount, snapshot)} /> : unavailableValue()}</div>
    {!unreadable ? <p className="text-sm text-muted-foreground">{ownedQuantity(row, snapshot, true)}</p> : null}
    {refreshFailed ? <RefreshFailedNotice onRetry={onRetryBalances} /> : null}
    {row.collateral.length ? <ul className="list-none p-0"><BalanceRow icon={<GlyphMark size="sm"><Wallet /></GlyphMark>} label="Available" context={walletUnreadable ? undefined : row.wallet ? quantity(row.wallet, snapshot) : row.availableZero ? quantity(row.availableZero, snapshot) : availableIsZero ? `0 ${row.holding.symbol}` : "Balance unavailable"} value={walletUnreadable ? "Unavailable" : availableValue ? <MoneyTicker animated={false} value={amountLabel((row.wallet!.value as Extract<Holding["value"], { status: "priced" }>).amount, snapshot)} /> : availableIsZero ? <MoneyTicker animated={false} value={amountLabel({ atoms: "0", scale: 2 }, snapshot)} /> : unavailableValue()} valueTone={availableValue || availableIsZero ? "default" : "muted"} chevron={false} /><BalanceRow icon={<GlyphMark size="sm"><Lock /></GlyphMark>} label="Collateral" context={holdingsQuantity(row.collateral, row.holding, snapshot)} value={collateralPriced ? <MoneyTicker animated={false} value={amountLabel(roundFractionPreservingPositive(addFractions(row.collateral.map((item) => exactDecimalToFraction((item.value as Extract<Holding["value"], { status: "priced" }>).amount)))), snapshot)} /> : unavailableValue()} valueTone={collateralPriced ? "default" : "muted"} chevron={false} /></ul> : null}
  </div></CardContent></Card>;
}
