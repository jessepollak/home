import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import { shortVaultLabel } from "@/client/savings/format";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  summarizeSavingsPortfolio,
  type SavingsPortfolioPosition,
} from "@/client/savings/portfolio-summary";
import {
  formatAddress,
  formatPresentationDate,
  formatPresentationFiat,
  formatPresentationPercentage,
  formatPresentationTokenAmount,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import { condensedTransactionHash } from "@/components/transaction-explorer";
import type { ActivityTransfer } from "@/shared/activity/types";
import { BASE_USDC_DECIMALS } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { presentActivityTransferRow } from "@/client/activity/activity-presenter";

/**
 * Money-state model for the Home reimagined exploration of
 * [issue #662](https://github.com/jessepollak/home/issues/662).
 *
 * This module is exploration-only presentation source. It is not imported by `HomeShell`,
 * any route, or any production surface, and it reaches no provider, database, wallet, or
 * live service. Every amount stays in unsigned base units and every derivation runs in
 * `BigInt`, so the exploration cannot round money while it is moving.
 *
 * The model separates three facts the exploration must never blur:
 * - net position: cash + saved − debt, and only when every slice is verified
 * - available to use: the cash slice alone
 * - in-flight movement: recorded before it settles, and never committed to balances
 *   unless the outcome is confirmed.
 */

export type ExplorationAmountSlice =
  | { status: "loading" }
  | { status: "available"; baseUnits: string }
  | { status: "unavailable" };

export type ExplorationSavedSlice =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "available";
      metadata: MorphoVaultsResult;
      positions: readonly SavingsPortfolioPosition[];
    };

export type ExplorationDebtSlice =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "verified"; baseUnits: string };

/** A local cash holding without a configured display quote; it stays out of the total. */
export type ExplorationLocalCash = {
  key: string;
  name: string;
  currency: FiatCurrencyCode;
  atoms: string;
  scale: number;
};

export type ExplorationMovementStatus = "pending" | "unknown" | "failed" | "confirmed";

export type ExplorationMovement = {
  id: string;
  kind: "save";
  vaultAddress: string;
  vaultName: string;
  /** Unsigned USDC base units the movement asked to move. */
  amountBaseUnits: string;
  status: ExplorationMovementStatus;
  recordedAt: string;
  resolvedAt: string | null;
  transactionHash: string | null;
};

export type ExplorationMoneyState = {
  status: "loading" | "ready";
  cash: ExplorationAmountSlice;
  saved: ExplorationSavedSlice;
  debt: ExplorationDebtSlice;
  localCash?: readonly ExplorationLocalCash[];
  history: readonly ActivityTransfer[];
  movements: readonly ExplorationMovement[];
  nowMs: number;
  regionId: RegionId;
};

export type ExplorationVaultView = {
  vaultAddress: string;
  name: string;
  shortName: string;
  amountBaseUnits: string;
  amountLabel: string;
  apyLabel: string | null;
  /**
   * A rate the vault's own source reported for this exact read. When false the rate is
   * missing or stale and the row says so rather than showing a nearby number.
   */
  apyCurrent: boolean;
  funded: boolean;
};

export type ExplorationCashRow = {
  key: string;
  name: string;
  amountLabel: string;
  /** False for a holding the net position cannot include yet. */
  countedInTotal: boolean;
};

export type ExplorationPositionView = {
  status: "loading" | "ready" | "partial";
  netPositionLabel: string | null;
  assetsLabel: string | null;
  availableLabel: string | null;
  savedLabel: string | null;
  savedFunded: boolean;
  apyLabel: string | null;
  debtLabel: string | null;
  /** True only for a verified zero-debt read, so a zero can be stated without a number. */
  debtSettled: boolean;
  vaults: readonly ExplorationVaultView[];
  fundedVaults: number;
  cashRows: readonly ExplorationCashRow[];
  reconciliationLabel: string | null;
  notes: readonly string[];
};

export function usdcLabel(baseUnits: string, regionId: RegionId): string {
  return formatUsdStablecoinAmount(baseUnits, BASE_USDC_DECIMALS, regionId);
}

