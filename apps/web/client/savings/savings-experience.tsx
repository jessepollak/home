"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import { CopyableValue } from "@/components/copyable-value";
import { useOptionalAppChrome } from "@/components/app-chrome";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { usePortfolioValuation } from "@/client/portfolio";
import {
  formatAddress,
  formatPresentationPercentage,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import {
  SavingsMoneyDialog,
  type SavingsActionMode,
} from "@/client/savings/savings-actions";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type {
  Address,
  MorphoVaultCandidate,
  MorphoVaultPosition,
  MorphoVaultsResult,
} from "@/shared/savings/types";
import { readUsdcBaseUnits, shortVaultLabel } from "./format";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
  type SavingsApySummary,
} from "./portfolio-summary";
import styles from "./savings-experience.module.css";
import {
  ownerQueryKey,
  ownerQueryMeta,
  publicQueryKey,
  useHomeQuery,
} from "@/client/query/query-client";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { markHomePerformance } from "@/client/observability/perf-marks";

type SavingsExperienceProps = {
  initialData?: MorphoVaultsResult | null;
  session?: VerifiedAccountSession | null;
  fetchPositions?: (signal?: AbortSignal) => Promise<unknown>;
  fetchVaults?: (signal?: AbortSignal) => Promise<unknown>;
  now?: () => number;
  availableUsdcBaseUnits?: string | null;
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

type PositionResult = {
  accountAddress: Address;
  fetchedAt: string;
  vaults: Array<{
    vaultAddress: Address;
    position: MorphoVaultPosition | null;
  }>;
};

type PositionState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      data: PositionResult;
      refreshing: boolean;
      refreshError: boolean;
    }
  | { status: "error" };

export function AuthenticatedSavingsExperience() {
  const account = useAccountWallet();
  const session = account.status === "verified" ? account.session : null;
  const portfolioSession = session?.smartAccount
    ? {
        subject: session.user.subject,
        smartAccountAddress: session.smartAccount.address,
        chainId: session.smartAccount.chainId,
        accountProvider: session.accountProvider,
      }
    : null;
  const portfolio = usePortfolioValuation(
    portfolioSession,
    "US",
    account.fetchPortfolioValuation,
  );
  const usdc = portfolio.snapshot?.inventory.holdings.find(
    (holding) => holding.kind === "direct" && holding.id === "usdc",
  );
  const availableUsdcBaseUnits =
    usdc?.kind === "direct" ? usdc.balanceBaseUnits : null;

  return (
    <SavingsExperience
      session={session}
      fetchPositions={account.fetchSavingsPositions}
      availableUsdcBaseUnits={availableUsdcBaseUnits}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
    />
  );
}

