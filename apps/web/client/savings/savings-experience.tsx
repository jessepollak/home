"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Heading, ListRow, Skeleton, Stack, StatusMessage, Text } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import { CopyableValue } from "@/components/copyable-value";
import { useOptionalAppChrome } from "@/components/app-chrome";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
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
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { parseVaultsResult } from "@/shared/savings/contracts/vaults";
import {
  isUsablePositionResult,
  parsePositionResult,
  type SavingsPositionsResult,
} from "@/shared/savings/contracts/positions";
import {
  readUsdcBaseUnits,
  shortVaultLabel,
} from "./format";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  nextSavingsRateExpiryAt,
  summarizeSavingsPortfolio,
  type SavingsApySummary,
} from "./portfolio-summary";
import styles from "./savings-experience.module.css";
import { ownerQueryKey, ownerQueryMeta, publicQueryKey, useHomeQuery } from "@/client/query/query-client";
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
  prepareMoneyAction?: (endpoint: string, input: unknown) => Promise<PreparedMoneyAction>;
  executeMoneyAction?: (action: PreparedMoneyAction) => Promise<OperationResult>;
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
      data: SavingsPositionsResult;
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
  const portfolio = usePortfolioValuation(portfolioSession, "US", account.fetchPortfolioValuation);
  const usdc = portfolio.snapshot?.inventory.holdings.find(
    (holding) => holding.kind === "direct" && holding.id === "usdc",
  );
  const availableUsdcBaseUnits = usdc?.kind === "direct"
    ? usdc.balanceBaseUnits
    : null;

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
  const routedActionMode: SavingsActionMode | null = routing?.state.flow === "save-deposit"
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
  const loadState = useMemo<LoadState>(() => metadataQuery.data
    ? { status: "ready", data: metadataQuery.data }
    : metadataQuery.isError
      ? { status: "error", data: null }
      : { status: "loading", data: null }, [metadataQuery.data, metadataQuery.isError]);
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
      if (!fetchPositions) throw new Error("Savings positions are unavailable.");
      return fetchPositions(signal);
    },
    select: (value) => {
      if (!sessionAddress) throw new Error("Savings positions are unavailable.");
      const data = parsePositionResult(value, sessionAddress);
      if (!data || !isUsablePositionResult(data)) throw new Error("Savings positions are invalid.");
      return data;
    },
  });

  useEffect(() => {
    if (positionsQuery.dataUpdatedAt <= 0) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setRateNowMs(now());
    });
    return () => { active = false; };
  }, [now, positionsQuery.dataUpdatedAt]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    const expiresAt = nextSavingsRateExpiryAt(
      loadState.data.candidates,
      loadState.data.source.fetchedAt,
      rateNowMs,
    );
    if (expiresAt === null || expiresAt <= rateNowMs) return;
    const timeout = setTimeout(() => setRateNowMs(now()), expiresAt - rateNowMs);
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
  }, [positionsQuery.data, positionsQuery.isError, positionsQuery.isFetching, sessionKey]);

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
    return [...loadState.data.candidates]
      .sort((left, right) => Number(/gauntlet/i.test(right.name)) - Number(/gauntlet/i.test(left.name)));
  }, [loadState]);
  const candidates = allCandidates.slice(0, 2);
  const selected = candidates.find((candidate) =>
    candidate.vaultAddress.toLowerCase() === (selectedAddress ?? "").toLowerCase(),
  ) ?? candidates[0] ?? null;

  const portfolioSummary = useMemo(() => {
    if (positionState.status !== "ready") return null;
    return summarizeSavingsPortfolio({
      supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
      requiredAsset: loadState.status === "ready" ? loadState.data.asset : BASE_USDC_ASSET,
      candidates: loadState.status === "ready" ? loadState.data.candidates : [],
      positions: positionState.data.vaults,
      metadataFetchedAt: loadState.status === "ready" ? loadState.data.source.fetchedAt : null,
      metadataStale: loadState.status === "ready" && loadState.data.stale,
      nowMs: rateNowMs,
    });
  }, [loadState, positionState, rateNowMs]);
  const balances = collectVaultBalances(candidates, positionState);
  const coldLoading = Boolean(sessionKey && positionState.status === "loading");
  const positionFailed = Boolean(sessionKey && positionState.status === "error");
  const refreshing = positionState.status === "ready" && positionState.refreshing;
  const refreshError = positionState.status === "ready" && positionState.refreshError;
  const funded = portfolioSummary?.funded ?? false;
  const availableBalance = portfolioSummary?.balance.status === "available"
    ? portfolioSummary.balance
    : null;
  const showBalanceRows = funded || Boolean(sessionKey && !availableBalance);
  const selectedBalance = selected
    ? balances.find((entry) =>
      entry.vaultAddress.toLowerCase() === selected.vaultAddress.toLowerCase(),
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
            <Button className={styles.back} variant="quiet" onClick={onBack} aria-label="Back">
              <span aria-hidden="true">←</span>
            </Button>
          ) : (
            <span />
          )}
          <Heading level={2} textStyle="sheet-title" id="savings-title" className={styles.title}>Save</Heading>
          <span />
        </header>
      )}

      <Stack
        className={styles.hero}
        space="2"
        aria-busy={coldLoading || refreshing || undefined}
      >
        {coldLoading ? (
          <>
            <Skeleton
              shape="rectangle"
              width="min(48%, 11.5rem)"
              height="3.4rem"
              data-shimmer="savings-hero"
            />
            <StatusMessage visuallyHidden>Updating…</StatusMessage>
          </>
        ) : availableBalance ? (
          <>
            <Text
              textStyle="amount"
              className={`${styles.heroAmount} ${funded ? "" : styles.heroAmountEmpty}`.trim()}
            >
              <MoneyTicker value={formatUsdStablecoinAmount(availableBalance.totalBaseUnits)} />
            </Text>
            {funded && portfolioSummary ? (
              loadState.status === "loading" ? (
                <>
                  <Skeleton
                    shape="text"
                    width="7rem"
                    height="0.9rem"
                    data-shimmer="savings-apy"
                  />
                  <StatusMessage visuallyHidden>Loading APY…</StatusMessage>
                </>
              ) : (
                <FundedApyCaption apy={portfolioSummary.apy} />
              )
            ) : (
              <EmptyState
                className={styles.heroEmpty}
                title="Nothing saved yet"
                description={selected && loadState.status === "ready"
                  ? `Available vault · ${shortVaultLabel(selected.name)} · ${availableVaultApyLabel(selected, loadState.data, rateNowMs)}`
                  : undefined}
              />
            )}
            {refreshing ? (
              <Text className={styles.heroMeta} textStyle="metadata" tone="muted" role="status">Refreshing…</Text>
            ) : refreshError ? (
              <Text className={styles.heroMeta} textStyle="metadata" tone="muted" role="status">Refresh unavailable</Text>
            ) : null}
          </>
        ) : !sessionKey ? (
          <>
            <Text textStyle="amount" className={`${styles.heroAmount} ${styles.heroAmountEmpty}`}>
              <MoneyTicker value="$0.00" />
            </Text>
            <EmptyState
              className={styles.heroEmpty}
              title="Nothing saved yet"
              description={selected && loadState.status === "ready"
                ? `Available vault · ${shortVaultLabel(selected.name)} · ${availableVaultApyLabel(selected, loadState.data, rateNowMs)}`
                : undefined}
            />
          </>
        ) : (
          <>
            <Text textStyle="amount" className={styles.heroAmount}><MoneyTicker value="—" /></Text>
            <Text className={styles.heroCaption} textStyle="secondary" tone="muted" role="status">Balance unavailable</Text>
          </>
        )}
      </Stack>

      {loadState.status === "loading" ? (
        <section
          className={styles.vaults}
          aria-label="Vaults"
          aria-busy="true"
        >
          <VaultListSkeleton />
          <StatusMessage visuallyHidden>Loading vaults…</StatusMessage>
        </section>
      ) : loadState.status === "error" ? (
        <StatusMessage tone="error" role="alert">Vaults are temporarily unavailable.</StatusMessage>
      ) : !coldLoading && !positionFailed && candidates.length > 0 ? (
        <section className={styles.vaults} aria-label="Vaults">
          <Stack className={styles.vaultList} space={{ custom: "10px" }} role="radiogroup" aria-label="Vault">
            {candidates.map((candidate) => {
              const isSelected = selected?.vaultAddress === candidate.vaultAddress;
              const balance = balances.find((entry) =>
                entry.vaultAddress.toLowerCase() === candidate.vaultAddress.toLowerCase(),
              );
              return (
                <ul
                  key={candidate.vaultAddress}
                  className={`${styles.vault} surface-primary ${isSelected ? styles.vaultSelected : ""}`.trim()}
                >
                  <ListRow
                    className={styles.vaultRow}
                    label={candidate.name}
                    description={funded && loadState.status === "ready"
                      ? fundedVaultApyLabel(candidate, loadState.data, rateNowMs)
                      : undefined}
                    value={showBalanceRows ? (
                      <MoneyTicker
                        value={balance?.amount === null || balance?.amount === undefined
                          ? "—"
                          : formatUsdStablecoinAmount(balance.amount.toString())}
                      />
                    ) : loadState.status === "ready"
                      ? availableVaultApyLabel(candidate, loadState.data, rateNowMs)
                      : "APY unavailable"}
                    onPress={() => setSelectedAddress(candidate.vaultAddress)}
                    role="radio"
                    aria-checked={isSelected}
                    name="savings-vault"
                  />
                  {isSelected ? (
                    <li className={styles.detailsBody}>
                      <dl className={styles.detailsFacts}>
                        <div className={styles.detailsFact}>
                          <dt>Fee</dt>
                          <dd>{formatPresentationPercentage(selected.feeRate)}</dd>
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
          </Stack>
        </section>
      ) : null}

      {loadState.status !== "error" && (availableBalance || !sessionKey) ? (
        <div className={`${styles.actions} ${funded ? styles.actionsSplit : ""}`.trim()}>
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
              : selectedAmount?.toString() ?? null
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
      <Text className={styles.heroCaption} textStyle="secondary" tone="muted">
        Earning ~{formatExactSavingsApy(apy.value)}
      </Text>
    );
  }
  if (apy.status === "partial") {
    return <Text className={styles.heroCaption} textStyle="secondary" tone="muted" role="status">APY partially unavailable</Text>;
  }
  if (apy.status === "stale") {
    return <Text className={styles.heroCaption} textStyle="secondary" tone="muted" role="status">APY data stale</Text>;
  }
  return <Text className={styles.heroCaption} textStyle="secondary" tone="muted" role="status">APY unavailable</Text>;
}

function VaultListSkeleton() {
  return (
    <ul className={styles.vaultSkeletonList} aria-hidden="true">
      {[0, 1].map((index) => (
        <li key={index} className={styles.vaultSkeleton} data-shimmer="vault-row">
          <Skeleton shape="text" className={styles.vaultSkeletonName} />
          <Skeleton shape="text" className={styles.vaultSkeletonValue} />
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
    const entry = state.data.vaults.find((vault) =>
      vault.vaultAddress.toLowerCase() === candidate.vaultAddress.toLowerCase(),
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

async function fetchSavingsVaults(signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/savings/vaults", {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Vault request failed");
  return response.json();
}

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;
