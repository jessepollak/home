"use client";

import { useMemo, useRef, useState } from "react";
import { PiggyBank, Plus, RotateCw } from "lucide-react";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { ShimmerRows } from "@/client/home/panel-shared";
import { formatExactSavingsApy, getSavingsRateState, summarizeSavingsPortfolio } from "@/client/savings/portfolio-summary";
import { createSavingsGrowthAnchor, useEstimatedSavingsGrowth } from "@/client/savings/use-estimated-growth";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { presentBalances, presentMoneyGroups } from "@/shared/balances/present";
import { selectBalanceTotals, selectVaultPositions } from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { formatPresentationFiat, formatPresentationPercentage, formatUsdStablecoinAmount } from "@/shared/formatting";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES, getVerifiedSaveVault } from "@/shared/savings/config";
import { MORPHO_API_VERSION, type MorphoVaultCandidate, type MorphoVaultsResult } from "@/shared/savings/types";

export type CashOverviewExplorationProps = {
  snapshot: BalancesSnapshot | null;
  balanceStatus?: "ready" | "loading" | "failed";
  metadata: MorphoVaultsResult | null;
  vaultStatus?: "ready" | "loading" | "failed";
  nowMs: number;
  now?: () => number;
  rateLabel?: string | null;
  onOpenSavings: () => void;
  onAddMoney: () => void;
  onRetryBalances: () => void;
};

export type SavingsDetailExplorationProps = Omit<CashOverviewExplorationProps, "onOpenSavings" | "onAddMoney" | "rateLabel"> & {
  onDepositVault: (candidate: MorphoVaultCandidate) => void;
  onWithdrawVault: (candidate: MorphoVaultCandidate) => void;
  onRetryVaults: () => void;
};
type SavingsDisplayVault = {
  address: string;
  name: string;
  candidate: MorphoVaultCandidate | null;
  action: MorphoVaultCandidate | null;
  position: BalancesSnapshot["holdings"][number] | null;
};

function displaySavingsVaults(candidates: readonly MorphoVaultCandidate[], positions: BalancesSnapshot["holdings"], snapshot: BalancesSnapshot | null): SavingsDisplayVault[] {
  const addresses = new Set(candidates.map((candidate) => candidate.vaultAddress.toLowerCase()));
  const displayed: SavingsDisplayVault[] = candidates.map((candidate) => ({
    address: candidate.vaultAddress,
    name: candidate.name,
    candidate,
    action: candidate,
    position: positions.find((holding) => holding.contractAddress?.toLowerCase() === candidate.vaultAddress.toLowerCase()) ?? null,
  }));
  for (const position of positions) {
    const address = position.contractAddress;
    if (!address || addresses.has(address.toLowerCase())) continue;
    const amount = position.underlyingBalance;
    if (amount?.status === "ready" && BigInt(amount.baseUnits) === BigInt(0)) continue;
    addresses.add(address.toLowerCase());
    const configured = getVerifiedSaveVault(address);
    const action: MorphoVaultCandidate | null = configured && snapshot ? {
      version: MORPHO_API_VERSION, vaultAddress: configured.address, name: configured.name,
      symbol: configured.symbol, listed: false, chainId: 8453,
      asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      curatorAddress: null, grossApy: null, netApy: null, feeRate: null,
      totalAssetsRaw: null, liquidityRaw: null, stateAsOf: null, blockNumber: null,
      source: { provider: "Base JSON-RPC", blockNumber: snapshot.block.number, fetchedAt: new Date(Number(snapshot.block.timestamp) * 1000).toISOString() },
    } : null;
    displayed.push({ address, name: position.name, candidate: null, action, position });
  }
  return displayed;
}

type CashHoldingRow = {
  key: string;
  name: string;
  symbol: string;
  currency: string;
  value: string | null;
  isFiat: boolean;
  usdValue: string | null;
  usdUnavailable: boolean;
};

