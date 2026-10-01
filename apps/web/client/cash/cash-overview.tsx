"use client";

import { useMemo, useRef } from "react";
import { ArrowLeftRight, CircleAlertIcon, Eye, Percent, PiggyBank, Plus, RotateCw } from "lucide-react";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { ShimmerRows } from "@/client/home/panel-shared";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  summarizeSavingsPortfolio,
} from "@/client/savings/portfolio-summary";
import {
  createSavingsGrowthAnchor,
  useEstimatedSavingsGrowth,
  type SavingsGrowthAuthority,
} from "@/client/savings/use-estimated-growth";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import { moneySheetIntent } from "@/client/money-modal";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { FeatureIntro } from "@/components/ui/feature-intro";
import { Alert, AlertDescription, AlertIcon } from "@/components/ui/alert";
import { presentCashSelection, presentCashTotal, presentPendingCashout } from "@/shared/balances/present";
import {
  selectBalanceTotals,
  selectCash,
  selectVaultPositions,
} from "@/shared/balances/select";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { RegionId } from "@/config/regions";
import type { PendingCashoutEstimate } from "@/shared/balances/pending-cashout";
import { cashConversionCurrencies, type CashConversionCurrency, type CashConversionCurrencyCode } from "@/shared/trading/cash-conversion";
import {
  formatPresentationFiat,
  formatPresentationPercentage,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { savingsWithdrawTargets } from "./savings-withdraw-targets";
import { savingsRateLabel } from "./savings-management";
import { verifiedEmptySavings } from "./verified-empty-savings";
import type { SavingsPortfolioSummary } from "@/client/savings/portfolio-summary";

export type CashOverviewProps = {
  regionId: RegionId;
  snapshot: BalancesSnapshot | null;
  pendingCashout?: PendingCashoutEstimate;
  balanceStatus?: "ready" | "loading" | "failed";
  metadata: MorphoVaultsResult | null;
  vaultStatus?: "ready" | "loading" | "failed";
  nowMs: number;
  now?: () => number;
  rateLabel?: string | null;
  growthAuthority?: SavingsGrowthAuthority | null;
  onOpenSavings: () => void;
  onAddMoney: (options?: { opener?: HTMLElement | null }) => void;
  onAddMoneyIntent?: () => void;
  actionsAvailable?: boolean;
  onConvert?: (opener: HTMLElement) => void;
  onConvertIntent?: () => void;
  onOpenCurrency?: (code: CashConversionCurrencyCode, opener: HTMLElement) => void;
  onCurrencyIntent?: () => void;
  onRetryBalances?: () => void;
};

export type SavingsDetailProps = Omit<
  CashOverviewProps,
  "onOpenSavings" | "rateLabel"
> & {
  balanceStale?: boolean;
  summary?: SavingsPortfolioSummary | null;
  pendingDeposits?: { vaultAddress: string; vaultName: string; amountBaseUnits: string }[];
  pendingActionsLoading?: boolean;
  pendingActionsError?: boolean;
  onRetryActions?: () => void;
  depositFailed?: boolean;
  onStartSaving: (opener: HTMLElement) => void;
  onDepositVault: (candidate: MorphoVaultCandidate, opener: HTMLElement) => void;
  onDepositIntent?: () => void;
  onManageVault: (address: string, opener: HTMLElement) => void;
  onRetryVaults: () => void;
  actionsAvailable?: boolean;
};
type SavingsDisplayVault = {
  address: string;
  name: string;
  candidate: MorphoVaultCandidate | null;
  action: MorphoVaultCandidate | null;
  position: BalancesSnapshot["holdings"][number] | null;
};

function displaySavingsVaults(
  candidates: readonly MorphoVaultCandidate[],
  positions: BalancesSnapshot["holdings"],
  withdrawTargets: ReturnType<typeof savingsWithdrawTargets>,
): SavingsDisplayVault[] {
  const withdrawActions = new Map(
    withdrawTargets.map(({ candidate }) => [
      candidate.vaultAddress.toLowerCase(), candidate,
    ])
  );
  const addresses = new Set(
    candidates.map((candidate) => candidate.vaultAddress.toLowerCase())
  );
  const displayed: SavingsDisplayVault[] = candidates.map((candidate) => ({
    address: candidate.vaultAddress,
    name: candidate.name,
    candidate,
    action: candidate,
    position:
      positions.find(
        (holding) =>
          holding.contractAddress?.toLowerCase() ===
          candidate.vaultAddress.toLowerCase()
      ) ?? null,
  }));
  for (const position of positions) {
    const address = position.contractAddress;
    if (!address || addresses.has(address.toLowerCase())) continue;
    const amount = position.underlyingBalance;
    if (amount?.status === "ready" && BigInt(amount.baseUnits) === BigInt(0))
      continue;
    addresses.add(address.toLowerCase());
    const action = withdrawActions.get(address.toLowerCase()) ?? null;
    displayed.push({
      address,
      name: position.name,
      candidate: null,
      action,
      position,
    });
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
  holding: boolean;
};

/** @public Shared Cash row presentation for the currency detail */
export function cashHoldings(snapshot: BalancesSnapshot): CashHoldingRow[] {
  return selectCash(snapshot).map((entry) => {
      const row = presentCashSelection(entry, snapshot);
      const currency = row.mark.kind === "flag" ? row.mark.currency : "USD";
      const holding = entry.kind === "holding" ? entry.holding : null;
      if (!holding)
        return {
          key: row.key,
          name: row.name,
          symbol: currency,
          currency,
          value: row.primary,
          isFiat: false,
          usdValue: null,
          usdUnavailable: false,
          holding: false,
        };
      const cashValue =
        holding.balance.status === "ready" &&
        holding.cashValue?.status === "priced"
          ? holding.cashValue
          : null;
      const quantity =
        !cashValue &&
        holding.balance.status === "ready" &&
        holding.cashValue?.status !== "unavailable"
          ? row.primary
          : null;
      const needsUsd = holding.cashCurrency !== snapshot.quoteCurrency;
      return {
        key: row.key,
        name: row.name,
        holding: true,
        symbol: holding.symbol,
        currency,
        value: cashValue
          ? formatPresentationFiat(
              cashValue.amount,
              holding.cashCurrency!,
              2,
              snapshot.region
            )
          : quantity,
        isFiat: cashValue !== null,
        usdValue:
          holding.balance.status === "ready" &&
          needsUsd &&
          holding.value.status === "priced"
            ? formatPresentationFiat(
                holding.value.amount,
                holding.value.currency,
                2,
                snapshot.region
              )
            : null,
        usdUnavailable:
          cashValue !== null && needsUsd && holding.value.status !== "priced",
      };
    });
}

function unavailableValue() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Unavailable</span>
    </>
  );
}