export function SavingsExperience({
  initialData = null,
  session = null,
  fetchPositions,
  fetchVaults = fetchSavingsVaults,
  now = Date.now,
  availableUsdcBaseUnits = null,
  prepareMoneyAction,
  executeMoneyAction,
  onBack,
}: SavingsExperienceProps) {
  const [rateNowMs, setRateNowMs] = useState(() => now());
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<SavingsActionMode | null>(null);
  const routing = useOptionalHomeShellRouting();
  const openedActionInAppRef = useRef(false);
  const routedActionMode: SavingsActionMode | null =
    routing?.state.flow === "save-deposit"
      ? "deposit"
      : routing?.state.flow === "save-withdraw"
        ? "withdraw"
        : null;
  const visibleActionMode = routing ? routedActionMode : actionMode;
  const hosted = Boolean(useOptionalAppChrome());
  const sessionAddress = session?.smartAccount?.address ?? null;
  const sessionKey = session?.smartAccount ? activityOwnerKey(session) : null;
  const metadataQuery = useHomeQuery({
    queryKey: publicQueryKey("savings-vaults"),
    initialData: initialData ?? undefined,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => fetchVaults(signal),
    select: (value) => {
      const data = parseVaultsResult(value);
      if (!data) throw new Error("Savings vault metadata is invalid.");
      return data;
    },
  });
  const loadState = useMemo<LoadState>(
    () =>
      metadataQuery.data
        ? { status: "ready", data: metadataQuery.data }
        : metadataQuery.isError
          ? { status: "error", data: null }
          : { status: "loading", data: null },
    [metadataQuery.data, metadataQuery.isError],
  );
  const positionsQuery = useHomeQuery({
    queryKey: sessionKey
      ? ownerQueryKey(sessionKey, "savings-positions")
      : ["unauthenticated", "savings-positions-disabled"],
    enabled: Boolean(sessionKey && fetchPositions && sessionAddress),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: sessionKey ? ownerQueryMeta(sessionKey, "owner") : undefined,
    queryFn: ({ signal }) => {
      if (!fetchPositions)
        throw new Error("Savings positions are unavailable.");
      return fetchPositions(signal);
    },
    select: (value) => {
      if (!sessionAddress)
        throw new Error("Savings positions are unavailable.");
      const data = parsePositionResult(value, sessionAddress);
      if (!data || !isUsablePositionResult(data))
        throw new Error("Savings positions are invalid.");
      return data;
    },
  });

  useEffect(() => {
    if (positionsQuery.dataUpdatedAt <= 0) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setRateNowMs(now());
    });
    return () => {
      active = false;
    };
  }, [now, positionsQuery.dataUpdatedAt]);

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
    if (!sessionKey) return { status: "idle" };
    if (positionsQuery.data) {
      return {
        status: "ready",
        data: positionsQuery.data,
        refreshing: positionsQuery.isFetching,
        refreshError: positionsQuery.isError,
      };
    }
    return positionsQuery.isError ? { status: "error" } : { status: "loading" };
  }, [
    positionsQuery.data,
    positionsQuery.isError,
    positionsQuery.isFetching,
    sessionKey,
  ]);

  useEffect(() => {
    if (
      loadState.status === "ready" &&
      (positionState.status === "ready" || positionState.status === "idle")
    ) {
      markHomePerformance("save:ready");
    }
  }, [loadState.status, positionState.status]);

  const allCandidates = useMemo(() => {
    if (loadState.status !== "ready") return [];
    return [...loadState.data.candidates].sort(
      (left, right) =>
        Number(/gauntlet/i.test(right.name)) -
        Number(/gauntlet/i.test(left.name)),
    );
  }, [loadState]);
  const candidates = allCandidates.slice(0, 2);
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
      positions: positionState.data.vaults,
      metadataFetchedAt:
        loadState.status === "ready" ? loadState.data.source.fetchedAt : null,
      metadataStale: loadState.status === "ready" && loadState.data.stale,
      nowMs: rateNowMs,
    });
  }, [loadState, positionState, rateNowMs]);
  const balances = collectVaultBalances(candidates, positionState);
  const coldLoading = Boolean(sessionKey && positionState.status === "loading");
  const positionFailed = Boolean(
    sessionKey && positionState.status === "error",
  );
  const refreshing =
    positionState.status === "ready" && positionState.refreshing;
  const refreshError =
    positionState.status === "ready" && positionState.refreshError;
  const funded = portfolioSummary?.funded ?? false;
  const availableBalance =
    portfolioSummary?.balance.status === "available"
      ? portfolioSummary.balance
      : null;
  const showBalanceRows = funded || Boolean(sessionKey && !availableBalance);
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
    if (!routing) {
      setActionMode(mode);
      return;
    }
    openedActionInAppRef.current = true;
    routing.setFlow(mode === "deposit" ? "save-deposit" : "save-withdraw");
  }

  function closeAction() {
    if (!routing) {
      setActionMode(null);
      return;
    }
    if (openedActionInAppRef.current) {
      openedActionInAppRef.current = false;
      window.history.back();
      return;
    }
    routing.clearFlow({ mode: "replace" });
  }

  return (
    <section
      className={styles.experience}
      aria-label={hosted ? "Save" : undefined}
      aria-labelledby={hosted ? undefined : "savings-title"}
    >
      {hosted ? null : (
        <header className={styles.header}>
          {onBack ? (
            <Button
              className={styles.back}
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back"
            >
              <span aria-hidden="true">←</span>
            </Button>
          ) : (
            <span />
          )}
          <h2
            className={`${styles.title} text-sheet-title font-semibold`}
            id="savings-title"
          >
            Save
          </h2>
          <span />
        </header>
      )}

      <div
        className={`${styles.hero} flex flex-col gap-2`}
        aria-busy={coldLoading || refreshing || undefined}
      >
        {coldLoading ? (
          <>
            <Skeleton
              className="h-14 w-2/5 max-w-44"
              data-shimmer="savings-hero"
            />
            <SavingsNotice visuallyHidden>Updating…</SavingsNotice>
          </>
        ) : availableBalance ? (
          <>
            <p
              className={`${styles.heroAmount} text-amount font-mono ${funded ? "" : styles.heroAmountEmpty}`.trim()}
            >
              <MoneyTicker
                value={formatUsdStablecoinAmount(
                  availableBalance.totalBaseUnits,
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
                className={styles.heroEmpty}
                title="Nothing saved yet"
                description={
                  selected && loadState.status === "ready"
                    ? `Available vault · ${shortVaultLabel(selected.name)} · ${availableVaultApyLabel(selected, loadState.data, rateNowMs)}`
                    : undefined
                }
              />
            )}
            {refreshing ? (
              <p
                className={`${styles.heroMeta} text-metadata text-muted-foreground`}
                role="status"
              >
                Refreshing…
              </p>
            ) : refreshError ? (
              <p
                className={`${styles.heroMeta} text-metadata text-muted-foreground`}
                role="status"
              >
                Refresh unavailable
              </p>
            ) : null}
          </>
        ) : !sessionKey ? (
          <>
            <p
              className={`${styles.heroAmount} ${styles.heroAmountEmpty} text-amount font-mono`}
            >
              <MoneyTicker value="$0.00" />
            </p>
            <SavingsEmpty
              className={styles.heroEmpty}
              title="Nothing saved yet"
              description={
                selected && loadState.status === "ready"
                  ? `Available vault · ${shortVaultLabel(selected.name)} · ${availableVaultApyLabel(selected, loadState.data, rateNowMs)}`
                  : undefined
              }
            />
          </>
        ) : (
          <>
            <p className={`${styles.heroAmount} text-amount font-mono`}>
              <MoneyTicker value="—" />
            </p>
            <p
              className={`${styles.heroCaption} text-caption text-muted-foreground`}
              role="status"
            >
              Balance unavailable
            </p>
          </>
        )}
      </div>

      {loadState.status === "loading" ? (
        <section className={styles.vaults} aria-label="Vaults" aria-busy="true">
          <VaultListSkeleton />
          <SavingsNotice visuallyHidden>Loading vaults…</SavingsNotice>
        </section>
      ) : loadState.status === "error" ? (
        <SavingsNotice tone="error" role="alert">
          Vaults are temporarily unavailable.
        </SavingsNotice>
      ) : !coldLoading && !positionFailed && candidates.length > 0 ? (
        <section className={styles.vaults} aria-label="Vaults">
          <div
            className={`${styles.vaultList} flex flex-col gap-2.5`}
            role="radiogroup"
            aria-label="Vault"
          >
            {candidates.map((candidate) => {
              const isSelected =
                selected?.vaultAddress === candidate.vaultAddress;
              const balance = balances.find(
                (entry) =>
                  entry.vaultAddress.toLowerCase() ===
                  candidate.vaultAddress.toLowerCase(),
              );
              const rowValue = showBalanceRows ? (
                <MoneyTicker
                  value={
                    balance?.amount === null || balance?.amount === undefined
                      ? "—"
                      : formatUsdStablecoinAmount(balance.amount.toString())
                  }
                />
              ) : loadState.status === "ready" ? (
                availableVaultApyLabel(candidate, loadState.data, rateNowMs)
              ) : (
                "APY unavailable"
              );
              return (
                <ul
                  key={candidate.vaultAddress}
                  className={`${styles.vault} surface-primary ${isSelected ? styles.vaultSelected : ""}`.trim()}
                >
                  <li>
                    <Item
                      className={`${styles.vaultRow} min-h-16 flex-nowrap rounded-none border-0 px-4 py-3.5 text-left`}
                      render={
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() =>
                            setSelectedAddress(candidate.vaultAddress)
                          }
                          role="radio"
                          aria-checked={isSelected}
                          name="savings-vault"
                        />
                      }
                    >
                      <ItemContent className="min-w-0">
                        <ItemTitle className="text-row-label">
                          {candidate.name}
                        </ItemTitle>
                        {funded && loadState.status === "ready" ? (
                          <ItemDescription className="text-caption">
                            {fundedVaultApyLabel(
                              candidate,
                              loadState.data,
                              rateNowMs,
                            )}
                          </ItemDescription>
                        ) : null}
                      </ItemContent>
                      <ItemActions className="text-row-value justify-end text-right font-mono">
                        {rowValue}
                      </ItemActions>
                    </Item>
                  </li>
                  {isSelected ? (
                    <li className={styles.detailsBody}>
                      <dl className={styles.detailsFacts}>
                        <div className={styles.detailsFact}>
                          <dt>Fee</dt>
                          <dd>
                            {formatPresentationPercentage(selected.feeRate)}
                          </dd>
                        </div>
                        <div className={styles.detailsFact}>
                          <dt>Curator</dt>
                          <dd>
                            {selected.curatorAddress ? (
                              <CopyableValue
                                value={selected.curatorAddress}
                                display={formatAddress(selected.curatorAddress)}
                                valueKind="address"
                              />
                            ) : (
                              "—"
                            )}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ) : null}
                </ul>
              );
            })}
          </div>
        </section>
      ) : null}

      {loadState.status !== "error" && (availableBalance || !sessionKey) ? (
        <div
          className={`${styles.actions} ${funded ? styles.actionsSplit : ""}`.trim()}
        >
          <Button
            className={styles.action}
            disabled={!actionsReady}
            onClick={() => openAction("deposit")}
          >
            {funded ? "Deposit" : "Get started"}
          </Button>
          {funded ? (
            <Button
              className={styles.action}
              variant="secondary"
              disabled={!actionsReady || !canWithdraw}
              onClick={() => openAction("withdraw")}
            >
              Withdraw
            </Button>
          ) : null}
        </div>
      ) : null}

      {session && selected && prepareMoneyAction && executeMoneyAction ? (
        <SavingsMoneyDialog
          open={visibleActionMode !== null}
          mode={visibleActionMode ?? "deposit"}
          session={session}
          candidate={selected}
          availableLabel={
            visibleActionMode === "deposit"
              ? availableUsdcBaseUnits
                ? `${formatUsdStablecoinAmount(availableUsdcBaseUnits)} available`
                : undefined
              : selectedAmount !== null
                ? `${formatUsdStablecoinAmount(selectedAmount.toString())} available`
                : undefined
          }
          availableBaseUnits={
            visibleActionMode === "deposit"
              ? availableUsdcBaseUnits
              : (selectedAmount?.toString() ?? null)
          }
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          onClose={closeAction}
        />
      ) : null}
    </section>
  );
}