function cashHoldings(snapshot: BalancesSnapshot): CashHoldingRow[] {
  return presentMoneyGroups(snapshot).find((group) => group.id === "cash")!.rows
    .map((row) => {
      const currency = row.mark.kind === "flag" ? row.mark.currency : "USD";
      const holding = snapshot.holdings.find((entry) => entry.key === row.key);
      if (!holding) return {
        key: row.key, name: row.name, symbol: currency, currency,
        value: row.primary, isFiat: true,
        usdValue: null, usdUnavailable: false,
      };
      const cashValue = holding.balance.status === "ready" && holding.cashValue?.status === "priced" ? holding.cashValue : null;
      const quantity = !cashValue && holding.balance.status === "ready" && holding.cashValue?.status !== "unavailable" ? row.primary : null;
      const needsUsd = holding.cashCurrency !== snapshot.quoteCurrency;
      return {
        key: row.key,
        name: row.name,
        symbol: holding.symbol,
        currency,
        value: cashValue ? formatPresentationFiat(cashValue.amount, holding.cashCurrency!, 2, snapshot.region) : quantity,
        isFiat: cashValue !== null,
        usdValue: holding.balance.status === "ready" && needsUsd && holding.value.status === "priced"
          ? formatPresentationFiat(holding.value.amount, holding.value.currency, 2, snapshot.region)
          : null,
        usdUnavailable: cashValue !== null && needsUsd && holding.value.status !== "priced",
      };
    });
}

function unavailableValue() {
  return <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>;
}

function RateLoadingPlaceholder() {
  return <>Loading rate</>;
}

function vaultRateLabel(vault: SavingsDisplayVault, metadata: MorphoVaultsResult | null, nowMs: number): string {
  if (!vault.candidate || !metadata) return "Rate unavailable";
  const rate = getSavingsRateState(vault.candidate, { metadataFetchedAt: metadata.source.fetchedAt, metadataStale: metadata.stale, nowMs });
  return rate.status !== "unavailable" ? `${formatPresentationPercentage(rate.value)} APY` : "Rate unavailable";
}

function vaultHolding(vault: SavingsDisplayVault) {
  const amount = vault.position?.underlyingBalance?.status === "ready" ? vault.position.underlyingBalance.baseUnits : null;
  return { held: amount !== null && BigInt(amount) > BigInt(0), partial: vault.position !== null && amount === null, amount };
}

function savingsData(snapshot: BalancesSnapshot | null, metadata: MorphoVaultsResult | null, vaultStatus: "ready" | "loading" | "failed", nowMs: number) {
  const candidates = vaultStatus === "failed" ? [] : metadata?.candidates ?? [];
  const vaults = displaySavingsVaults(candidates, snapshot?.holdings.filter((holding) => holding.kind === "vault-share") ?? [], snapshot);
  const holdings = vaults.map((vault) => ({ vault, ...vaultHolding(vault) }));
  const total = holdings.reduce((sum, { amount }) => sum + BigInt(amount ?? "0"), BigInt(0));
  const partial = holdings.some(({ partial: unreadable }) => unreadable);
  const rates = candidates.flatMap((candidate) => {
    const rate = getSavingsRateState(candidate, { metadataFetchedAt: metadata?.source.fetchedAt, metadataStale: metadata?.stale, nowMs });
    return rate.status !== "unavailable" ? [rate.value] : [];
  });
  return { candidates, vaults, holdings, total, partial, bestRate: rates.length ? Math.max(...rates) : null };
}

