"use client";

import { useEffect, useMemo, useState } from "react";
import { Stack } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import { CopyableValue } from "@/components/copyable-value";
import { useOptionalAppChrome } from "@/components/app-chrome";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { usePortfolio } from "@/client/portfolio";
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
  const portfolio = usePortfolio(portfolioSession, account.fetchPortfolio);
  const usdc = portfolio.snapshot?.assets.find((asset) => asset.id === "usdc");

  return (
    <SavingsExperience
      session={session}
      fetchPositions={account.fetchSavingsPositions}
      availableUsdcBaseUnits={usdc?.balanceBaseUnits ?? null}
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

  return (
    <section
      className={styles.experience}
      aria-label={hosted ? "Save" : undefined}
      aria-labelledby={hosted ? undefined : "savings-title"}
    >
      {hosted ? null : (
        <header className={styles.header}>
          {onBack ? (
            <button className={styles.back} type="button" onClick={onBack}>
              <span aria-hidden="true">←</span>
              <span className={styles.srOnly}>Back</span>
            </button>
          ) : (
            <span />
          )}
          <h2 id="savings-title" className={styles.title}>Save</h2>
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
            <span
              className={`shimmer ${styles.heroShimmer}`}
              data-shimmer="savings-hero"
              aria-hidden="true"
            />
            <p className="sr-status" role="status">Updating…</p>
          </>
        ) : availableBalance ? (
          <>
            <p
              className={`${styles.heroAmount} ${funded ? "" : styles.heroAmountEmpty}`.trim()}
            >
              <MoneyTicker value={formatUsdStablecoinAmount(availableBalance.totalBaseUnits)} />
            </p>
            {funded && portfolioSummary ? (
              loadState.status === "loading" ? (
                <>
                  <span
                    className={`shimmer ${styles.apyShimmer}`}
                    data-shimmer="savings-apy"
                    aria-hidden="true"
                  />
                  <span className="sr-status" role="status">Loading APY…</span>
                </>
              ) : (
                <FundedApyCaption apy={portfolioSummary.apy} />
              )
            ) : (
              <>
                <p className={styles.heroCaption}>Nothing saved yet</p>
                {selected && loadState.status === "ready" ? (
                  <p className={styles.heroMeta}>
                    Available vault · {shortVaultLabel(selected.name)} ·{" "}
                    {availableVaultApyLabel(selected, loadState.data, rateNowMs)}
                  </p>
                ) : null}
              </>
            )}
            {refreshing ? (
              <p className={styles.heroMeta} role="status">Refreshing…</p>
            ) : refreshError ? (
              <p className={styles.heroMeta} role="status">Refresh unavailable</p>
            ) : null}
          </>
        ) : !sessionKey ? (
          <>
            <p className={`${styles.heroAmount} ${styles.heroAmountEmpty}`}>
              <MoneyTicker value="$0.00" />
            </p>
            <p className={styles.heroCaption}>Nothing saved yet</p>
            {selected && loadState.status === "ready" ? (
              <p className={styles.heroMeta}>
                Available vault · {shortVaultLabel(selected.name)} ·{" "}
                {availableVaultApyLabel(selected, loadState.data, rateNowMs)}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.heroAmount}><MoneyTicker value="—" /></p>
            <p className={styles.heroCaption} role="status">Balance unavailable</p>
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
          <span className="sr-status" role="status">Loading vaults…</span>
        </section>
      ) : loadState.status === "error" ? (
        <p className={styles.status} role="alert">Vaults are temporarily unavailable.</p>
      ) : !coldLoading && !positionFailed && candidates.length > 0 ? (
        <section className={styles.vaults} aria-label="Vaults">
          <Stack className={styles.vaultList} space={{ custom: "10px" }} role="radiogroup" aria-label="Vault">
            {candidates.map((candidate) => {
              const isSelected = selected?.vaultAddress === candidate.vaultAddress;
              const balance = balances.find((entry) =>
                entry.vaultAddress.toLowerCase() === candidate.vaultAddress.toLowerCase(),
              );
              return (
                <div
                  key={candidate.vaultAddress}
                  className={`${styles.vault} surface-primary ${isSelected ? styles.vaultSelected : ""}`.trim()}
                >
                  <button
                    className={styles.vaultHeader}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedAddress(candidate.vaultAddress)}
                  >
                    <span className={styles.vaultName}>
                      <strong>{candidate.name}</strong>
                      {funded && loadState.status === "ready" ? (
                        <span className={styles.vaultApy}>
                          {fundedVaultApyLabel(candidate, loadState.data, rateNowMs)}
                        </span>
                      ) : null}
                    </span>
                    {showBalanceRows ? (
                      <span className={styles.vaultBalance}>
                        {balance?.amount === null || balance?.amount === undefined
                          ? "—"
                          : formatUsdStablecoinAmount(balance.amount.toString())}
                      </span>
                    ) : (
                      <span className={styles.vaultMeta}>
                        {loadState.status === "ready"
                          ? availableVaultApyLabel(candidate, loadState.data, rateNowMs)
                          : "APY unavailable"}
                      </span>
                    )}
                  </button>
                  {isSelected ? (
                    <div className={styles.detailsBody}>
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
                    </div>
                  ) : null}
                </div>
              );
            })}
          </Stack>
        </section>
      ) : null}

      {loadState.status !== "error" && (availableBalance || !sessionKey) ? (
        <div className={`${styles.actions} ${funded ? styles.actionsSplit : ""}`.trim()}>
          <button
            className={styles.primary}
            type="button"
            disabled={!actionsReady}
            onClick={() => setActionMode("deposit")}
          >
            {funded ? "Deposit" : "Get started"}
          </button>
          {funded ? (
            <button
              className={styles.secondary}
              type="button"
              disabled={!actionsReady || !canWithdraw}
              onClick={() => setActionMode("withdraw")}
            >
              Withdraw
            </button>
          ) : null}
        </div>
      ) : null}

      {session && selected && prepareMoneyAction && executeMoneyAction ? (
        <SavingsMoneyDialog
          open={actionMode !== null}
          mode={actionMode ?? "deposit"}
          session={session}
          candidate={selected}
          availableLabel={
            actionMode === "deposit"
              ? availableUsdcBaseUnits
                ? `${formatUsdStablecoinAmount(availableUsdcBaseUnits)} available`
                : undefined
              : selectedAmount !== null
                ? `${formatUsdStablecoinAmount(selectedAmount.toString())} available`
                : undefined
          }
          availableBaseUnits={
            actionMode === "deposit" ? availableUsdcBaseUnits : selectedAmount?.toString() ?? null
          }
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          onClose={() => setActionMode(null)}
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
      <p className={styles.heroCaption}>
        Earning ~{formatExactSavingsApy(apy.value)}
      </p>
    );
  }
  if (apy.status === "partial") {
    return <p className={styles.heroCaption} role="status">APY partially unavailable</p>;
  }
  if (apy.status === "stale") {
    return <p className={styles.heroCaption} role="status">APY data stale</p>;
  }
  return <p className={styles.heroCaption} role="status">APY unavailable</p>;
}

function VaultListSkeleton() {
  return (
    <ul className={styles.vaultSkeletonList} aria-hidden="true">
      {[0, 1].map((index) => (
        <li key={index} className={styles.vaultSkeleton} data-shimmer="vault-row">
          <span className={`shimmer ${styles.vaultSkeletonName}`} />
          <span className={`shimmer ${styles.vaultSkeletonValue}`} />
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

function parsePositionResult(value: unknown, expectedAddress: Address): PositionResult | null {
  if (
    !isRecord(value) ||
    typeof value.accountAddress !== "string" ||
    value.accountAddress.toLowerCase() !== expectedAddress.toLowerCase() ||
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    !Array.isArray(value.vaults)
  ) return null;

  const configuredVaults = new Set(
    MORPHO_V1_CANDIDATE_ADDRESSES.map((address) => address.toLowerCase()),
  );
  const seenVaults = new Set<string>();
  const vaults: PositionResult["vaults"] = [];
  for (const entry of value.vaults) {
    if (!isRecord(entry) || typeof entry.vaultAddress !== "string") return null;
    const normalizedVault = entry.vaultAddress.toLowerCase();
    if (!configuredVaults.has(normalizedVault) || seenVaults.has(normalizedVault)) return null;
    seenVaults.add(normalizedVault);
    if (entry.position !== null && !isPosition(entry.position, expectedAddress, entry.vaultAddress)) return null;
    vaults.push({
      vaultAddress: entry.vaultAddress as Address,
      position: entry.position as MorphoVaultPosition | null,
    });
  }
  if (seenVaults.size !== configuredVaults.size) return null;
  return { accountAddress: expectedAddress, fetchedAt: value.fetchedAt, vaults };
}

function isPosition(value: unknown, accountAddress: Address, vaultAddress: string) {
  return isRecord(value) &&
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
    typeof value.withdrawableNote === "string";
}

function isUsablePositionResult(data: PositionResult): boolean {
  return data.vaults.every((entry) =>
    entry.position === null || readUsdcBaseUnits(entry.position.assetsRaw) !== null
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
  ) return null;
  const candidateAddresses = value.candidates.map((candidate) =>
    (candidate as MorphoVaultCandidate).vaultAddress.toLowerCase()
  );
  if (new Set(candidateAddresses).size !== candidateAddresses.length) return null;
  return value as MorphoVaultsResult;
}

function isVaultCandidate(value: unknown): boolean {
  if (!isRecord(value) || typeof value.vaultAddress !== "string") return false;
  const vaultAddress = value.vaultAddress;
  return value.version === "v1" &&
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
    isMorphoSource(value.source, "vaults");
}

function isSavingsAsset(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.address === "string" &&
    value.address.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() &&
    value.symbol === "USDC" &&
    value.decimals === BASE_USDC_DECIMALS;
}

function isMorphoSource(value: unknown, query: "vaults" | "vaultPosition"): boolean {
  return isRecord(value) &&
    value.provider === "Morpho GraphQL" &&
    value.endpoint === "https://api.morpho.org/graphql" &&
    value.query === query &&
    typeof value.fetchedAt === "string" &&
    Number.isFinite(Date.parse(value.fetchedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;