function RateLoadingPlaceholder() {
  return <>Loading rate</>;
}

function vaultHolding(vault: SavingsDisplayVault) {
  const amount =
    vault.position?.underlyingBalance?.status === "ready"
      ? vault.position.underlyingBalance.baseUnits
      : null;
  return {
    held: amount !== null && BigInt(amount) > BigInt(0),
    partial: vault.position !== null && amount === null,
    amount,
  };
}

function savingsData(
  snapshot: BalancesSnapshot | null,
  metadata: MorphoVaultsResult | null,
  vaultStatus: "ready" | "loading" | "failed",
  nowMs: number
) {
  const candidates = vaultStatus === "failed" ? [] : metadata?.candidates ?? [];
  const withdrawTargets = savingsWithdrawTargets(
    snapshot, vaultStatus === "failed" ? null : metadata,
  );
  const vaults = displaySavingsVaults(
    candidates,
    snapshot?.holdings.filter((holding) => holding.kind === "vault-share") ?? [],
    withdrawTargets,
  );
  const holdings = vaults.map((vault) => ({ vault, ...vaultHolding(vault) }));
  const total = holdings.reduce(
    (sum, { amount }) => sum + BigInt(amount ?? "0"),
    BigInt(0)
  );
  const partial = holdings.some(({ partial: unreadable }) => unreadable);
  const rates = candidates.flatMap((candidate) => {
    const rate = getSavingsRateState(candidate, {
      metadataFetchedAt: metadata?.source.fetchedAt,
      metadataStale: metadata?.stale,
      nowMs,
    });
    return rate.status !== "unavailable" ? [rate.value] : [];
  });
  return {
    candidates,
    vaults,
    holdings,
    withdrawTargets,
    total,
    partial,
    bestRate: rates.length ? Math.max(...rates) : null,
  };
}

