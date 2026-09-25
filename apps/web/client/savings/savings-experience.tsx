"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertAction, AlertIcon, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleAlertIcon, ArrowLeft } from "lucide-react";
import { MoneyTicker } from "@/components/money-ticker";
import { AddressText } from "@/components/address-text";
import { useOptionalAppChrome } from "@/components/app-chrome";
import { isServerVerified, useAccountWallet } from "@/client/account/cdp-client";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { useBalances } from "@/client/balances";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { selectBalanceBaseUnits, selectVaultPositions } from "@/shared/balances/select";
import {
  formatPresentationPercentage,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import type { SavingsActionMode } from "@/client/savings/savings-actions";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type {
  MorphoVaultCandidate,
  MorphoVaultsResult,
} from "@/shared/savings/types";
import {
  preferredSavingsCandidates,
  readUsdcBaseUnits,
  savingsVaultApyLabel,
  shortVaultLabel,
} from "./format";
import {
  createSavingsGrowthAnchor,
  useEstimatedSavingsGrowth,
  type SavingsGrowthAuthority,
} from "./use-estimated-growth";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
  type SavingsApySummary,
} from "./portfolio-summary";
import { useSavingsVaults } from "./use-savings-vaults";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";

type SavingsExperienceProps = {
  initialData?: MorphoVaultsResult | null;
  session?: VerifiedAccountSession | null;
  fetchVaults?: (signal?: AbortSignal) => Promise<unknown>;
  now?: () => number;
  availableUsdcBaseUnits?: string | null;
  balancePositions?: ReturnType<typeof selectVaultPositions> | null;
  balanceStatus?: "idle" | "loading" | "ready" | "error";
  balanceRevalidating?: boolean;
  balanceRefreshError?: boolean;
  balanceStale?: boolean;
  onRetryBalances?: () => void;
  growthAuthority?: SavingsGrowthAuthority | null;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  prepareMoneyAction?: (
    endpoint: string,
    input: unknown,
  ) => Promise<PreparedMoneyAction>;
  executeMoneyAction?: (
    action: PreparedMoneyAction,
  ) => Promise<OperationResult>;
  onBack?: () => void;
};

type LoadState =
  | { status: "loading"; data: null }
  | { status: "ready"; data: MorphoVaultsResult }
  | { status: "error"; data: null };

type PositionState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      data: ReturnType<typeof selectVaultPositions>;
      refreshing: boolean;
      refreshError: boolean;
    }
  | { status: "error" };

const SavingsMoneySheet = deferSheet(() => import("@/client/savings/savings-actions").then((module) => module.SavingsMoneyDialog));

export function AuthenticatedSavingsExperience() {
  const account = useAccountWallet();
  const region = usePresentationRegionId();
  const session = isServerVerified(account) ? account.session : null;
  const balancesSession = session?.smartAccount
    ? {
        subject: session.user.subject,
        smartAccountAddress: session.smartAccount.address,
        chainId: session.smartAccount.chainId,
        accountProvider: session.accountProvider,
      }
    : null;
  const balances = useBalances(balancesSession, region, account.fetchBalances);
  const availableUsdcBaseUnits = balances.snapshot
    ? selectBalanceBaseUnits(balances.snapshot, "usdc")
    : null;
  const balancePositions = balances.snapshot ? selectVaultPositions(balances.snapshot) : null;
  const growthAuthority: SavingsGrowthAuthority | null = balances.snapshot && session
    ? {
        accountIdentity: `${session.user.subject}:${balances.snapshot.owner.address.toLowerCase()}`,
        assetIdentity: `${BASE_USDC_ADDRESS.toLowerCase()}:8453:${BASE_USDC_DECIMALS}`,
        blockNumber: balances.snapshot.block.number,
        blockHash: balances.snapshot.block.hash,
        blockTimestamp: balances.snapshot.block.timestamp,
        snapshotStale: balances.snapshot.stale === true,
        registryCoverageComplete: balances.snapshot.coverage.registry === "complete",
      }
    : null;

  return (
    <SavingsExperience
      session={session}
      availableUsdcBaseUnits={availableUsdcBaseUnits}
      balancePositions={balancePositions}
      balanceStatus={balances.status === "unavailable" ? "idle" : balances.status}
      balanceRevalidating={balances.revalidating === true}
      balanceRefreshError={balances.refreshError === true}
      balanceStale={balances.snapshot?.stale === true}
      onRetryBalances={() => void balances.retry()}
      growthAuthority={growthAuthority}
      fetchAccountResource={account.fetchAccountResource}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
    />
  );
}

