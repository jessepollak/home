"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddressText } from "@/components/address";
import { useAccountWallet } from "@/features/account/cdp-client";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { useMoneyDataRefresh } from "@/features/money-actions/refresh";
import type { OperationResult, PreparedMoneyAction } from "@/features/money-actions/types";
import { usePortfolio } from "@/features/portfolio";
import {
  SavingsMoneyDialog,
  type SavingsActionMode,
} from "@/features/savings-actions/savings-actions";
import { MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import type {
  Address,
  MorphoVaultCandidate,
  MorphoVaultPosition,
  MorphoVaultsResult,
} from "@/server/morpho/types";
import {
  formatApy,
  formatUsdcUsd,
  readUsdcBaseUnits,
  shortVaultLabel,
} from "./format";
import styles from "./savings-experience.module.css";

type SavingsExperienceProps = {
  initialData?: MorphoVaultsResult | null;
  session?: VerifiedAccountSession | null;
  fetchPositions?: (signal?: AbortSignal) => Promise<unknown>;
  availableUsdcBaseUnits?: string | null;
  prepareMoneyAction?: (endpoint: string, input: unknown) => Promise<PreparedMoneyAction>;
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
  | { status: "ready"; data: PositionResult }
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
  availableUsdcBaseUnits = null,
  prepareMoneyAction,
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
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<SavingsActionMode | null>(null);
  const sessionAddress = session?.smartAccount?.address ?? null;
  const sessionKey = session && sessionAddress
    ? `${session.user.subject}:${session.accountProvider}:${sessionAddress}`
    : null;

  useEffect(() => {
    if (initialData) return;

    const controller = new AbortController();
    void fetch("/api/savings/vaults", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Vault request failed");
        return (await response.json()) as MorphoVaultsResult;
      })
      .then((data) => setLoadState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setLoadState({ status: "error", data: null });
      });

    return () => controller.abort();
  }, [initialData]);

  useEffect(() => {
    if (!sessionKey || !fetchPositions) return;

    const controller = new AbortController();
    void fetchPositions(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        const data = parsePositionResult(value, sessionAddress!);
        setPositionResult({
          key: sessionKey,
          state: data ? { status: "ready", data } : { status: "error" },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPositionResult({ key: sessionKey, state: { status: "error" } });
      });

    return () => controller.abort();
  }, [fetchPositions, positionRefreshTrigger, sessionAddress, sessionKey]);

  const handleActionConfirmed = useCallback(async (result: OperationResult) => {
    setPositionRefreshTrigger((value) => value + 1);
    await onActionConfirmed?.(result);
  }, [onActionConfirmed]);

  const positionState = useMemo<PositionState>(() => {
    if (!sessionKey) return { status: "idle" };
    return positionResult?.key === sessionKey
      ? positionResult.state
      : { status: "loading" };
  }, [positionResult, sessionKey]);

  const candidates = useMemo(() => {
    if (loadState.status !== "ready") return [];
    return [...loadState.data.candidates]
      .sort((left, right) => Number(/gauntlet/i.test(right.name)) - Number(/gauntlet/i.test(left.name)))
      .slice(0, 2);
  }, [loadState]);
  const selected = candidates.find((candidate) =>
    candidate.vaultAddress.toLowerCase() === (selectedAddress ?? "").toLowerCase(),
  ) ?? candidates[0] ?? null;

  const balances = useMemo(
    () => collectVaultBalances(candidates, positionState),
    [candidates, positionState],
  );
  const knownTotal = balances.reduce((sum, entry) => sum + (entry.amount ?? BigInt(0)), BigInt(0));
  const hasKnownBalance = balances.some((entry) => entry.amount !== null && entry.amount > BigInt(0));
  const hasUnknownBalance = balances.some((entry) => entry.present && entry.amount === null);
  const positionsReady = positionState.status === "ready";
  const positionsLoading = positionState.status === "loading";
  const positionsError = positionState.status === "error";
  const funded = hasKnownBalance;
  const selectedBalance = selected
    ? balances.find((entry) =>
      entry.vaultAddress.toLowerCase() === selected.vaultAddress.toLowerCase(),
    )
    : undefined;
  const selectedAmount = selectedBalance?.amount ?? null;
  const canWithdraw = Boolean(selectedAmount && selectedAmount > BigInt(0));
  const actionsReady = Boolean(
    session?.smartAccount && selected && prepareMoneyAction && executeMoneyAction,
  );

  return (
    <section className={styles.experience} aria-labelledby="savings-title">
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

      <div className={styles.hero}>
        <p
          className={`${styles.heroAmount} ${funded ? "" : styles.heroAmountEmpty}`.trim()}
        >
          {funded ? formatUsdcUsd(knownTotal.toString()) : "$0.00"}
        </p>
        {funded ? (
          <p className={styles.heroCaption}>
            Earning ~{formatApy(selected?.netApy)}
          </p>
        ) : positionsError || (hasUnknownBalance && positionsReady) ? (
          <p className={styles.heroCaption} role="status">Balances unavailable</p>
        ) : positionsLoading ? (
          <p className={styles.heroCaption} role="status">Updating…</p>
        ) : (
          <>
            <p className={styles.heroCaption}>Nothing saved yet</p>
            {selected ? (
              <p className={styles.heroMeta}>
                {shortVaultLabel(selected.name)} · {formatApy(selected.netApy)} APY
              </p>
            ) : null}
          </>
        )}
      </div>

      {loadState.status === "loading" ? (
        <p className={styles.status} role="status">Loading vaults…</p>
      ) : null}
      {loadState.status === "error" ? (
        <p className={styles.status} role="alert">Vaults are temporarily unavailable.</p>
      ) : null}

      {candidates.length > 0 ? (
        <section className={styles.vaults} aria-labelledby="savings-vaults-title">
          <h3 id="savings-vaults-title" className={styles.vaultKicker}>Vault</h3>
          <div className={styles.vaultList} role="radiogroup" aria-label="Vault">
            {candidates.map((candidate) => {
              const isSelected = selected?.vaultAddress === candidate.vaultAddress;
              const balance = balances.find((entry) =>
                entry.vaultAddress.toLowerCase() === candidate.vaultAddress.toLowerCase(),
              );
              return (
                <button
                  key={candidate.vaultAddress}
                  className={`${styles.vault} ${isSelected ? styles.vaultSelected : ""}`.trim()}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedAddress(candidate.vaultAddress)}
                >
                  <span className={styles.vaultName}>
                    <strong>{candidate.name}</strong>
                    {funded ? (
                      <span className={styles.vaultApy}>{formatApy(candidate.netApy)}</span>
                    ) : null}
                  </span>
                  {funded ? (
                    <span className={styles.vaultBalance}>
                      {balance?.amount === null
                        ? "—"
                        : formatUsdcUsd((balance?.amount ?? BigInt(0)).toString())}
                    </span>
                  ) : (
                    <span className={styles.vaultMeta}>{formatApy(candidate.netApy)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

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

      {selected ? (
        <details className={styles.details}>
          <summary>Details</summary>
          <div className={styles.detailsBody}>
            <dl>
              <div>
                <dt>Fee</dt>
                <dd>{formatApy(selected.feeRate)}</dd>
              </div>
              <div>
                <dt>Curator</dt>
                <dd>
                  {selected.curatorAddress ? (
                    <AddressText address={selected.curatorAddress} />
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </details>
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
          executeMoneyAction={executeMoneyAction}
          onClose={() => setActionMode(null)}
          onConfirmed={handleActionConfirmed}
        />
      ) : null}
    </section>
  );
}

function collectVaultBalances(
  candidates: MorphoVaultCandidate[],
  state: PositionState,
): Array<{ vaultAddress: string; present: boolean; amount: bigint | null }> {
  if (state.status !== "ready") {
    return candidates.map((candidate) => ({
      vaultAddress: candidate.vaultAddress,
      present: false,
      amount: BigInt(0),
    }));
  }

  return candidates.map((candidate) => {
    const entry = state.data.vaults.find((vault) =>
      vault.vaultAddress.toLowerCase() === candidate.vaultAddress.toLowerCase(),
    );
    if (!entry?.position) {
      return { vaultAddress: candidate.vaultAddress, present: false, amount: BigInt(0) };
    }
    return {
      vaultAddress: candidate.vaultAddress,
      present: true,
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
    typeof value.indexedAt === "string" &&
    value.withdrawableRaw === null;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