export function presentExplorationPosition(
  state: ExplorationMoneyState,
): ExplorationPositionView {
  if (state.status === "loading") {
    return {
      status: "loading",
      netPositionLabel: null,
      assetsLabel: null,
      availableLabel: null,
      savedLabel: null,
      savedFunded: false,
      apyLabel: null,
      debtLabel: null,
      debtSettled: false,
      vaults: [],
      fundedVaults: 0,
      cashRows: [],
      reconciliationLabel: null,
      notes: [],
    };
  }

  const { regionId } = state;
  const cashBaseUnits = state.cash.status === "available" ? state.cash.baseUnits : null;
  const savedSummary = state.saved.status === "available"
    ? summarizeSavingsPortfolio({
        supportedVaultAddresses: state.saved.metadata.candidates.map(
          (candidate) => candidate.vaultAddress,
        ),
        requiredAsset: state.saved.metadata.asset,
        candidates: state.saved.metadata.candidates,
        positions: state.saved.positions,
        metadataFetchedAt: state.saved.metadata.source.fetchedAt,
        metadataStale: state.saved.metadata.stale,
        nowMs: state.nowMs,
      })
    : null;
  const savedBaseUnits = savedSummary?.balance.status === "available"
    ? savedSummary.balance.totalBaseUnits
    : null;

  const vaults = state.saved.status === "available"
    ? presentVaults(state.saved, savedSummary, regionId, state.nowMs)
    : [];

  const debtBaseUnits = state.debt.status === "verified" ? state.debt.baseUnits : null;
  const debtVerified = debtBaseUnits === null ? null : BigInt(debtBaseUnits);
  const debtSettled = debtVerified !== null && debtVerified === BigInt(0);
  const assetsAtoms = cashBaseUnits !== null && savedBaseUnits !== null
    ? BigInt(cashBaseUnits) + BigInt(savedBaseUnits)
    : null;
  const netAtoms = assetsAtoms !== null && debtVerified !== null
    ? assetsAtoms - debtVerified
    : null;

  const notes: string[] = [];
  if (state.cash.status === "loading") notes.push("Cash balance is still loading.");
  if (state.cash.status === "unavailable") {
    notes.push("Cash balance is unavailable, so the net position is incomplete.");
  }
  if (state.saved.status === "loading") notes.push("Saved balance is still loading.");
  if (state.saved.status === "unavailable") {
    notes.push("Saved balance is unavailable, so the net position is incomplete.");
  }
  if (savedSummary?.balance.status === "unavailable") {
    notes.push(
      savedSummary.balance.reason === "asset-mismatch"
        ? "A vault reports a different asset, so the saved total is incomplete."
        : "A vault position is missing, so the saved total is incomplete.",
    );
  }
  if (savedSummary?.apy.status === "partial") {
    notes.push("A funded vault has no current rate, so the weighted rate is incomplete.");
  }
  if (savedSummary?.apy.status === "stale") {
    notes.push("Vault rates are stale; the weighted rate is held back until they refresh.");
  }
  if (state.debt.status === "loading") notes.push("Debt is still loading.");
  if (state.debt.status === "unavailable") {
    notes.push("Debt is unavailable, so the net position is incomplete.");
  }
  const excludedLocalCash = state.localCash ?? [];
  if (excludedLocalCash.length > 0) {
    notes.push(
      `${excludedLocalCash.map((entry) => entry.currency).join(" and ")} ${
        excludedLocalCash.length === 1 ? "balance is" : "balances are"
      } not included until a display quote is configured.`,
    );
  }

  const complete = cashBaseUnits !== null && savedBaseUnits !== null && debtBaseUnits !== null;

  return {
    status: complete ? "ready" : "partial",
    netPositionLabel: netAtoms === null ? null : usdcLabel(netAtoms.toString(), regionId),
    assetsLabel: assetsAtoms === null ? null : usdcLabel(assetsAtoms.toString(), regionId),
    availableLabel: cashBaseUnits === null ? null : usdcLabel(cashBaseUnits, regionId),
    savedLabel: savedBaseUnits === null ? null : usdcLabel(savedBaseUnits, regionId),
    savedFunded: savedSummary?.funded ?? false,
    apyLabel: savedSummary?.apy.status === "available"
      ? `${formatExactSavingsApy(savedSummary.apy.value)} APY`
      : null,
    debtLabel: debtBaseUnits === null || debtSettled ? null : usdcLabel(debtBaseUnits, regionId),
    debtSettled,
    vaults,
    fundedVaults: vaults.filter((vault) => vault.funded).length,
    cashRows: presentCashRows(state, cashBaseUnits, regionId),
    reconciliationLabel:
      cashBaseUnits !== null && savedBaseUnits !== null && debtBaseUnits !== null
        ? `${usdcLabel(cashBaseUnits, regionId)} available + ${usdcLabel(savedBaseUnits, regionId)} saved − ${usdcLabel(debtBaseUnits, regionId)} debt`
        : null,
    notes,
  };
}

