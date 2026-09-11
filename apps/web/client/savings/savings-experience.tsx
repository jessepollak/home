"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyableValue } from "@/components/copyable-value";
import { useOptionalAppChrome } from "@/components/app-chrome";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { useMoneyDataRefresh } from "@/client/money-actions/refresh";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { usePortfolio } from "@/client/portfolio";
import { formatAddress } from "@/shared/formatting";
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
  formatApy,
  formatUsdcUsd,
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

type SavingsExperienceProps = {
  initialData?: MorphoVaultsResult | null;
  session?: VerifiedAccountSession | null;
  fetchPositions?: (signal?: AbortSignal) => Promise<unknown>;
  fetchVaults?: (signal?: AbortSignal) => Promise<unknown>;
  now?: () => number;
  availableUsdcBaseUnits?: string | null;
  prepareMoneyAction?: (endpoint: string, input: unknown) => Promise<PreparedMoneyAction>;
  checkMoneyAction?: (action: PreparedMoneyAction) => Promise<OperationResult>;
  executeMoneyAction?: (action: PreparedMoneyAction) => Promise<OperationResult>;
  onBack?: () => void;
  onActionConfirmed?: (result: OperationResult) => void | Promise<void>;
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

export function AuthenticatedSavingsExperience({
  onActionConfirmed,
}: Pick<SavingsExperienceProps, "onActionConfirmed"> = {}) {
  const account = useAccountWallet();
  const refreshMoneyData = useMoneyDataRefresh();
  const session = account.status === "verified" ? account.session : null;
  const portfolioSession = session?.smartAccount
    ? {
        subject: session.user.subject,
        smartAccountAddress: session.smartAccount.address,
        chainId: session.smartAccount.chainId,
      }
    : null;
  const [portfolioTick, setPortfolioTick] = useState(0);
  const portfolio = usePortfolio(portfolioSession, account.fetchPortfolio, portfolioTick);
  const usdc = portfolio.snapshot?.assets.find((asset) => asset.id === "usdc");

  return (
    <SavingsExperience
      session={session}
      fetchPositions={account.fetchSavingsPositions}
      availableUsdcBaseUnits={usdc?.balanceBaseUnits ?? null}
      prepareMoneyAction={account.prepareMoneyAction}
      checkMoneyAction={account.checkMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
      onActionConfirmed={async (result) => {
        setPortfolioTick((tick) => tick + 1);
        refreshMoneyData();
        await onActionConfirmed?.(result);
      }}
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
  checkMoneyAction,
  executeMoneyAction,
  onBack,
  onActionConfirmed,
}: SavingsExperienceProps) {
  const [loadState, setLoadState] = useState<LoadState>(
    initialData
      ? { status: "ready", data: initialData }
      : { status: "loading", data: null },
  );
  const [positionResult, setPositionResult] = useState<{
    key: string;
    state: PositionState;
  } | null>(null);
  const [positionRefreshTrigger, setPositionRefreshTrigger] = useState(0);
  const [metadataRefreshTrigger, setMetadataRefreshTrigger] = useState(0);
  const [rateNowMs, setRateNowMs] = useState(() => now());
  const positionRequestSequence = useRef(0);
  const metadataRequestSequence = useRef(0);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<SavingsActionMode | null>(null);
  const hosted = Boolean(useOptionalAppChrome());
  const sessionAddress = session?.smartAccount?.address ?? null;
  const sessionKey = session && sessionAddress
    ? `${session.user.subject}:${session.accountProvider}:${sessionAddress}`
    : null;

  useEffect(() => {
    if (initialData && metadataRefreshTrigger === 0) return;

    const controller = new AbortController();
    const requestSequence = ++metadataRequestSequence.current;
    void fetchVaults(controller.signal)
      .then((value) => {
        if (
          controller.signal.aborted ||
          requestSequence !== metadataRequestSequence.current
        ) return;
        const data = parseVaultsResult(value);
        if (!data) {
          setLoadState((current) => current.status === "ready"
            ? current
            : { status: "error", data: null });
          return;
        }
        setRateNowMs(now());
        setLoadState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          requestSequence !== metadataRequestSequence.current ||
          isAbortError(error)
        ) return;
        setLoadState((current) => current.status === "ready"
          ? current
          : { status: "error", data: null });
      });

    return () => controller.abort();
  }, [fetchVaults, initialData, metadataRefreshTrigger, now]);

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

  useEffect(() => {
    if (!sessionKey || !fetchPositions) return;

    const controller = new AbortController();
    const requestSequence = ++positionRequestSequence.current;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setRateNowMs(now());
      setPositionResult((current) => {
        if (current?.key === sessionKey && current.state.status === "ready") {
          return {
            key: sessionKey,
            state: {
              ...current.state,
              refreshing: true,
              refreshError: false,
            },
          };
        }
        return { key: sessionKey, state: { status: "loading" } };
      });
    });

    void fetchPositions(controller.signal)
      .then((value) => {
        if (
          controller.signal.aborted ||
          requestSequence !== positionRequestSequence.current
        ) return;
        const data = parsePositionResult(value, sessionAddress!);
        setPositionResult((current) => {
          if (!data || !isUsablePositionResult(data)) {
            return retainVerifiedPositionOrError(current, sessionKey);
          }
          return {
            key: sessionKey,
            state: { status: "ready", data, refreshing: false, refreshError: false },
          };
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          requestSequence !== positionRequestSequence.current ||
          isAbortError(error)
        ) return;
        setPositionResult((current) => retainVerifiedPositionOrError(current, sessionKey));
      });

    return () => controller.abort();
  }, [fetchPositions, now, positionRefreshTrigger, sessionAddress, sessionKey]);

  const handleActionConfirmed = useCallback(async (result: OperationResult) => {
    setRateNowMs(now());
    setPositionRefreshTrigger((value) => value + 1);
    setMetadataRefreshTrigger((value) => value + 1);
    await onActionConfirmed?.(result);
  }, [now, onActionConfirmed]);

  const positionState = useMemo<PositionState>(() => {
    if (!sessionKey) return { status: "idle" };
    return positionResult?.key === sessionKey
      ? positionResult.state
      : { status: "loading" };
  }, [positionResult, sessionKey]);

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

      <div
        className={styles.hero}
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
              {formatUsdcUsd(availableBalance.totalBaseUnits)}
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
            <p className={`${styles.heroAmount} ${styles.heroAmountEmpty}`}>$0.00</p>
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
            <p className={styles.heroAmount}>—</p>
            <p className={styles.heroCaption} role="status">Balance unavailable</p>
          </>
        )}
      </div>

      {loadState.status === "loading" ? (
        <section
          className={styles.vaults}
          aria-labelledby="savings-vaults-title"
          aria-busy="true"
        >
          <h3 id="savings-vaults-title" className={styles.vaultKicker}>Vault</h3>
          <VaultListSkeleton />
          <span className="sr-status" role="status">Loading vaults…</span>
        </section>
      ) : loadState.status === "error" ? (
        <p className={styles.status} role="alert">Vaults are temporarily unavailable.</p>
      ) : !coldLoading && !positionFailed && candidates.length > 0 ? (
        <section className={styles.vaults} aria-labelledby="savings-vaults-title">
          <h3 id="savings-vaults-title" className={styles.vaultKicker}>Vault</h3>
          <div className={styles.vaultList} role="radiogroup" aria-label="Vault">
            {candidates.map((candidate) => {
              const isSelected = selected?.vaultAddress === candidate.vaultAddress;
              const balance = balances.find((entry) =>
                entry.vaultAddress.toLowerCase() === candidate.vaultAddress.toLowerCase(),
              );
              return (
                <div
                  key={candidate.vaultAddress}
                  className={`${styles.vault} ${isSelected ? styles.vaultSelected : ""}`.trim()}
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
                          : formatUsdcUsd(balance.amount.toString())}
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
                          <dd>{formatApy(selected.feeRate)}</dd>
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
          </div>
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

      {session && selected && prepareMoneyAction && checkMoneyAction && executeMoneyAction ? (
        <SavingsMoneyDialog
          open={actionMode !== null}
          mode={actionMode ?? "deposit"}
          session={session}
          candidate={selected}
          availableLabel={
            actionMode === "deposit"
              ? availableUsdcBaseUnits
                ? `${formatUsdcUsd(availableUsdcBaseUnits)} available`
                : undefined
              : selectedAmount !== null
                ? `${formatUsdcUsd(selectedAmount.toString())} available`
                : undefined
          }
          availableBaseUnits={
            actionMode === "deposit" ? availableUsdcBaseUnits : selectedAmount?.toString() ?? null
          }
          prepareMoneyAction={prepareMoneyAction}
          checkMoneyAction={checkMoneyAction}
          executeMoneyAction={executeMoneyAction}
          onClose={() => setActionMode(null)}
          onConfirmed={handleActionConfirmed}
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
  return `${formatApy(rate.value)} APY`;
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
  return formatApy(rate.value);
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

function retainVerifiedPositionOrError(
  current: { key: string; state: PositionState } | null,
  sessionKey: string,
): { key: string; state: PositionState } {
  if (current?.key === sessionKey && current.state.status === "ready") {
    return {
      key: sessionKey,
      state: {
        ...current.state,
        refreshing: false,
        refreshError: true,
      },
    };
  }
  return { key: sessionKey, state: { status: "error" } };
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BASE_USDC_ASSET = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: BASE_USDC_DECIMALS,
} as const;
