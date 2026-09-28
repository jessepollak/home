"use client";

import { isServerVerified, useOptionalAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { useBalances } from "@/client/balances";
import { presentInvestAssetMark, type AssetMarkResolution } from "@/client/asset-mark/presentation";
import { BalanceRow } from "@/components/finance-rows";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvestAsset } from "@/config/invest-assets";
import { investAssets } from "@/config/invest-assets";
import { formatExactPresentationTokenAmount, formatFiatAmount } from "@/shared/formatting";
import type { Holding } from "@/shared/balances/types";
import { holdingValueContext } from "@/shared/balances/value-label";
import { AssetIcon } from "./asset-icon";
import { usePresentationRegionId } from "./presentation-quote";

const unavailableBalances: AccountWalletClient["fetchBalances"] = async () => { throw new Error("Account unavailable"); };

export function findAssetHolding(holdings: readonly Holding[], asset: InvestAsset) {
  return holdings.find((holding) => holding.contractAddress?.toLowerCase() === asset.contractAddress.toLowerCase())
    ?? (investAssets.some((configured) => configured.id === asset.id)
      ? holdings.find((holding) => holding.id === asset.id) : undefined);
}

export function AssetPosition({ asset, assetMarkResolution }: {
  asset: InvestAsset;
  assetMarkResolution: AssetMarkResolution;
}) {
  const account = useOptionalAccountWallet();
  const session = account && isServerVerified(account) ? account.session : null;
  const regionId = usePresentationRegionId();
  const balances = useBalances(session?.smartAccount ? {
    subject: session.user.subject,
    smartAccountAddress: session.smartAccount.address,
    chainId: session.smartAccount.chainId,
    accountProvider: session.accountProvider,
  } : null, regionId, account?.fetchBalances ?? unavailableBalances);
  if (!session?.smartAccount) return null;
  if (balances.status === "loading") return <ul aria-label="Your balance"><li className="py-2"><Skeleton className="h-16 w-full" /></li></ul>;
  const unavailable = balances.status === "error" || balances.status === "ready" && (balances.snapshot.stale || balances.refreshError);
  const mark = <AssetIcon mark={presentInvestAssetMark(asset, assetMarkResolution)} />;
  if (unavailable) return <ul><BalanceRow icon={mark} iconTone="mark" label="Your balance"
    context="Balance unavailable" value="—" chevron={false} /></ul>;
  if (balances.status !== "ready") return null;
  const holding = findAssetHolding(balances.snapshot.holdings, asset);
  const configured = investAssets.some((item) => item.id === asset.id);
  const covered = configured ? balances.snapshot.coverage.registry === "complete" : balances.snapshot.coverage.catalog === "complete";
  if (!holding && !covered) return <ul><BalanceRow icon={mark} iconTone="mark" label="Your balance"
    context="Balance unavailable" value="—" chevron={false} /></ul>;
  if (!holding || holding.balance.status === "ready" && holding.balance.baseUnits === "0") return null;
  if (holding.balance.status !== "ready") return <ul><BalanceRow icon={mark} iconTone="mark"
    label="Your balance" context="Balance unavailable" value="—" chevron={false} /></ul>;
  const value = holding.value.status === "priced"
    ? formatFiatAmount(BigInt(holding.value.amount.atoms), holding.value.amount.scale, holding.value.currency, { regionId })
    : "—";
  return <ul><BalanceRow icon={mark} iconTone="mark" label="Your balance"
    context={formatExactPresentationTokenAmount(holding.balance.baseUnits, holding.decimals, holding.symbol)}
    value={value} valueContext={holdingValueContext(holding.value)} chevron={false} /></ul>;
}