function presentVaults(
  saved: Extract<ExplorationSavedSlice, { status: "available" }>,
  summary: ReturnType<typeof summarizeSavingsPortfolio> | null,
  regionId: RegionId,
  nowMs: number,
): ExplorationVaultView[] {
  const balanceByAddress = new Map(
    (summary?.vaults ?? []).map((vault) => [vault.vaultAddress.toLowerCase(), vault.balanceBaseUnits]),
  );
  const views = saved.metadata.candidates.map((candidate): ExplorationVaultView => {
    const amountBaseUnits = balanceByAddress.get(candidate.vaultAddress.toLowerCase()) ?? "0";
    return {
      vaultAddress: candidate.vaultAddress,
      name: candidate.name,
      shortName: shortVaultLabel(candidate.name),
      amountBaseUnits,
      amountLabel: usdcLabel(amountBaseUnits, regionId),
      apyLabel: vaultApyLabel(candidate, saved.metadata, nowMs, regionId),
      apyCurrent: hasCurrentRate(candidate, saved.metadata, nowMs),
      funded: BigInt(amountBaseUnits) > BigInt(0),
    };
  });
  // Funded vaults lead, largest first; an empty vault stays reachable but quiet.
  return views.sort((left, right) => {
    if (left.funded !== right.funded) return left.funded ? -1 : 1;
    const difference = BigInt(right.amountBaseUnits) - BigInt(left.amountBaseUnits);
    if (difference !== BigInt(0)) return difference > BigInt(0) ? 1 : -1;
    return left.name.localeCompare(right.name);
  });
}

function vaultApyLabel(
  candidate: MorphoVaultCandidate,
  metadata: MorphoVaultsResult,
  nowMs: number,
  regionId: RegionId,
): string | null {
  const rate = getSavingsRateState(candidate, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs,
  });
  if (rate.status === "stale") return "Rate stale";
  if (rate.status === "unavailable") return null;
  return `${formatPresentationPercentage(rate.value, regionId)} APY`;
}

function hasCurrentRate(
  candidate: MorphoVaultCandidate,
  metadata: MorphoVaultsResult,
  nowMs: number,
): boolean {
  return getSavingsRateState(candidate, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs,
  }).status === "available";
}

function presentCashRows(
  state: ExplorationMoneyState,
  cashBaseUnits: string | null,
  regionId: RegionId,
): ExplorationCashRow[] {
  const rows: ExplorationCashRow[] = [];
  if (cashBaseUnits !== null) {
    rows.push({
      key: "reimagined-cash-usd",
      name: "US dollar",
      amountLabel: usdcLabel(cashBaseUnits, regionId),
      countedInTotal: true,
    });
  }
  for (const local of state.localCash ?? []) {
    rows.push({
      key: local.key,
      name: local.name,
      amountLabel: formatPresentationFiat(
        { atoms: local.atoms, scale: local.scale },
        local.currency,
        2,
        regionId,
      ),
      countedInTotal: false,
    });
  }
  return rows;
}

export function availableCashBaseUnits(state: ExplorationMoneyState): string | null {
  return state.cash.status === "available" ? state.cash.baseUnits : null;
}

export type MoveMoneyOutcome = {
  status: ExplorationMovementStatus;
  transactionHash?: string;
};

/** Records the intent. The movement is pending until an outcome settles it. */
export function appendMovement(
  state: ExplorationMoneyState,
  movement: ExplorationMovement,
): ExplorationMoneyState {
  if (state.movements.some((existing) => existing.id === movement.id)) return state;
  return { ...state, movements: [movement, ...state.movements] };
}