function useSavingsGrowth(
  snapshot: BalancesSnapshot | null,
  metadata: MorphoVaultsResult | null,
  nowMs: number,
  now: () => number,
  growthAuthority: SavingsGrowthAuthority | null,
  regionId: BalancesSnapshot["region"],
) {
  const anchor = useMemo(() => {
    const positions = snapshot ? selectVaultPositions(snapshot) : [];
    const summary = summarizeSavingsPortfolio({
      supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
      requiredAsset: metadata?.asset ?? {
        address: BASE_USDC_ADDRESS,
        symbol: "USDC",
        decimals: 6,
      },
      candidates: metadata?.candidates ?? [],
      positions,
      metadataFetchedAt: metadata?.source.fetchedAt ?? null,
      metadataStale: metadata?.stale ?? false,
      nowMs,
    });
    const authoritativeBaseUnits = positions.reduce(
      (sum, { position }) => sum + BigInt(position?.assetsRaw ?? "0"),
      BigInt(0)
    );
    const earningApy =
      summary.funded &&
      (summary.apy.status === "available" || summary.apy.status === "stale")
        ? `${formatExactSavingsApy(summary.apy.value, regionId)} APY`
        : null;
    if (!snapshot || !metadata || !growthAuthority)
      return {
        earningApy,
        anchor: {
          identity: `unavailable:${authoritativeBaseUnits}`,
          authoritativeBaseUnits,
          estimate: null,
        },
      };
    return {
      earningApy,
      anchor: createSavingsGrowthAnchor({
        authority: growthAuthority,
        candidates: metadata.candidates,
        metadataFetchedAt: metadata.source.fetchedAt,
        metadataStale: metadata.stale,
        nowMs,
        summary,
      }),
    };
  }, [snapshot, metadata, nowMs, growthAuthority, regionId]);
  return {
    earningApy: anchor.earningApy,
    growth:
      useEstimatedSavingsGrowth(anchor.anchor, now) -
      anchor.anchor.authoritativeBaseUnits,
  };
}

function SavingsVaultRow({
  vault,
  metadata,
  regionId,
  rateLoading,
  nowMs,
  onActivate,
  onIntent,
  activateLabel,
}: {
  vault: SavingsDisplayVault;
  metadata: MorphoVaultsResult | null;
  regionId: BalancesSnapshot["region"];
  rateLoading: boolean;
  nowMs: number;
  onActivate?: (opener: HTMLElement) => void;
  onIntent?: () => void;
  activateLabel?: string;
}) {
  const { held, partial, amount } = vaultHolding(vault);
  return (
    <BalanceRow
      icon={
        <GlyphMark size="sm">
          <PiggyBank className="size-4" />
        </GlyphMark>
      }
      iconTone="mark"
      label={vault.name}
      context={
        rateLoading ? (
          <RateLoadingPlaceholder />
        ) : (
          savingsRateLabel(vault.candidate, metadata, nowMs, regionId)
        )
      }
      value={
        held ? (
          <MoneyTicker
            animated={false}
            value={formatUsdStablecoinAmount(amount!)}
          />
        ) : partial ? (
          unavailableValue()
        ) : undefined
      }
      valueTone={partial ? "muted" : "default"}
      onActivate={onActivate}
      onIntent={onIntent}
      activateLabel={activateLabel}
      chevron={Boolean(onActivate)}
    />
  );
}

