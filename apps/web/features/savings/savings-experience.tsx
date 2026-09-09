"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAccountWallet } from "@/features/account/cdp-client";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { useMoneyDataRefresh } from "@/features/money-actions/refresh";
import type { OperationResult } from "@/features/money-actions/types";
import {
  SavingsActions,
  type SavingsActionTransport,
} from "@/features/savings-actions/savings-actions";
import { AddressText } from "@/components/address";
import {
  formatPercentage,
  formatTokenAmount as formatBoundedTokenAmount,
} from "@/features/formatting";
import { MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import type {
  Address,
  MorphoVaultCandidate,
  MorphoVaultPosition,
  MorphoVaultsResult,
} from "@/server/morpho/types";
import styles from "./savings-experience.module.css";

type SavingsExperienceProps = {
  initialData?: MorphoVaultsResult | null;
  session?: VerifiedAccountSession | null;
  fetchPositions?: (signal?: AbortSignal) => Promise<unknown>;
  fetchAccountResource?: SavingsActionTransport;
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
  return (
    <SavingsExperience
      session={account.status === "verified" ? account.session : null}
      fetchPositions={account.fetchSavingsPositions}
      fetchAccountResource={account.fetchAccountResource}
      onActionConfirmed={async (result) => {
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
  fetchAccountResource,
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

  const positionState: PositionState = !sessionKey
    ? { status: "idle" }
    : positionResult?.key === sessionKey
      ? positionResult.state
      : { status: "loading" };

  return (
    <section className={styles.experience} aria-labelledby="savings-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Savings</p>
          <h2 id="savings-title">USDC</h2>
        </div>
        <span>Base · Morpho V1</span>
      </header>
      <nav className={styles.secondaryNavigation} aria-label="Related money tools">
        <Link href="/borrow">Borrow USDC against cbBTC →</Link>
      </nav>

      <PositionStatus session={session} state={positionState} />

      <section className={styles.comparison} aria-labelledby="rates-title">
        <div className={styles.comparisonHeading}>
          <div>
            <p className={styles.detailsKicker}>Rate comparison</p>
            <h3 id="rates-title">Vault candidates</h3>
          </div>
          <span>Variable rates · no default selection</span>
        </div>

        {loadState.status === "loading" ? <LoadingState /> : null}
        {loadState.status === "error" ? <ErrorState /> : null}
        {loadState.status === "ready" ? (
          <>
            <div className={styles.sourceRow}>
              <span>
                {loadState.data.stale ? "Stale fallback snapshot" : "Fetched snapshot"}
              </span>
              <time dateTime={loadState.data.source.fetchedAt}>
                As of {formatTimestamp(loadState.data.source.fetchedAt)}
              </time>
            </div>

            <div className={styles.candidateList} aria-label="Vault candidates">
              {loadState.data.candidates.map((candidate) => (
                <VaultCandidateRow key={candidate.vaultAddress} candidate={candidate} />
              ))}
            </div>
          </>
        ) : null}
      </section>

      {session?.smartAccount && fetchAccountResource && loadState.status === "ready" && loadState.data.candidates.length > 0 ? (
        <SavingsActions
          session={session}
          candidates={loadState.data.candidates}
          fetchAccountResource={fetchAccountResource}
          onConfirmed={handleActionConfirmed}
        />
      ) : (
        <div className={styles.actionBar} aria-label="Savings actions unavailable">
          <span>
            {!session?.smartAccount
              ? "Verify a Base smart account to prepare savings actions."
              : !fetchAccountResource
                ? "Authenticated savings action preparation is unavailable."
                : "Current configured vault data is unavailable."}
          </span>
          <button type="button" disabled>Deposit unavailable</button>
          <button type="button" disabled>Withdraw unavailable</button>
        </div>
      )}
    </section>
  );
}

function PositionStatus({
  session,
  state,
}: {
  session: VerifiedAccountSession | null;
  state: PositionState;
}) {
  let content: React.ReactNode;
  if (!session?.smartAccount || state.status === "idle") {
    content = <p>Position unavailable until account verification.</p>;
  } else if (state.status === "loading") {
    content = <p role="status">Loading supported vault positions…</p>;
  } else if (state.status === "error") {
    content = <p role="alert">Supported Morpho positions are temporarily unavailable.</p>;
  } else {
    const positions = state.data.vaults.flatMap((entry) =>
      entry.position ? [entry.position] : [],
    );
    content = positions.length === 0 ? (
      <p>
        No indexed position was found in the three supported vaults. This does not assert a zero spendable balance.
      </p>
    ) : (
      <div className={styles.positionList}>
        {positions.map((position) => (
          <article key={position.vaultAddress}>
            <div className={styles.positionValue}>
              <strong>{formatAssetAmount(position.assetsRaw, 6)}</strong>
              <span>Indexed assets · not max withdraw</span>
            </div>
            <dl className={styles.positionFacts}>
              <div><dt>Share base units</dt><dd>{formatShares(position.sharesRaw)}</dd></div>
              <div><dt>Vault</dt><dd><AddressText address={position.vaultAddress} /></dd></div>
              <div><dt>Indexed</dt><dd><time dateTime={position.indexedAt}>{formatTimestamp(position.indexedAt)}</time></dd></div>
            </dl>
          </article>
        ))}
        <p>Current withdrawable amount is not provided; no maxWithdraw claim is made.</p>
      </div>
    );
  }

  return (
    <section className={styles.position} aria-labelledby="position-title">
      <div>
        <p className={styles.detailsKicker}>Your position</p>
        <h3 id="position-title">Supported vault positions</h3>
      </div>
      {content}
    </section>
  );
}

function LoadingState() {
  return (
    <div className={styles.notice} role="status">
      <strong>Loading rate snapshots</strong>
      <span>No rate is shown until the source responds.</span>
    </div>
  );
}

function ErrorState() {
  return (
    <div className={styles.notice} role="alert">
      <strong>Rate data unavailable</strong>
      <span>No APY, fee, liquidity, or total is being assumed.</span>
    </div>
  );
}

function VaultCandidateRow({ candidate }: { candidate: MorphoVaultCandidate }) {
  return (
    <article className={styles.candidate}>
      <div className={styles.candidateSummary}>
        <span className={styles.candidateIdentity}>
          <strong>{candidate.name}</strong>
          <small>{candidate.symbol}</small>
        </span>
        <span className={styles.rate}>
          <small>Variable net APY</small>
          <strong>{formatRate(candidate.netApy)}</strong>
          <time dateTime={candidate.stateAsOf ?? undefined}>
            As of {candidate.stateAsOf ? formatTimestamp(candidate.stateAsOf) : "unavailable"}
          </time>
        </span>
      </div>

      <details className={styles.details}>
        <summary>Fees, liquidity, curator, addresses, and risks</summary>
        <div className={styles.detailsContent}>
          <p>Variable vault yield; no vault is selected or recommended.</p>
          <dl className={styles.metrics}>
            <Metric label="Vault fee" value={formatRate(candidate.feeRate)} note="Reported by Morpho V1" />
            <Metric label="Total assets" value={formatAssetAmount(candidate.totalAssetsRaw, 6)} note="Vault-wide, not your balance" />
            <Metric label="Indexed liquidity" value={formatAssetAmount(candidate.liquidityRaw, 6)} note="Not the account's max withdrawal" />
            <Metric label="Listing status" value={candidate.listed ? "Listed" : "Not listed"} note="Source snapshot status" />
          </dl>
          <div className={styles.provenance}>
            <div>
              <span>Curator address</span>
              {candidate.curatorAddress ? (
                <AddressText address={candidate.curatorAddress} />
              ) : (
                "Unavailable"
              )}
            </div>
            <div>
              <span>Vault address</span>
              <AddressText address={candidate.vaultAddress} />
            </div>
          </div>
        </div>
      </details>
    </article>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd><span>{value}</span><small>{note}</small></dd>
    </div>
  );
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

function formatRate(value: number | null) {
  return formatPercentage(value);
}

function formatAssetAmount(raw: string | null, decimals: number) {
  return raw === null
    ? "Unavailable"
    : `${formatBoundedTokenAmount(raw, decimals)} USDC`;
}

function formatShares(raw: string) {
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