/**
 * Settles a recorded movement exactly once.
 *
 * A movement that is no longer pending is left untouched, so a late or duplicate
 * outcome can never move money twice. Only `confirmed` changes balances; `pending`,
 * `unknown`, and `failed` record the outcome and leave cash and vaults exactly as they
 * were. Nothing here retries a movement on its own.
 */
export function settleMovement(
  state: ExplorationMoneyState,
  movementId: string,
  outcome: MoveMoneyOutcome,
  resolvedAt: string,
): ExplorationMoneyState {
  const movement = state.movements.find((entry) => entry.id === movementId);
  if (!movement || movement.status !== "pending") return state;

  const settled: ExplorationMovement = {
    ...movement,
    status: outcome.status,
    resolvedAt,
    transactionHash: outcome.transactionHash ?? null,
  };
  const withSettled = {
    ...state,
    movements: state.movements.map((entry) => (entry.id === movementId ? settled : entry)),
  };
  if (outcome.status !== "confirmed") return withSettled;
  return creditVaultFromCash(withSettled, movement.vaultAddress, movement.amountBaseUnits);
}

/**
 * Moves money between two verified slices of the same state. A guard, not a fallback:
 * if a slice is not verified or the cash cannot cover the amount, balances stay
 * untouched instead of inventing a source or a destination.
 */
function creditVaultFromCash(
  state: ExplorationMoneyState,
  vaultAddress: string,
  amountBaseUnits: string,
): ExplorationMoneyState {
  if (state.cash.status !== "available" || state.saved.status !== "available") return state;
  const amount = BigInt(amountBaseUnits);
  const cash = BigInt(state.cash.baseUnits);
  if (amount <= BigInt(0) || cash < amount) return state;

  const metadata = state.saved.metadata;
  const positions = state.saved.positions.map((position) =>
    position.vaultAddress.toLowerCase() === vaultAddress.toLowerCase()
      ? {
          ...position,
          position: {
            assetsRaw: (BigInt(position.position?.assetsRaw ?? "0") + amount).toString(10),
          },
        }
      : position,
  );
  if (
    !metadata.candidates.some(
      (candidate) => candidate.vaultAddress.toLowerCase() === vaultAddress.toLowerCase(),
    )
  ) {
    return state;
  }

  return {
    ...state,
    cash: { status: "available", baseUnits: (cash - amount).toString(10) },
    saved: { ...state.saved, positions },
  };
}

export type ExplorationActivityEntry = {
  id: string;
  occurredAt: string;
  groupKey: string;
  groupLabel: string;
  title: string;
  /** Signed presentation string, e.g. `+$250.00` or `−$100.00`. */
  amountLabel: string;
  dateLabel: string;
  detail: string;
  status: ExplorationMovementStatus;
  /** The status as a word: Pending, Failed, Unknown, Confirmed. */
  statusLabel: string;
  movementId: string | null;
};

export type ExplorationActivityView = {
  entries: readonly ExplorationActivityEntry[];
  unresolved: readonly ExplorationActivityEntry[];
  settled: readonly ExplorationActivityEntry[];
  groups: readonly { key: string; label: string; entries: readonly ExplorationActivityEntry[] }[];
  needsAttention: number;
};

export function movementStatusLabel(status: ExplorationMovementStatus): string {
  switch (status) {
    case "pending": return "Pending";
    case "failed": return "Failed";
    case "unknown": return "Unknown";
    case "confirmed": return "Confirmed";
  }
}

/**
 * The recorded action's own title. The verb follows the outcome, so a pending deposit never
 * reads as money that moved and a failed one never reads as saved.
 */
export function movementTitle(movement: ExplorationMovement): string {
  switch (movement.status) {
    case "pending": return `Depositing to ${movement.vaultName}`;
    case "failed": return `Deposit to ${movement.vaultName} failed`;
    case "unknown": return `Deposit to ${movement.vaultName} unconfirmed`;
    case "confirmed": return `Saved to ${movement.vaultName}`;
  }
}

/**
 * A movement is not a debit: the money either has not moved, or moved between two of the
 * person's own slices. Unsigned token notation matches the amount format the activity rows
 * already use, and never claims money left the account.
 */