function useSavingsGrowth(snapshot: BalancesSnapshot | null, metadata: MorphoVaultsResult | null, nowMs: number, now: () => number) {
  const anchor = useMemo(() => {
    const positions = snapshot ? selectVaultPositions(snapshot) : [];
    const summary = summarizeSavingsPortfolio({
      supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
      requiredAsset: metadata?.asset ?? { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      candidates: metadata?.candidates ?? [], positions,
      metadataFetchedAt: metadata?.source.fetchedAt ?? null,
      metadataStale: metadata?.stale ?? false, nowMs,
    });
    const authoritativeBaseUnits = positions.reduce((sum, { position }) => sum + BigInt(position?.assetsRaw ?? "0"), BigInt(0));
    const earningApy = summary.funded && (summary.apy.status === "available" || summary.apy.status === "stale") ? `${formatExactSavingsApy(summary.apy.value)} APY` : null;
    if (!snapshot || !metadata) return { earningApy, anchor: { identity: `unavailable:${authoritativeBaseUnits}`, authoritativeBaseUnits, estimate: null } };
    return { earningApy, anchor: createSavingsGrowthAnchor({
      authority: {
        accountIdentity: snapshot.owner.address, assetIdentity: metadata.asset.address,
        blockNumber: snapshot.block.number, blockHash: snapshot.block.hash, blockTimestamp: snapshot.block.timestamp,
        snapshotStale: snapshot.stale === true, registryCoverageComplete: snapshot.coverage.registry === "complete",
      }, candidates: metadata.candidates, metadataFetchedAt: metadata.source.fetchedAt,
      metadataStale: metadata.stale, nowMs, summary,
    }) };
  }, [snapshot, metadata, nowMs]);
  return { earningApy: anchor.earningApy, growth: useEstimatedSavingsGrowth(anchor.anchor, now) - anchor.anchor.authoritativeBaseUnits };
}

function SavingsVaultRow({ vault, metadata, rateLoading, nowMs, onActivate, activateLabel }: {
  vault: SavingsDisplayVault;
  metadata: MorphoVaultsResult | null;
  rateLoading: boolean;
  nowMs: number;
  onActivate?: (opener: HTMLElement) => void;
  activateLabel?: string;
}) {
  const { held, partial, amount } = vaultHolding(vault);
  return <BalanceRow
    icon={<GlyphMark size="sm"><PiggyBank className="size-4" /></GlyphMark>}
    iconTone="mark"
    label={vault.name}
    context={rateLoading ? <RateLoadingPlaceholder /> : vaultRateLabel(vault, metadata, nowMs)}
    value={held ? <MoneyTicker animated={false} value={formatUsdStablecoinAmount(amount!)} /> : partial ? unavailableValue() : undefined}
    valueTone={partial ? "muted" : "default"}
    onActivate={onActivate}
    activateLabel={activateLabel}
    chevron={Boolean(onActivate)}
  />;
}

export function CashOverviewExploration({ snapshot, balanceStatus = "ready", metadata, vaultStatus = "ready", nowMs, now = Date.now, rateLabel = null, onOpenSavings, onAddMoney, onRetryBalances }: CashOverviewExplorationProps) {
  const loading = balanceStatus === "loading";
  const failed = balanceStatus === "failed";
  const activeSnapshot = failed ? null : snapshot;
  const summary = activeSnapshot ? presentBalances({ status: "ready", snapshot: activeSnapshot, error: null }).summary?.cash : null;
  const rows = activeSnapshot ? cashHoldings(activeSnapshot) : [];
  const { holdings, total, partial, bestRate } = savingsData(activeSnapshot, metadata, vaultStatus, nowMs);
  const { growth, earningApy } = useSavingsGrowth(activeSnapshot, vaultStatus === "ready" ? metadata : null, nowMs, now);
  const empty = !loading && summary?.status === "complete" && selectBalanceTotals(activeSnapshot!).cash.value?.atoms === "0" && !holdings.some(({ held }) => held);
  const savingsValue = partial && total === BigInt(0) ? "Unavailable" : formatUsdStablecoinAmount(total.toString());
  const rowRate = vaultStatus === "failed" ? "Rate unavailable" : total > BigInt(0) ? rateLabel ?? "Rate unavailable" : bestRate === null ? "Rate unavailable" : `Earn up to ${formatPresentationPercentage(bestRate)} APY`;
  const cashTotal = activeSnapshot ? selectBalanceTotals(activeSnapshot).cash : null;
  const cashValue = summary?.status === "complete" && cashTotal?.value && activeSnapshot?.quoteCurrency === "USD"
    ? formatPresentationFiat({ atoms: (BigInt(cashTotal.value.atoms) * BigInt(1_000_000) / (BigInt(10) ** BigInt(cashTotal.value.scale)) + growth).toString(), scale: 6 }, "USD", growth === BigInt(0) ? 2 : 6, activeSnapshot.region)
    : summary?.value ?? null;
  return <div className="space-y-4">
    <Card variant="flush" aria-label={failed ? "Balance unavailable" : "Cash balance"} aria-busy={loading || (empty && vaultStatus === "loading") || undefined}>
      <CardContent inset="hero">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">Cash</p>
          {loading ? <div data-shimmer="hero"><Skeleton className="h-10 w-48" /><span className="sr-only">Updating…</span></div> : <>
            <div aria-describedby={summary?.status === "partial" ? "cash-balance-partial" : undefined} className={`text-4xl font-semibold tabular-nums ${summary?.status !== "complete" ? "text-muted-foreground" : ""}`}>{cashValue ? <MoneyTicker align="start" reserveDigits={false} value={cashValue} /> : unavailableValue()}</div>
            {!failed && (empty ? vaultStatus !== "loading" && bestRate !== null : Boolean(rateLabel)) ? <p className={!empty && earningApy ? "text-sm text-market-gain" : "text-sm text-muted-foreground"} data-cash-rate>{empty ? `Earn up to ${formatPresentationPercentage(bestRate!)} APY` : rateLabel}</p> : null}
            {!failed && empty && vaultStatus === "loading" ? <div data-cash-rate><Skeleton className="h-5 w-40" /><span className="sr-only">Loading rate</span></div> : null}
            {summary?.status === "partial" ? <p id="cash-balance-partial" className="text-sm text-muted-foreground">Some balances are unavailable</p> : null}
          </>}
        </div>
        {failed ? <p className="text-sm text-muted-foreground">Couldn&apos;t load your balance. Check your connection.</p> : null}
      </CardContent>
    </Card>
    {failed ? <Button variant="outline" size="lg" className="h-11 w-full" onClick={onRetryBalances}><RotateCw aria-hidden="true" />Try again</Button> : <Button size="lg" className="h-11 w-full" onClick={onAddMoney}><Plus aria-hidden="true" />Add money</Button>}
    {!failed && (!empty || vaultStatus === "failed") ? <>
      {!empty ? <section aria-labelledby="cash-held-heading" aria-busy={loading || undefined}><Card><CardHeader><HomeSectionHeading id="cash-held-heading">Currencies</HomeSectionHeading></CardHeader><CardContent inset="list">
        {loading ? <><ShimmerRows count={2} /><span className="sr-only">Updating…</span></> : <ul className="list-none p-0">{rows.map((row) => <BalanceRow key={row.key} icon={<CurrencyMark size="sm" currency={row.currency} symbol={row.symbol} />} iconTone="mark" label={row.name} context={row.symbol} value={row.value ? row.isFiat ? <MoneyTicker animated={false} value={row.value} /> : row.value : unavailableValue()} valueTone={row.value && row.isFiat ? "default" : "muted"} valueContext={row.usdUnavailable ? unavailableValue() : row.usdValue} chevron={false} />)}</ul>}
      </CardContent></Card></section> : null}
      <section aria-labelledby="cash-savings-heading" aria-busy={loading || vaultStatus === "loading" || undefined}><Card><CardHeader><HomeSectionHeading id="cash-savings-heading">Savings</HomeSectionHeading></CardHeader><CardContent inset="list">
        {loading ? <><ShimmerRows count={1} /><span className="sr-only">Updating…</span></> : <ul className="list-none p-0"><BalanceRow
          icon={<GlyphMark size="sm"><PiggyBank className="size-4" /></GlyphMark>}
          iconTone="mark"
          label="US dollar"
          context={vaultStatus === "loading" ? <RateLoadingPlaceholder /> : rowRate}
          value={total > BigInt(0) || partial ? partial && total === BigInt(0) ? unavailableValue() : <MoneyTicker animated={false} value={savingsValue} /> : undefined}
          valueTone={partial ? "muted" : "default"}
          valueContext={partial && total > BigInt(0) ? "Partial" : undefined}
          onActivate={onOpenSavings}
          activateLabel="Open savings"
          chevron
        /></ul>}
      </CardContent></Card></section>
    </> : null}
  </div>;
}

export function SavingsDetailExploration({ snapshot, balanceStatus = "ready", metadata, vaultStatus = "ready", nowMs, now = Date.now, onDepositVault, onWithdrawVault, onRetryVaults, onRetryBalances }: SavingsDetailExplorationProps) {
  const balanceFailed = balanceStatus === "failed";
  const activeSnapshot = balanceFailed ? null : snapshot;
  const { candidates, holdings, total, partial, bestRate } = savingsData(activeSnapshot, metadata, vaultStatus, nowMs);
  const { growth, earningApy } = useSavingsGrowth(activeSnapshot, vaultStatus === "ready" ? metadata : null, nowMs, now);
  const withdrawable = holdings.filter(({ vault, held }) => vault.action && held);
  const hasHeld = holdings.some(({ held }) => held);
  const shown = holdings.filter(({ held, partial: unreadable }) => held || unreadable);
  const other = candidates.filter((candidate) => !holdings.some(({ vault, held, partial: unreadable }) => vault.address.toLowerCase() === candidate.vaultAddress.toLowerCase() && (held || unreadable)));
  const best = candidates.find((candidate) => bestRate !== null && getSavingsRateState(candidate, { metadataFetchedAt: metadata?.source.fetchedAt, metadataStale: metadata?.stale, nowMs }).value === bestRate);
  const depositUnavailable = balanceStatus === "failed" || activeSnapshot?.holdings.find((holding) => holding.id === "usdc")?.balance.status !== "ready" || vaultStatus !== "ready";
  const [choosing, setChoosing] = useState(false);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const choiceKey = withdrawable.map(({ vault }) => vault.address.toLowerCase()).join(":");
  const [previousChoiceKey, setPreviousChoiceKey] = useState(choiceKey);
  if (choiceKey !== previousChoiceKey) { setPreviousChoiceKey(choiceKey); setChoosing(false); }
  const choose = (candidate: MorphoVaultCandidate) => { withdrawRef.current?.focus({ preventScroll: true }); setChoosing(false); onWithdrawVault(candidate); };
  const recovery = <Empty><EmptyHeader><EmptyTitle>Savings rates unavailable</EmptyTitle><EmptyDescription>Check your connection.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" size="lg" className="h-11" onClick={onRetryVaults}><RotateCw aria-hidden="true" />Try again</Button></EmptyContent></Empty>;
  return <div className="space-y-4" onKeyDown={(event) => {
    if (choosing && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setChoosing(false);
      withdrawRef.current?.focus({ preventScroll: true });
    }
  }}>
    <Card variant="flush" aria-label={balanceFailed ? "Balance unavailable" : "Savings balance"} aria-busy={balanceStatus === "loading" || undefined}><CardContent inset="hero">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Savings</p>
        {balanceStatus === "loading" ? <><Skeleton className="h-10 w-48" /><span className="sr-only">Updating…</span></> : <div aria-describedby={partial && !balanceFailed ? "savings-balance-partial" : undefined} className={`text-4xl font-semibold tabular-nums ${partial || balanceFailed ? "text-muted-foreground" : ""}`}>{balanceFailed || (partial && total === BigInt(0)) ? unavailableValue() : <MoneyTicker align="start" reserveDigits={false} value={partial || growth === BigInt(0) ? formatUsdStablecoinAmount(total.toString()) : formatPresentationFiat({ atoms: (total + growth).toString(), scale: 6 }, "USD", 6, activeSnapshot?.region ?? "US")} />}</div>}
        {partial && !balanceFailed ? <p id="savings-balance-partial" className="text-sm text-muted-foreground">Some savings are unavailable</p> : null}
        {!balanceFailed && vaultStatus === "ready" && total > BigInt(0) ? earningApy ? <p className="text-sm text-market-gain">Earning {earningApy}</p> : <p className="text-sm text-muted-foreground">Rate unavailable</p> : null}
        {!balanceFailed && vaultStatus === "ready" && total === BigInt(0) && !partial && bestRate !== null ? <p className="text-sm text-muted-foreground">Earn up to {formatPresentationPercentage(bestRate)} APY</p> : null}
      </div>
      {balanceFailed ? <p className="text-sm text-muted-foreground">Couldn&apos;t load your balance. Check your connection.</p> : null}
    </CardContent></Card>
    {balanceFailed ? <Button variant="outline" size="lg" className="h-11 w-full" onClick={onRetryBalances}><RotateCw aria-hidden="true" />Try again</Button> : <div className={`grid gap-2 ${hasHeld ? "grid-cols-2" : "grid-cols-1"}`}>
      <Button size="lg" className="h-11" disabled={depositUnavailable || !best} onClick={() => best && onDepositVault(best)}>Deposit</Button>
      {hasHeld ? <Button ref={withdrawRef} variant="outline" size="lg" className="h-11" disabled={!withdrawable.length} aria-expanded={withdrawable.length > 1 ? choosing : undefined} aria-controls={withdrawable.length > 1 ? "your-savings" : undefined} onClick={() => withdrawable.length === 1 ? choose(withdrawable[0].vault.action!) : setChoosing((current) => !current)}>Withdraw</Button> : null}
    </div>}
    {shown.length ? <section id="your-savings" aria-labelledby="your-savings-heading" aria-busy={vaultStatus === "loading" || undefined}><Card><CardHeader><HomeSectionHeading id="your-savings-heading">{choosing ? "Withdraw from" : "Your savings"}</HomeSectionHeading></CardHeader><CardContent inset="list"><ul className="list-none p-0 [&_[data-slot=item]]:min-h-16">{shown.map(({ vault, held }) => <SavingsVaultRow key={vault.address} vault={vault} metadata={vaultStatus === "failed" ? null : metadata} rateLoading={vaultStatus === "loading"} nowMs={nowMs}
      onActivate={choosing && withdrawable.length > 1 && held && vault.action ? () => choose(vault.action!) : undefined}
      activateLabel={`Withdraw from ${vault.name}`}
    />)}</ul>{vaultStatus === "failed" ? recovery : null}</CardContent></Card></section> : !balanceFailed && vaultStatus === "failed" ? <Card><CardContent>{recovery}</CardContent></Card> : null}
    {!balanceFailed && vaultStatus !== "failed" && (vaultStatus === "loading" || other.length) ? <section aria-labelledby="more-savings-heading" aria-busy={vaultStatus === "loading" || undefined}><Card><CardHeader><HomeSectionHeading id="more-savings-heading">More ways to save</HomeSectionHeading></CardHeader><CardContent inset="list">{!other.length ? <><ShimmerRows count={2} /><span className="sr-only">Loading rates</span></> : <ul className="list-none p-0">{other.map((candidate) => {
      const vault = holdings.find(({ vault: entry }) => entry.address.toLowerCase() === candidate.vaultAddress.toLowerCase())?.vault ?? { address: candidate.vaultAddress, name: candidate.name, candidate, action: candidate, position: null };
      return <SavingsVaultRow key={candidate.vaultAddress} vault={vault} metadata={metadata} rateLoading={vaultStatus === "loading"} nowMs={nowMs}
        onActivate={depositUnavailable ? undefined : () => onDepositVault(candidate)}
        activateLabel={`Deposit to ${vault.name}`}
      />;
    })}</ul>}</CardContent></Card></section> : null}
  </div>;
}