export function SavingsExperience({
  initialData = null,
  session = null,
  fetchVaults,
  now = Date.now,
  availableUsdcBaseUnits = null,
  balancePositions = null,
  balanceStatus,
  balanceRevalidating = false,
  balanceRefreshError = false,
  balanceStale = false,
  onRetryBalances,
  growthAuthority = null,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  onBack,
}: SavingsExperienceProps) {
  const [rateNowMs, setRateNowMs] = useState(() => now());
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<SavingsActionMode | null>(null);
  const routing = useOptionalHomeShellRouting();
  const depositOpenerRef = useRef<HTMLButtonElement>(null);
  const withdrawOpenerRef = useRef<HTMLButtonElement>(null);
  const pendingFocusModeRef = useRef<SavingsActionMode | null>(null);
  const routedActionMode: SavingsActionMode | null =
    routing?.state.flow === "save-deposit"
      ? "deposit"
      : routing?.state.flow === "save-withdraw"
        ? "withdraw"
        : null;
  const visibleActionMode = routing ? routedActionMode : actionMode;
  const initialRoutedActionModeRef = useRef(routing ? routedActionMode : null);
  const normalizedInitialRouteRef = useRef(false);
  const hosted = Boolean(useOptionalAppChrome());
  const hasSession = Boolean(session?.smartAccount);
  const metadataQuery = useSavingsVaults({ initialData, fetchVaults });
  const loadState = useMemo<LoadState>(
    () =>
      metadataQuery.data
        ? { status: "ready", data: metadataQuery.data }
        : metadataQuery.isError
          ? { status: "error", data: null }
          : { status: "loading", data: null },
    [metadataQuery.data, metadataQuery.isError],
  );
  useEffect(() => {
    const initialMode = initialRoutedActionModeRef.current;
    if (!routing || !initialMode || normalizedInitialRouteRef.current) return;
    normalizedInitialRouteRef.current = true;
    routing.clearFlow({ mode: "replace" });
    routing.setFlow(
      initialMode === "deposit" ? "save-deposit" : "save-withdraw",
    );
  }, [routing]);

  useEffect(() => {
    if (balanceStatus !== "ready" || !balancePositions) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setRateNowMs(now());
    });
    return () => {
      active = false;
    };
  }, [balancePositions, balanceStatus, now]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    const expiresAt = nextSavingsRateExpiryAt(
      loadState.data.candidates,
      loadState.data.source.fetchedAt,
      rateNowMs,
    );
    if (expiresAt === null || expiresAt <= rateNowMs) return;
    const timeout = setTimeout(
      () => setRateNowMs(now()),
      expiresAt - rateNowMs,
    );
    return () => clearTimeout(timeout);
  }, [loadState, now, rateNowMs]);

  const positionState = useMemo<PositionState>(() => {
    if (!hasSession || balanceStatus === "idle") return { status: "idle" };
    if (balanceStatus === "ready" && balancePositions) {
      return {
        status: "ready",
        data: balancePositions,
        refreshing: balanceRevalidating,
        refreshError: balanceRefreshError,
      };
    }
    if (balanceStatus === "error") return { status: "error" };
    return { status: "loading" };
  }, [
    balancePositions,
    balanceRefreshError,
    balanceRevalidating,
    balanceStatus,
    hasSession,
  ]);

  const allCandidates = useMemo(() => {
    if (loadState.status !== "ready") return [];
    return preferredSavingsCandidates(loadState.data.candidates);
  }, [loadState]);
  const candidates = allCandidates;
  const selected =
    candidates.find(
      (candidate) =>
        candidate.vaultAddress.toLowerCase() ===
        (selectedAddress ?? "").toLowerCase(),
    ) ??
    candidates[0] ??
    null;

  const portfolioSummary = useMemo(() => {
    if (positionState.status !== "ready") return null;
    return summarizeSavingsPortfolio({
      supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
      requiredAsset:
        loadState.status === "ready" ? loadState.data.asset : BASE_USDC_ASSET,
      candidates: loadState.status === "ready" ? loadState.data.candidates : [],
      positions: positionState.data,
      metadataFetchedAt:
        loadState.status === "ready" ? loadState.data.source.fetchedAt : null,
      metadataStale: loadState.status === "ready" && loadState.data.stale,
      nowMs: rateNowMs,
    });
  }, [loadState, positionState, rateNowMs]);
  const growthAnchor = useMemo(() => {
    if (!growthAuthority || !portfolioSummary || loadState.status !== "ready") {
      return {
        identity: `unavailable:${portfolioSummary?.balance.status === "available" ? portfolioSummary.balance.totalBaseUnits : "0"}`,
        authoritativeBaseUnits: portfolioSummary?.balance.status === "available"
          ? BigInt(portfolioSummary.balance.totalBaseUnits)
          : BigInt(0),
        estimate: null,
      };
    }
    return createSavingsGrowthAnchor({
      authority: growthAuthority,
      candidates: loadState.data.candidates,
      metadataFetchedAt: loadState.data.source.fetchedAt,
      metadataStale: loadState.data.stale,
      nowMs: rateNowMs,
      summary: portfolioSummary,
    });
  }, [growthAuthority, loadState, portfolioSummary, rateNowMs]);
  const estimatedBalanceBaseUnits = useEstimatedSavingsGrowth(growthAnchor, now);
  const balances = collectVaultBalances(candidates, positionState);
  const coldLoading = hasSession && positionState.status === "loading";
  const positionFailed = hasSession && positionState.status === "error";
  const refreshing =
    positionState.status === "ready" && positionState.refreshing;
  const refreshError =
    positionState.status === "ready" && positionState.refreshError;
  const balancePartiallyAvailable = positionState.status === "ready" &&
    positionState.data.some((entry) => entry.position !== null) &&
    positionState.data.some((entry) => entry.position === null);
  const retainedBalanceIsStale = Boolean(
    availableBalanceOrPositions(positionState) && (balanceStale || refreshError),
  );
  const funded = portfolioSummary?.funded ?? false;
  const availableBalance =
    portfolioSummary?.balance.status === "available"
      ? portfolioSummary.balance
      : null;
  const showBalanceRows = funded || (hasSession && !availableBalance);
  const selectedBalance = selected
    ? balances.find(
        (entry) =>
          entry.vaultAddress.toLowerCase() ===
          selected.vaultAddress.toLowerCase(),
      )
    : undefined;
  const selectedAmount = selectedBalance?.amount ?? null;
  const canWithdraw = Boolean(selectedAmount && selectedAmount > BigInt(0));
  const actionsReady = Boolean(
    availableBalance &&
    session?.smartAccount &&
    selected &&
    prepareMoneyAction &&
    executeMoneyAction,
  );

  function openAction(mode: SavingsActionMode) {
    void SavingsMoneySheet.preload();
    pendingFocusModeRef.current = mode;
    if (!routing) {
      setActionMode(mode);
      return;
    }
    routing.setFlow(mode === "deposit" ? "save-deposit" : "save-withdraw");
  }

  function closeAction() {
    if (!routing) {
      setActionMode(null);
      return;
    }
    routing.clearFlow({ mode: "replace" });
  }

  function restoreActionFocus() {
    const mode = pendingFocusModeRef.current;
    pendingFocusModeRef.current = null;
    if (mode === "deposit") depositOpenerRef.current?.focus();
    if (mode === "withdraw") withdrawOpenerRef.current?.focus();
  }

  return (
    <section
      className="w-full space-y-4"
      aria-label={hosted ? "Save" : undefined}
      aria-labelledby={hosted ? undefined : "savings-title"}
    >
      {hosted ? null : (
        <header className="grid grid-cols-[2rem_1fr_2rem] items-center gap-2">
          {onBack ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <span />
          )}
          <h2
            className="text-center text-2xl font-semibold tracking-tight"
            id="savings-title"
          >
            Save
          </h2>
          <span />
        </header>
      )}

      <Card aria-busy={coldLoading || refreshing || undefined}>
        <CardContent>
          <div className="flex flex-col items-center gap-2 text-center">
          {coldLoading ? (
            <>
              <Skeleton
                className="h-12 w-2/5 max-w-44"
                data-shimmer="savings-hero"
              />
              <SavingsNotice visuallyHidden>Updating…</SavingsNotice>
            </>
          ) : availableBalance ? (
            <>
              <p
                className={`text-4xl font-semibold tracking-tight tabular-nums ${funded ? "" : "text-muted-foreground"}`.trim()}
              >
                <MoneyTicker
                  value={formatUsdStablecoinAmount(
                    estimatedBalanceBaseUnits.toString(),
                  )}
                />
              </p>
              {funded && portfolioSummary ? (
                loadState.status === "loading" ? (
                  <>
                    <Skeleton className="h-4 w-28" data-shimmer="savings-apy" />
                    <SavingsNotice visuallyHidden>Loading APY…</SavingsNotice>
                  </>
                ) : (
                  <FundedApyCaption apy={portfolioSummary.apy} />
                )
              ) : (
                <SavingsEmpty
                  title="Nothing saved yet"
                  description={
                    selected && loadState.status === "ready"
                      ? availableVaultDescription(selected, loadState.data, rateNowMs)
                      : undefined
                  }
                />
              )}
            </>
          ) : !hasSession ? (
            <>
              <p className="text-4xl font-semibold tracking-tight text-muted-foreground tabular-nums">
                <MoneyTicker value="$0.00" />
              </p>
              <SavingsEmpty
                title="Nothing saved yet"
                description={
                  selected && loadState.status === "ready"
                    ? availableVaultDescription(selected, loadState.data, rateNowMs)
                    : undefined
                }
              />
            </>
          ) : (
            <>
              <p className="text-4xl font-semibold tracking-tight tabular-nums">
                <MoneyTicker value="—" />
              </p>
              <p className="text-sm text-muted-foreground" role="status">
                {balancePartiallyAvailable
                  ? "Saved balance partially unavailable"
                  : "Saved balance unavailable"}
              </p>
            </>
          )}
          </div>
          {retainedBalanceIsStale ? (
            <Alert className="mt-4" role="status">
              <AlertDescription>
                Saved balance stale.
              </AlertDescription>
              {onRetryBalances ? (
                <AlertAction>
                  <Button variant="outline" size="touch" onClick={onRetryBalances}>Retry</Button>
                </AlertAction>
              ) : null}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {loadState.status === "loading" ? (
        <section className="space-y-3" aria-label="Vaults" aria-busy="true">
          <VaultListSkeleton />
          <SavingsNotice visuallyHidden>Loading vaults…</SavingsNotice>
        </section>
      ) : loadState.status === "error" ? (
        <Alert role="alert">
          <AlertDescription>Vaults are temporarily unavailable.</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="touch" onClick={() => void metadataQuery.refetch()}>Retry</Button>
          </AlertAction>
        </Alert>
      ) : !coldLoading && !positionFailed && candidates.length > 0 ? (
        <section className="space-y-4" aria-label="Vaults">
          <div className="space-y-4" role="radiogroup" aria-label="Vault">
            {candidates.map((candidate) => {
              const isSelected =
                selected?.vaultAddress === candidate.vaultAddress;
              const detailsId = `vault-${candidate.vaultAddress}-details`;
              const balance = balances.find(
                (entry) =>
                  entry.vaultAddress.toLowerCase() ===
                  candidate.vaultAddress.toLowerCase(),
              );
              const apyLabel = loadState.status === "ready"
                ? savingsVaultApyLabel(candidate, loadState.data, rateNowMs)
                : null;
              const fundedApy = funded && loadState.status === "ready"
                ? fundedVaultApyLabel(candidate, loadState.data, rateNowMs)
                : null;
              const rowValue = showBalanceRows ? (
                <MoneyTicker
                  value={
                    balance?.amount === null || balance?.amount === undefined
                      ? "—"
                      : formatUsdStablecoinAmount(balance.amount.toString())
                  }
                />
              ) : apyLabel;
              return (
                <div
                  key={candidate.vaultAddress}
                  className={`overflow-hidden rounded-xl border bg-card pt-1 transition-colors ${
                    isSelected ? "border-primary" : "border-border"
                  }`}
                >
                  <Item
                    variant="flush"
                    className="flex-nowrap cursor-pointer items-center"
                    render={
                      <Button
                        variant="ghost"
                        press="none"
                        size="lg"
                        type="button"
                        onClick={() =>
                          setSelectedAddress(candidate.vaultAddress)
                        }
                        role="radio"
                        aria-checked={isSelected}
                        aria-controls={isSelected ? detailsId : undefined}
                        name="savings-vault"
                      />
                    }
                  >
                    <ItemMedia variant="avatar" aria-hidden="true">
                      <span className="text-xs font-semibold">
                        {vaultInitials(candidate.name)}
                      </span>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle>{candidate.name}</ItemTitle>
                      {fundedApy !== null ? (
                        <ItemDescription>{fundedApy}</ItemDescription>
                      ) : null}
                    </ItemContent>
                    {rowValue !== null ? (
                      <ItemContent className="items-end text-right">
                        <ItemTitle numeric>{rowValue}</ItemTitle>
                      </ItemContent>
                    ) : null}
                  </Item>
                  {isSelected ? (
                    <dl
                      id={detailsId}
                      className="grid grid-cols-2 gap-4 border-t px-4 py-3"
                      aria-label={`${candidate.name} details`}
                    >
                      <div className="min-w-0">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Fee
                        </dt>
                        <dd className="mt-1 text-sm tabular-nums">
                          {formatPresentationPercentage(candidate.feeRate)}
                        </dd>
                      </div>
                      <div className="min-w-0 text-right">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Curator
                        </dt>
                        <dd className="mt-1 min-w-0 text-sm">
                          {candidate.curatorAddress ? (
                            <AddressText
                              address={candidate.curatorAddress}
                              className="justify-end"
                            />
                          ) : (
                            "—"
                          )}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {loadState.status !== "error" && (availableBalance || !hasSession) ? (
        <div className={`grid gap-2 ${funded ? "grid-cols-2" : "grid-cols-1"}`}>
          <Button
            ref={depositOpenerRef}
            size="touch"
            disabled={!actionsReady}
            onPointerDown={() => void SavingsMoneySheet.preload()}
            onClick={() => openAction("deposit")}
          >
            {funded ? "Deposit" : "Get started"}
          </Button>
          {funded ? (
            <Button
              ref={withdrawOpenerRef}
              size="touch"
              variant="outline"
              disabled={!actionsReady || !canWithdraw}
              onPointerDown={() => void SavingsMoneySheet.preload()}
              onClick={() => openAction("withdraw")}
            >
              Withdraw
            </Button>
          ) : null}
        </div>
      ) : null}

      {session && selected && prepareMoneyAction && executeMoneyAction ? (
        <SavingsMoneySheet
          open={visibleActionMode !== null}
          mode={visibleActionMode ?? "deposit"}
          session={session}
          candidate={selected}
          availableLabel={
            visibleActionMode === "deposit"
              ? availableUsdcBaseUnits
                ? savingsAvailableLabel(availableUsdcBaseUnits)
                : undefined
              : selectedAmount !== null
                ? savingsAvailableLabel(selectedAmount)
                : undefined
          }
          availableBaseUnits={
            visibleActionMode === "deposit"
              ? availableUsdcBaseUnits
              : (selectedAmount?.toString() ?? null)
          }
          availableStale={balanceStale || balanceRefreshError}
          fetchAccountResource={fetchAccountResource}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          onClose={closeAction}
          onClosed={restoreActionFocus}
        />
      ) : null}
    </section>
  );
}

function savingsAvailableLabel(baseUnits: string | bigint): string {
  const cents = BigInt(baseUnits) / BigInt(10) ** BigInt(BASE_USDC_DECIMALS - 2);
  return `${formatUsdStablecoinAmount(cents, 2)} available`;
}

function availableBalanceOrPositions(state: PositionState): boolean {
  return state.status === "ready" && state.data.some((entry) => entry.position !== null);
}

function vaultInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function availableVaultDescription(
  candidate: MorphoVaultCandidate,
  metadata: MorphoVaultsResult,
  nowMs: number,
): string {
  const label = savingsVaultApyLabel(candidate, metadata, nowMs);
  return `Available vault · ${shortVaultLabel(candidate.name)}${label ? ` · ${label}` : ""}`;
}

function fundedVaultApyLabel(
  candidate: MorphoVaultCandidate,
  metadata: MorphoVaultsResult,
  nowMs: number,
): string | null {
  const rate = getSavingsRateState(candidate, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs,
  });
  if (rate.status === "unavailable") return null;
  return formatPresentationPercentage(rate.value);
}

function FundedApyCaption({ apy }: { apy: SavingsApySummary }) {
  if (apy.status === "available" || apy.status === "stale") {
    return (
      <p className="text-sm text-muted-foreground">
        Earning ~{formatExactSavingsApy(apy.value)}
      </p>
    );
  }
  return null;
}

function SavingsEmpty({
  className,
  description,
  title,
}: {
  className?: string;
  description?: React.ReactNode;
  title: React.ReactNode;
}) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  );
}

function SavingsNotice({
  children,
  role = "status",
  tone = "neutral",
  visuallyHidden = false,
}: {
  children: React.ReactNode;
  role?: "status" | "alert";
  tone?: "neutral" | "error";
  visuallyHidden?: boolean;
}) {
  return (
    <Alert
      className={visuallyHidden ? "sr-only" : undefined}
      role={role}
      variant={tone === "error" ? "destructive" : "default"}
    >
      {tone === "error" ? <AlertIcon><CircleAlertIcon /></AlertIcon> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function VaultListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1].map((index) => (
        <Card key={index} size="sm" data-shimmer="vault-row">
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-14" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function collectVaultBalances(
  candidates: MorphoVaultCandidate[],
  state: PositionState,
): Array<{ vaultAddress: string; amount: bigint | null }> {
  if (state.status !== "ready") {
    return candidates.map((candidate) => ({
      vaultAddress: candidate.vaultAddress,
      amount: null,
    }));
  }

  return candidates.map((candidate) => {
    const entry = state.data.find(
      (vault) =>
        vault.vaultAddress.toLowerCase() ===
        candidate.vaultAddress.toLowerCase(),
    );
    if (!entry) {
      return { vaultAddress: candidate.vaultAddress, amount: null };
    }
    if (!entry.position) {
      return { vaultAddress: candidate.vaultAddress, amount: null };
    }
    return {
      vaultAddress: candidate.vaultAddress,
      amount: readUsdcBaseUnits(entry.position.assetsRaw),
    };
  });
}

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;