export function movementAmountLabel(baseUnits: string, regionId: RegionId): string {
  return formatPresentationTokenAmount(
    BigInt(baseUnits),
    BASE_USDC_DECIMALS,
    "USDC",
    { cashCurrency: "USD", regionId },
  );
}

export function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

export type ExplorationMovementReceipt = {
  statusLabel: string;
  /** When the outcome was recorded, or when the intent was recorded while unsettled. */
  timeLabel: string;
  /** The recorded transaction reference, or an honest "not issued" while unsettled. */
  referenceLabel: string;
  amountLabel: string;
  destinationName: string;
};

export function presentMovementReceipt(
  movement: ExplorationMovement,
  regionId: RegionId,
): ExplorationMovementReceipt {
  const settledAt = movement.resolvedAt ?? movement.recordedAt;
  return {
    statusLabel: movementStatusLabel(movement.status),
    timeLabel: formatPresentationDate(settledAt, { regionId, style: "activity-full" }),
    referenceLabel: movement.transactionHash
      ? condensedTransactionHash(movement.transactionHash)
      : "Not issued",
    amountLabel: movementAmountLabel(movement.amountBaseUnits, regionId),
    destinationName: movement.vaultName,
  };
}

/**
 * Chain history and recorded movements in one newest-first list. A movement keeps its
 * own status instead of borrowing the shape of a settled transfer.
 */