function availableVaultApyLabel(
  candidate: MorphoVaultCandidate,
  metadata: MorphoVaultsResult,
  nowMs: number,
): string {
  const rate = getSavingsRateState(candidate, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs,
  });
  if (rate.status === "stale") return "APY stale";
  if (rate.status === "unavailable") return "APY unavailable";
  return `${formatPresentationPercentage(rate.value)} APY`;
}

function fundedVaultApyLabel(
  candidate: MorphoVaultCandidate,
  metadata: MorphoVaultsResult,
  nowMs: number,
): string {
  const rate = getSavingsRateState(candidate, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs,
  });
  if (rate.status === "stale") return "APY stale";
  if (rate.status === "unavailable") return "APY unavailable";
  return formatPresentationPercentage(rate.value);
}

function FundedApyCaption({ apy }: { apy: SavingsApySummary }) {
  if (apy.status === "available") {
    return (
      <p className={`${styles.heroCaption} text-caption text-muted-foreground`}>
        Earning ~{formatExactSavingsApy(apy.value)}
      </p>
    );
  }
  if (apy.status === "partial") {
    return (
      <p
        className={`${styles.heroCaption} text-caption text-muted-foreground`}
        role="status"
      >
        APY partially unavailable
      </p>
    );
  }
  if (apy.status === "stale") {
    return (
      <p
        className={`${styles.heroCaption} text-caption text-muted-foreground`}
        role="status"
      >
        APY data stale
      </p>
    );
  }
  return (
    <p
      className={`${styles.heroCaption} text-caption text-muted-foreground`}
      role="status"
    >
      APY unavailable
    </p>
  );
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
        <EmptyTitle className="text-muted-foreground font-normal">
          {title}
        </EmptyTitle>
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
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function VaultListSkeleton() {
  return (
    <ul className={styles.vaultSkeletonList} aria-hidden="true">
      {[0, 1].map((index) => (
        <li
          key={index}
          className={styles.vaultSkeleton}
          data-shimmer="vault-row"
        >
          <Skeleton className={`${styles.vaultSkeletonName} h-4`} />
          <Skeleton className={`${styles.vaultSkeletonValue} h-4`} />
        </li>
      ))}
    </ul>
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
    const entry = state.data.vaults.find(
      (vault) =>
        vault.vaultAddress.toLowerCase() ===
        candidate.vaultAddress.toLowerCase(),
    );
    if (!entry) {
      return { vaultAddress: candidate.vaultAddress, amount: null };
    }
    if (!entry.position) {
      return { vaultAddress: candidate.vaultAddress, amount: BigInt(0) };
    }
    return {
      vaultAddress: candidate.vaultAddress,
      amount: readUsdcBaseUnits(entry.position.assetsRaw),
    };
  });
}