export function CashOverview({
  regionId,
  snapshot,
  pendingCashout = null,
  balanceStatus = "ready",
  metadata,
  vaultStatus = "ready",
  nowMs,
  now = Date.now,
  rateLabel = null,
  growthAuthority = null,
  onOpenSavings,
  onAddMoney,
  onAddMoneyIntent,
  actionsAvailable = true,
  onConvert,
  onConvertIntent,
  onOpenCurrency,
  onCurrencyIntent,
  onRetryBalances,
}: CashOverviewProps) {
  const loading = balanceStatus === "loading";
  const failed = balanceStatus === "failed";
  const activeSnapshot = failed ? null : snapshot;
  const pendingValue = activeSnapshot ? presentPendingCashout(activeSnapshot, pendingCashout) : null;
  const summary = useMemo(() => activeSnapshot
    ? presentCashTotal(activeSnapshot)
    : null, [activeSnapshot]);
  const rows = useMemo(() => activeSnapshot ? cashHoldings(activeSnapshot) : [], [activeSnapshot]);
  const conversionsByCode = useMemo(() => new Map<string, CashConversionCurrency>(cashConversionCurrencies.map((currency) => [currency.code, currency])), []);
  const { holdings, total, partial, bestRate } = useMemo(() => savingsData(
    activeSnapshot,
    metadata,
    vaultStatus,
    nowMs
  ), [activeSnapshot, metadata, vaultStatus, nowMs]);
  const { growth, earningApy } = useSavingsGrowth(
    activeSnapshot,
    vaultStatus === "ready" ? metadata : null,
    nowMs,
    now,
    growthAuthority,
    regionId,
  );
  const cashTotal = useMemo(
    () => activeSnapshot ? selectBalanceTotals(activeSnapshot).cash : null,
    [activeSnapshot]
  );
  const empty =
    !loading &&
    summary?.status === "complete" &&
    cashTotal?.value?.atoms === "0" &&
    !holdings.some(({ held }) => held);
  const savingsValue =
    partial && total === BigInt(0)
      ? "Unavailable"
      : formatUsdStablecoinAmount(total.toString());
  const rowRate =
    vaultStatus === "failed"
      ? "Rate unavailable"
      : total > BigInt(0)
      ? rateLabel ?? "Rate unavailable"
      : bestRate === null
      ? "Rate unavailable"
      : `Earn up to ${formatPresentationPercentage(bestRate, regionId)} APY`;
  const cashValue =
    summary?.status === "complete" &&
    cashTotal?.value &&
    activeSnapshot?.quoteCurrency === "USD"
      ? formatPresentationFiat(
          {
            atoms: (
              (BigInt(cashTotal.value.atoms) * BigInt(1_000_000)) /
                BigInt(10) ** BigInt(cashTotal.value.scale) +
              growth
            ).toString(),
            scale: 6,
          },
          "USD",
          growth === BigInt(0) ? 2 : 6,
          activeSnapshot.region
        )
      : summary?.value ?? null;
  return (
    <div className="space-y-4">
      <Card
        variant="flush"
        aria-label={failed ? "Balance unavailable" : "Cash balance"}
        aria-busy={loading || (empty && vaultStatus === "loading") || undefined}
      >
        <CardContent inset="hero">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">Cash</p>
            {loading ? (
              <div data-shimmer="hero">
                <Skeleton className="h-10 w-48" />
                <span className="sr-only">Updating…</span>
              </div>
            ) : (
              <>
                <div
                  aria-describedby={
                    summary?.status === "partial"
                      ? "cash-balance-partial"
                      : undefined
                  }
                  className={`text-4xl font-semibold tabular-nums ${
                    summary?.status !== "complete"
                      ? "text-muted-foreground"
                      : ""
                  }`}
                >
                  {cashValue ? (
                    <MoneyTicker
                      align="start"
                      reserveDigits={false}
                      value={cashValue}
                    />
                  ) : (
                    unavailableValue()
                  )}
                </div>
                {pendingValue ? (
                  <p className="flex items-baseline gap-1 text-sm text-muted-foreground tabular-nums" data-pending-cash-out>
                    <span>Pending cash-out</span>
                    <span aria-hidden="true">·</span>
                    {pendingValue.value ? <MoneyTicker value={pendingValue.value} align="start" reserveDigits={false} /> : unavailableValue()}
                  </p>
                ) : null}
                {!failed &&
                (empty
                  ? vaultStatus !== "loading" && bestRate !== null
                  : Boolean(rateLabel)) ? (
                  <p
                    className={
                      !empty && earningApy
                        ? "text-sm text-market-gain"
                        : "text-sm text-muted-foreground"
                    }
                    data-cash-rate
                  >
                    {empty
                      ? `Earn up to ${formatPresentationPercentage(
                          bestRate!,
                          regionId
                        )} APY`
                      : rateLabel}
                  </p>
                ) : null}
                {!failed && empty && vaultStatus === "loading" ? (
                  <div data-cash-rate>
                    <Skeleton className="h-5 w-40" />
                    <span className="sr-only">Loading rate</span>
                  </div>
                ) : null}
                {summary?.status === "partial" ? (
                  <p
                    id="cash-balance-partial"
                    className="text-sm text-muted-foreground"
                  >
                    Some balances are unavailable
                  </p>
                ) : null}
              </>
            )}
          </div>
          {failed ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load your balance. Check your connection.
            </p>
          ) : null}
        </CardContent>
      </Card>
      {failed ? (onRetryBalances ? (
        <Button
          variant="outline"
          size="lg"
          className="h-11 w-full"
          onClick={onRetryBalances}
        >
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      ) : null) : (
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" className="h-11 w-full" {...(onAddMoneyIntent ? moneySheetIntent(onAddMoneyIntent) : {})} onClick={(event) => onAddMoney({ opener: event.currentTarget })}>
            <Plus aria-hidden="true" />
            Add money
          </Button>
          {onConvert ? <Button size="lg" variant="outline" className="h-11 w-full" disabled={loading || !actionsAvailable}
            {...(onConvertIntent ? moneySheetIntent(onConvertIntent) : {})} onClick={(event) => onConvert(event.currentTarget)}>
            <ArrowLeftRight aria-hidden="true" />
            Convert
          </Button> : null}
        </div>
      )}
      {!failed && (!empty || vaultStatus === "failed") ? (
        <>
          {!empty ? (
            <section
              aria-labelledby="cash-held-heading"
              aria-busy={loading || undefined}
            >
              <Card>
                <CardHeader>
                  <HomeSectionHeading id="cash-held-heading">
                    Currencies
                  </HomeSectionHeading>
                </CardHeader>
                <CardContent inset="list">
                  {loading ? (
                    <>
                      <ShimmerRows count={2} />
                      <span className="sr-only">Updating…</span>
                    </>
                  ) : (
                    <ul className="list-none p-0">
                      {rows.map((row) => {
                        const conversion = row.holding ? conversionsByCode.get(row.currency) : undefined;
                        const openConversion = onOpenCurrency && conversion ? (opener: HTMLElement) => onOpenCurrency(conversion.code, opener) : undefined;
                        return <BalanceRow
                          key={row.key}
                          icon={
                            <CurrencyMark
                              size="sm"
                              currency={row.currency}
                              symbol={row.symbol}
                            />
                          }
                          iconTone="mark"
                          label={row.name}
                          context={row.symbol}
                          value={
                            row.value ? (
                              row.isFiat ? (
                                <MoneyTicker
                                  animated={false}
                                  value={row.value}
                                />
                              ) : (
                                row.value
                              )
                            ) : (
                              "Unavailable"
                            )
                          }
                          valueTone={
                            row.value && row.isFiat ? "default" : "muted"
                          }
                          valueContext={
                            row.usdUnavailable
                              ? unavailableValue()
                              : row.usdValue
                          }
                          onActivate={openConversion}
                          activateLabel={conversion ? `Open ${row.name}` : undefined}
                          onIntent={onOpenCurrency && row.holding ? onCurrencyIntent : undefined}
                          chevron={Boolean(openConversion)}
                        />;
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          ) : null}
          <section
            aria-labelledby="cash-savings-heading"
            aria-busy={loading || vaultStatus === "loading" || undefined}
          >
            <Card>
              <CardHeader>
                <HomeSectionHeading id="cash-savings-heading">
                  Savings
                </HomeSectionHeading>
              </CardHeader>
              <CardContent inset="list">
                {loading ? (
                  <>
                    <ShimmerRows count={1} />
                    <span className="sr-only">Updating…</span>
                  </>
                ) : (
                  <ul className="list-none p-0">
                    <BalanceRow
                      icon={
                        <GlyphMark size="sm">
                          <PiggyBank className="size-4" />
                        </GlyphMark>
                      }
                      iconTone="mark"
                      label="US dollar"
                      context={
                        vaultStatus === "loading" ? (
                          <RateLoadingPlaceholder />
                        ) : (
                          rowRate
                        )
                      }
                      value={
                        total > BigInt(0) || partial ? (
                          partial && total === BigInt(0) ? (
                            unavailableValue()
                          ) : (
                            <MoneyTicker
                              animated={false}
                              value={savingsValue}
                            />
                          )
                        ) : undefined
                      }
                      valueTone={partial ? "muted" : "default"}
                      valueContext={
                        partial && total > BigInt(0) ? "Partial" : undefined
                      }
                      onActivate={onOpenSavings}
                      activateLabel="Open savings"
                      chevron
                    />
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}

export function SavingsDetail({
  snapshot,
  regionId,
  balanceStatus = "ready",
  metadata,
  vaultStatus = "ready",
  nowMs,
  now = Date.now,
  onDepositVault,
  onDepositIntent,
  onManageVault,
  onRetryVaults,
  onRetryBalances,
  onStartSaving,
  growthAuthority = null,
  actionsAvailable = true,
  balanceStale = false,
  summary = null,
  pendingDeposits = [],
  pendingActionsLoading = false,
  pendingActionsError = false,
  onRetryActions,
  depositFailed = false,
}: SavingsDetailProps) {
  const balanceFailed = balanceStatus === "failed";
  const activeSnapshot = balanceFailed ? null : snapshot;
  const { candidates, holdings, total, partial, bestRate } = useMemo(() => savingsData(
    activeSnapshot,
    metadata,
    vaultStatus,
    nowMs
  ), [activeSnapshot, metadata, vaultStatus, nowMs]);
  const { growth, earningApy } = useSavingsGrowth(
    activeSnapshot,
    vaultStatus === "ready" ? metadata : null,
    nowMs,
    now,
    growthAuthority,
    regionId,
  );
  const shown = holdings.filter(
    ({ held, partial: unreadable }) => held || unreadable
  );
  const other = candidates.filter(
    (candidate) =>
      !holdings.some(
        ({ vault, held, partial: unreadable }) =>
          vault.address.toLowerCase() ===
            candidate.vaultAddress.toLowerCase() &&
          (held || unreadable)
      )
  );
  const best = candidates.find(
    (candidate) =>
      bestRate !== null &&
      getSavingsRateState(candidate, {
        metadataFetchedAt: metadata?.source.fetchedAt,
        metadataStale: metadata?.stale,
        nowMs,
      }).value === bestRate
  );
  const bestRateStatus = best ? getSavingsRateState(best, {
    metadataFetchedAt: metadata?.source.fetchedAt,
    metadataStale: metadata?.stale,
    nowMs,
  }).status : "unavailable";
  const verifiedEmpty = verifiedEmptySavings({
    balanceStatus, snapshot, balanceStale, vaultStatus, summary, shownCount: shown.length,
  });
  const pendingEmpty = pendingDeposits.length > 0 && verifiedEmpty;
  const pendingTotal = pendingDeposits.reduce((sum, deposit) => sum + BigInt(deposit.amountBaseUnits), BigInt(0));
  const actionHistoryUnresolved = pendingActionsError && verifiedEmpty && !pendingEmpty;
  const firstUse = verifiedEmpty && !pendingEmpty && !pendingActionsLoading && !actionHistoryUnresolved;
  const depositUnavailable =
    !actionsAvailable ||
    balanceStatus === "failed" ||
    activeSnapshot?.holdings.find((holding) => holding.id === "usdc")?.balance
      .status !== "ready" ||
    vaultStatus !== "ready";
  const startSavingRef = useRef<HTMLButtonElement>(null);
  const recovery = (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Savings rates unavailable</EmptyTitle>
        <EmptyDescription>Check your connection.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          size="lg"
          className="h-11"
          onClick={onRetryVaults}
        >
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
  return (
    <div className="space-y-4">
      {(!verifiedEmpty || pendingEmpty) ? <Card
        variant="flush"
        aria-label={balanceFailed ? "Balance unavailable" : "Savings balance"}
        aria-busy={balanceStatus === "loading" || undefined}
      >
        <CardContent inset="hero">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">Savings</p>
            {balanceStatus === "loading" ? (
              <>
                <Skeleton className="h-10 w-48" />
                <span className="sr-only">Updating…</span>
              </>
            ) : (
              <div
                aria-describedby={
                  partial && !balanceFailed
                    ? "savings-balance-partial"
                    : undefined
                }
                className={`text-4xl font-semibold tabular-nums ${
                  partial || balanceFailed ? "text-muted-foreground" : ""
                }`}
              >
                {balanceFailed || (partial && total === BigInt(0)) ? (
                  unavailableValue()
                ) : (
                  <MoneyTicker
                    align="start"
                    reserveDigits={false}
                    value={
                      pendingEmpty ? formatUsdStablecoinAmount(pendingTotal.toString())
                      : partial || growth === BigInt(0)
                        ? formatUsdStablecoinAmount(total.toString())
                        : formatPresentationFiat(
                            { atoms: (total + growth).toString(), scale: 6 },
                            "USD",
                            6,
                            activeSnapshot?.region ?? "US"
                          )
                    }
                  />
                )}
              </div>
            )}
            {pendingEmpty ? <p className="text-sm text-muted-foreground">Pending</p> : null}
            {partial && !balanceFailed ? (
              <p
                id="savings-balance-partial"
                className="text-sm text-muted-foreground"
              >
                Some savings are unavailable
              </p>
            ) : null}
            {!balanceFailed && vaultStatus === "ready" && total > BigInt(0) ? (
              earningApy ? (
                <p className="text-sm text-market-gain">Earning {earningApy}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Rate unavailable
                </p>
              )
            ) : null}
            {!pendingEmpty && !balanceFailed &&
            vaultStatus === "ready" &&
            total === BigInt(0) &&
            !partial &&
            bestRate !== null ? (
              <p className="text-sm text-muted-foreground">
                Earn up to {formatPresentationPercentage(bestRate, regionId)} APY
              </p>
            ) : null}
          </div>
          {balanceFailed ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load your balance. Check your connection.
            </p>
          ) : null}
        </CardContent>
      </Card> : null}
      {depositFailed && verifiedEmpty ? <Alert variant="destructive" role="alert"><AlertIcon><CircleAlertIcon /></AlertIcon><AlertDescription>Your deposit didn&apos;t go through. Try again.</AlertDescription></Alert> : null}
      {pendingActionsLoading && verifiedEmpty && !pendingEmpty ? (
        <Card aria-busy="true"><CardContent><Skeleton className="h-24 w-full" /><span className="sr-only">Loading savings</span></CardContent></Card>
      ) : actionHistoryUnresolved ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Couldn&apos;t check your deposits</EmptyTitle>
            <EmptyDescription>Check your connection.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="lg"
              className="h-11"
              onClick={onRetryActions}
              disabled={!onRetryActions}
            >
              <RotateCw aria-hidden="true" />
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : firstUse ? (
        <>
          <FeatureIntro
            size="compact"
            illustration="savings"
            headline="Earn on your savings"
            description="Rates can change and aren't guaranteed."
            benefits={[
              { icon: Percent, text: bestRate === null || bestRateStatus === "unavailable" ? "Rates are shown before you save"
                : bestRateStatus === "stale" ? `Up to ${formatPresentationPercentage(bestRate, regionId)} APY at last update`
                : `Up to ${formatPresentationPercentage(bestRate, regionId)} APY` },
              { icon: Eye, text: "Review the rate before you confirm" },
            ]}
            primary={{ label: "Start saving", ref: startSavingRef, onClick: () => { if (startSavingRef.current) onStartSaving(startSavingRef.current); } }}
            availability={
              !actionsAvailable ? { kind: "unavailable", reason: "Savings isn't available for this account." }
              : !best ? { kind: "unavailable", reason: "Savings options aren't available right now.", recovery: { label: "Try again", onClick: onRetryVaults } }
              : undefined
            }
          />
        </>
      ) : null}
      {balanceFailed && onRetryBalances ? (
        <Button variant="outline" size="lg" className="h-11 w-full" onClick={onRetryBalances}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
      {shown.length || pendingEmpty ? (
        <section
          id="your-savings"
          aria-labelledby="your-savings-heading"
          aria-busy={vaultStatus === "loading" || undefined}
        >
          <Card>
            <CardHeader>
              <HomeSectionHeading id="your-savings-heading">
                Your savings
              </HomeSectionHeading>
            </CardHeader>
            <CardContent inset="list">
              <ul className="list-none p-0 [&_[data-slot=item]]:min-h-16">
                {shown.map(({ vault }) => (
                  <SavingsVaultRow
                    key={vault.address}
                    vault={vault}
                    metadata={vaultStatus === "failed" ? null : metadata}
                    rateLoading={vaultStatus === "loading"}
                    nowMs={nowMs}
                    regionId={regionId}
                    onActivate={actionsAvailable ? (element) => onManageVault(vault.address, element) : undefined}
                    activateLabel={actionsAvailable ? `Manage ${vault.name}` : undefined}
                  />
                ))}
                {pendingEmpty ? pendingDeposits.map((deposit) => (
                  <BalanceRow key={deposit.vaultAddress} icon={<GlyphMark size="sm"><PiggyBank className="size-4" /></GlyphMark>}
                    iconTone="mark" label={deposit.vaultName} context="Pending"
                    value={<MoneyTicker animated={false} value={formatUsdStablecoinAmount(deposit.amountBaseUnits)} />} chevron={false} />
                )) : null}
              </ul>
              {vaultStatus === "failed" ? recovery : null}
            </CardContent>
          </Card>
        </section>
      ) : !balanceFailed && vaultStatus === "failed" ? (
        <Card>
          <CardContent>{recovery}</CardContent>
        </Card>
      ) : null}
      {!balanceFailed &&
      vaultStatus !== "failed" &&
      (!verifiedEmpty || pendingEmpty) &&
      (vaultStatus === "loading" || other.length) ? (
        <section
          aria-labelledby="more-savings-heading"
          aria-busy={vaultStatus === "loading" || undefined}
        >
          <Card>
            <CardHeader>
              <HomeSectionHeading id="more-savings-heading">More ways to save</HomeSectionHeading>
            </CardHeader>
            <CardContent inset="list">
              {!other.length ? (
                <>
                  <ShimmerRows count={2} />
                  <span className="sr-only">Loading rates</span>
                </>
              ) : (
                <ul className="list-none p-0">
                  {other.map((candidate) => {
                    const vault = holdings.find(
                      ({ vault: entry }) =>
                        entry.address.toLowerCase() ===
                        candidate.vaultAddress.toLowerCase()
                    )?.vault ?? {
                      address: candidate.vaultAddress,
                      name: candidate.name,
                      candidate,
                      action: candidate,
                      position: null,
                    };
                    return (
                      <SavingsVaultRow
                        key={candidate.vaultAddress}
                        vault={vault}
                        metadata={metadata}
                        rateLoading={vaultStatus === "loading"}
                        nowMs={nowMs}
                        regionId={regionId}
                        onActivate={
                          depositUnavailable
                            ? undefined
                            : (element) => onDepositVault(candidate, element)
                        }
                        onIntent={depositUnavailable ? undefined : onDepositIntent}
                        activateLabel={`Deposit to ${vault.name}`}
                      />
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