export function presentExplorationActivity(
  state: ExplorationMoneyState,
): ExplorationActivityView {
  const regionId = state.regionId;
  const transfers = state.history.map((transfer): ExplorationActivityEntry => {
    const row = presentActivityTransferRow(transfer, { regionId });
    return {
      id: `transfer:${transfer.id}`,
      occurredAt: transfer.blockTimestamp,
      groupKey: dayKey(transfer.blockTimestamp),
      groupLabel: formatPresentationDate(transfer.blockTimestamp, { regionId, style: "chart-date" }),
      title: `${row.directionLabel} ${transfer.tokenSymbol ?? "token"}`,
      amountLabel: row.value,
      dateLabel: row.fullDate,
      detail: transfer.direction === "incoming"
        ? `From ${formatAddress(transfer.fromAddress)}`
        : `To ${formatAddress(transfer.toAddress)}`,
      status: "confirmed",
      statusLabel: movementStatusLabel("confirmed"),
      movementId: null,
    };
  });
  const movements = state.movements.map((movement): ExplorationActivityEntry => ({
    id: `movement:${movement.id}`,
    occurredAt: movement.recordedAt,
    groupKey: dayKey(movement.recordedAt),
    groupLabel: formatPresentationDate(movement.recordedAt, { regionId, style: "chart-date" }),
    title: movementTitle(movement),
    amountLabel: movementAmountLabel(movement.amountBaseUnits, regionId),
    dateLabel: formatPresentationDate(movement.recordedAt, { regionId, style: "activity-full" }),
    detail: movementDetail(movement, regionId),
    status: movement.status,
    statusLabel: movementStatusLabel(movement.status),
    movementId: movement.id,
  }));

  const entries = [...transfers, ...movements].sort((left, right) => {
    const difference = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
    if (difference !== 0) return difference;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  return {
    entries,
    unresolved: entries.filter((entry) => entry.status !== "confirmed"),
    settled: entries.filter((entry) => entry.status === "confirmed"),
    groups: groupEntries(entries),
    needsAttention: entries.filter(
      (entry) => entry.status === "pending" || entry.status === "failed" || entry.status === "unknown",
    ).length,
  };
}

export type UnresolvedMovementSummary = {
  status: ExplorationMovementStatus;
  tone: "info" | "danger";
  title: string;
  description: string;
  /** The one safe next step for this outcome; unknown outcomes never retry. */
  safeNextStep: "activity" | "retry";
  movementId: string;
  vaultAddress: string | null;
  amountLabel: string;
  /** Unsigned base units of the unresolved deposit, for a deliberate retry. */
  amountBaseUnits: string | null;
};

/** Where the notice appears: the home surfaces point at Activity, Activity does not. */
export type UnresolvedSummaryContext = "home" | "activity";

function movementAttemptKey(movement: ExplorationMovement): string {
  return `${movement.vaultAddress.toLowerCase()}::${movement.amountBaseUnits}`;
}

/**
 * The movements that still speak for their vault-and-amount pair.
 *
 * `state.movements` is newest-first, so the first movement seen for a pair is the latest
 * attempt. A later attempt supersedes the earlier outcome it retried: a pending retry shows
 * as pending, and a confirmed retry leaves nothing unresolved at all — while the earlier
 * attempt stays in the ledger as history. Nothing here changes a status or dispatches
 * anything; superseding is a reading rule, not a retry.
 */
export function currentMovements(
  movements: readonly ExplorationMovement[],
): ExplorationMovement[] {
  const newest = new Map<string, ExplorationMovement>();
  for (const movement of movements) {
    const key = movementAttemptKey(movement);
    if (!newest.has(key)) newest.set(key, movement);
  }
  return [...newest.values()];
}

/**
 * Frames the unresolved movement a Home screen must make obvious. A failed deposit can be
 * retried deliberately; an unknown outcome cannot, because retrying could move money twice.
 */
export function presentUnresolvedMovement(
  state: ExplorationMoneyState,
  options: { context?: UnresolvedSummaryContext } = {},
): UnresolvedMovementSummary | null {
  const current = currentMovements(state.movements);
  const movement =
    current.find((candidate) => candidate.status === "failed")
    ?? current.find((candidate) => candidate.status === "unknown")
    ?? current.find((candidate) => candidate.status === "pending")
    ?? null;
  if (!movement) return null;
  const amountLabel = usdcLabel(movement.amountBaseUnits, state.regionId);
  const destinationName = movement.vaultName;
  // The notice states the outcome once and adds the one safe next step; it never echoes the
  // activity row title, so "failed" or "unconfirmed" cannot appear twice in one block.
  const detail = movementDetail(movement, state.regionId);
  const activityContext = options.context === "activity";

  if (movement.status === "failed") {
    return {
      status: movement.status,
      tone: "danger",
      title: `A ${amountLabel} deposit didn't go through`,
      description: `${detail} Your available balance is unchanged.`,
      safeNextStep: "retry",
      movementId: movement.id,
      vaultAddress: movement.vaultAddress,
      amountLabel,
      amountBaseUnits: movement.amountBaseUnits,
    };
  }
  if (movement.status === "unknown") {
    return {
      status: movement.status,
      tone: "info",
      title: `A ${amountLabel} deposit is unconfirmed`,
      description: `${detail} Nothing retries on its own, so ${
        activityContext ? "review this entry" : "check Activity"
      } before sending to ${destinationName} again.`,
      safeNextStep: "activity",
      movementId: movement.id,
      vaultAddress: movement.vaultAddress,
      amountLabel,
      amountBaseUnits: movement?.amountBaseUnits ?? null,
    };
  }
  return {
    status: movement.status,
    tone: "info",
    title: `A ${amountLabel} deposit is still settling`,
    description: `${detail} Your available balance has not changed.`,
    safeNextStep: "activity",
    movementId: movement.id,
    vaultAddress: movement.vaultAddress,
    amountLabel,
    amountBaseUnits: movement.amountBaseUnits,
  };
}

function movementDetail(movement: ExplorationMovement, regionId: RegionId): string {
  const resolved = movement.resolvedAt
    ? formatPresentationDate(movement.resolvedAt, { regionId, style: "activity-full" })
    : null;
  switch (movement.status) {
    case "pending":
      return "Waiting for the network. Nothing has moved yet.";
    case "failed":
      return resolved
        ? `Stopped ${resolved}. No money moved, and nothing will retry on its own.`
        : "No money moved, and nothing will retry on its own.";
    case "unknown":
      return "No confirmation came back from the network.";
    case "confirmed":
      return resolved ? `Recorded ${resolved}.` : "Recorded.";
  }
}

function groupEntries(
  entries: readonly ExplorationActivityEntry[],
): { key: string; label: string; entries: readonly ExplorationActivityEntry[] }[] {
  const groups = new Map<string, { key: string; label: string; entries: ExplorationActivityEntry[] }>();
  for (const entry of entries) {
    const group = groups.get(entry.groupKey) ?? {
      key: entry.groupKey,
      label: entry.groupLabel,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(entry.groupKey, group);
  }
  return [...groups.values()];
}

function dayKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}