function parsePositionResult(
  value: unknown,
  expectedAddress: Address,
): PositionResult | null {
  if (
    !isRecord(value) ||
    typeof value.accountAddress !== "string" ||
    value.accountAddress.toLowerCase() !== expectedAddress.toLowerCase() ||
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    !Array.isArray(value.vaults)
  )
    return null;

  const configuredVaults = new Set(
    MORPHO_V1_CANDIDATE_ADDRESSES.map((address) => address.toLowerCase()),
  );
  const seenVaults = new Set<string>();
  const vaults: PositionResult["vaults"] = [];
  for (const entry of value.vaults) {
    if (!isRecord(entry) || typeof entry.vaultAddress !== "string") return null;
    const normalizedVault = entry.vaultAddress.toLowerCase();
    if (
      !configuredVaults.has(normalizedVault) ||
      seenVaults.has(normalizedVault)
    )
      return null;
    seenVaults.add(normalizedVault);
    if (
      entry.position !== null &&
      !isPosition(entry.position, expectedAddress, entry.vaultAddress)
    )
      return null;
    vaults.push({
      vaultAddress: entry.vaultAddress as Address,
      position: entry.position as MorphoVaultPosition | null,
    });
  }
  if (seenVaults.size !== configuredVaults.size) return null;
  return {
    accountAddress: expectedAddress,
    fetchedAt: value.fetchedAt,
    vaults,
  };
}

function isPosition(
  value: unknown,
  accountAddress: Address,
  vaultAddress: string,
) {
  return (
    isRecord(value) &&
    typeof value.accountAddress === "string" &&
    value.accountAddress.toLowerCase() === accountAddress.toLowerCase() &&
    typeof value.vaultAddress === "string" &&
    value.vaultAddress.toLowerCase() === vaultAddress.toLowerCase() &&
    (typeof value.assetsRaw === "string" || value.assetsRaw === null) &&
    typeof value.sharesRaw === "string" &&
    readUsdcBaseUnits(value.sharesRaw) !== null &&
    typeof value.indexedAt === "string" &&
    Number.isFinite(Date.parse(value.indexedAt)) &&
    isMorphoSource(value.source, "vaultPosition") &&
    value.withdrawableRaw === null &&
    typeof value.withdrawableNote === "string"
  );
}

function isUsablePositionResult(data: PositionResult): boolean {
  return data.vaults.every(
    (entry) =>
      entry.position === null ||
      readUsdcBaseUnits(entry.position.assetsRaw) !== null,
  );
}

async function fetchSavingsVaults(signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/savings/vaults", {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Vault request failed");
  return response.json();
}

function parseVaultsResult(value: unknown): MorphoVaultsResult | null {
  if (
    !isRecord(value) ||
    value.version !== "v1" ||
    value.chainId !== 8453 ||
    !isSavingsAsset(value.asset) ||
    !Array.isArray(value.candidates) ||
    !value.candidates.every(isVaultCandidate) ||
    !isMorphoSource(value.source, "vaults") ||
    typeof value.stale !== "boolean"
  )
    return null;
  const candidateAddresses = value.candidates.map((candidate) =>
    (candidate as MorphoVaultCandidate).vaultAddress.toLowerCase(),
  );
  if (new Set(candidateAddresses).size !== candidateAddresses.length)
    return null;
  return value as MorphoVaultsResult;
}

function isVaultCandidate(value: unknown): boolean {
  if (!isRecord(value) || typeof value.vaultAddress !== "string") return false;
  const vaultAddress = value.vaultAddress;
  return (
    value.version === "v1" &&
    MORPHO_V1_CANDIDATE_ADDRESSES.some(
      (address) => address.toLowerCase() === vaultAddress.toLowerCase(),
    ) &&
    typeof value.name === "string" &&
    typeof value.symbol === "string" &&
    typeof value.listed === "boolean" &&
    value.chainId === 8453 &&
    isSavingsAsset(value.asset) &&
    (value.netApy === null || typeof value.netApy === "number") &&
    (value.stateAsOf === null || typeof value.stateAsOf === "string") &&
    isMorphoSource(value.source, "vaults")
  );
}

function isSavingsAsset(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.address === "string" &&
    value.address.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() &&
    value.symbol === "USDC" &&
    value.decimals === BASE_USDC_DECIMALS
  );
}

function isMorphoSource(
  value: unknown,
  query: "vaults" | "vaultPosition",
): boolean {
  if (
    !isRecord(value) ||
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt))
  ) {
    return false;
  }
  if (query === "vaultPosition" && value.provider === "Base JSON-RPC") {
    return (
      typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber)
    );
  }
  return (
    value.provider === "Morpho GraphQL" &&
    value.endpoint === "https://api.morpho.org/graphql" &&
    value.query === query
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;
