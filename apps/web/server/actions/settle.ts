import "server-only";

import type { MoneyActionOwner } from "@/shared/money-actions/types";
import { emitServerEvent } from "@/server/observability/log";
import { createActionHandleResolver, type ActionHandleResolver, type HandleResolution } from "./reconcile";
import { createTransferReceiptReader, type TransferReceiptStatus } from "./receipt";
import type { ActionRow, ActionsStore, ActionOutcome, ObservedReceiptOutcome } from "./store";
import type { ActionReceiptState } from "./status";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const RECONCILE_GRACE_MS = 20_000;
const RECONCILE_ROTATION_MS = 10_000;

let defaultActionHandleResolver: ActionHandleResolver | null = null;

export function getDefaultActionHandleResolver(): ActionHandleResolver {
  defaultActionHandleResolver ??= createActionHandleResolver();
  return defaultActionHandleResolver;
}

export async function reconcileRow(input: {
  row: ActionRow;
  owner: MoneyActionOwner;
  store: Pick<ActionsStore, "recordHandle" | "recordOutcome">;
  resolveHandle: ActionHandleResolver;
  signal: AbortSignal;
  route: string;
}): Promise<ActionRow> {
  const startedAt = Date.now();
  const observe = (resolution: HandleResolution["status"], outcome: "ok" | "conflict" | "unavailable" | "failed", code?: string) => {
    emitServerEvent("action-reconcile", {
      route: input.route,
      code: code ?? resolution.toUpperCase(),
      outcome,
      provider: input.row.provider,
      owner: input.owner,
      durationMs: Date.now() - startedAt,
    });
  };
  try {
    const resolution = await input.resolveHandle(input.row, input.signal);
    if (resolution.status === "pending") return input.row;
    if (resolution.status === "unavailable") {
      observe(resolution.status, "unavailable");
      return input.row;
    }
    if (resolution.status === "not_submitted" || resolution.status === "reverted" && !resolution.transactionHash) {
      if (input.row.transaction_hash) {
        emitOutcomeEvent(input.route, input.row, input.owner, "OUTCOME_CONFLICT", "conflict", startedAt);
        return input.row;
      }
      const outcome = resolution.status === "not_submitted" ? "not_submitted" : "reverted";
      return await recordRowOutcome(input.store, input.row, input.owner, outcome, "wallet", null, input.route, startedAt);
    }
    const updated = await input.store.recordHandle(input.owner, input.row.id, {
      transactionHash: resolution.transactionHash,
    });
    observe(resolution.status, updated ? "ok" : "conflict", resolution.status === "complete" ? resolution.code : undefined);
    if (!updated) emitOutcomeEvent(input.route, input.row, input.owner, "OUTCOME_CONFLICT", "conflict", startedAt);
    return updated ?? input.row;
  } catch {
    observe("unavailable", "unavailable");
    return input.row;
  }
}

function emitOutcomeEvent(route: string, row: ActionRow, owner: MoneyActionOwner, code: string, outcome: "ok" | "conflict" | "unavailable", startedAt: number) {
  emitServerEvent("action-outcome", {
    route, code, outcome, provider: row.provider, owner, durationMs: Date.now() - startedAt,
  });
}

async function recordRowOutcome(
  store: Pick<ActionsStore, "recordOutcome">, row: ActionRow, owner: MoneyActionOwner,
  outcome: ActionOutcome, source: "chain" | "wallet", settledAt: Date | null,
  route: string, startedAt: number,
): Promise<ActionRow> {
  try {
    const result = await store.recordOutcome(owner, row.id, { outcome, source, settledAt });
    if (result.conflict) emitOutcomeEvent(route, row, owner, "OUTCOME_CONFLICT", "conflict", startedAt);
    if (result.written) emitOutcomeEvent(route, row, owner, "OUTCOME_RECORDED", "ok", startedAt);
    return result.row ?? row;
  } catch {
    emitOutcomeEvent(route, row, owner, "OUTCOME_UNAVAILABLE", "unavailable", startedAt);
    return row;
  }
}

function attributeReceipt(row: ActionRow, owner: MoneyActionOwner, receipt: Extract<TransferReceiptStatus, { status: "confirmed" }>): ActionOutcome | null {
  const account = (row.account_address ?? owner.address).toLowerCase();
  let candidates = receipt.userOperations.filter((operation) => operation.sender.toLowerCase() === account);
  const handle = row.provider_handle;
  if (row.provider === "cdp-embedded" && (!handle || !hashPattern.test(handle))) return null;
  if (handle && hashPattern.test(handle)) {
    const matching = candidates.filter((operation) => operation.userOpHash.toLowerCase() === handle.toLowerCase());
    if (matching.length || row.provider === "cdp-embedded") candidates = matching;
  }
  if (!candidates.length || candidates.some((operation) => operation.success !== candidates[0]!.success)) return null;
  return candidates[0]!.success ? "succeeded" : "reverted";
}

function observedReceiptStatus(row: ActionRow): ActionReceiptState | null {
  if (!row.transaction_hash || !row.observed_receipt_transaction_hash ||
    row.observed_receipt_transaction_hash.toLowerCase() !== row.transaction_hash.toLowerCase() ||
    !row.observed_receipt_block_hash || row.observed_receipt_block_number == null) return null;
  if (row.observed_receipt_outcome === "succeeded") return "confirmed";
  if (row.observed_receipt_outcome === "reverted") return "failed";
  return null;
}

export async function settleRow(
  row: ActionRow, owner: MoneyActionOwner,
  store: Pick<ActionsStore, "recordOutcome"> & Partial<Pick<ActionsStore, "recordReceiptObservation" | "clearReceiptObservation">>,
  readReceipt: ((hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>) | undefined,
  signal: AbortSignal, route: string,
): Promise<{ row: ActionRow; receipt: ActionReceiptState | null }> {
  if (row.outcome || !row.transaction_hash || !hashPattern.test(row.transaction_hash)) return { row, receipt: null };
  const startedAt = Date.now();
  try {
    const reader = readReceipt ?? ((hash: `0x${string}`, nextSignal?: AbortSignal) =>
      createTransferReceiptReader()(hash, nextSignal));
    const receipt = await reader(row.transaction_hash.toLowerCase() as `0x${string}`, signal);
    if (receipt.status === "pending") {
      const observed = observedReceiptStatus(row);
      if (!observed) return { row, receipt: "pending" };
      if (BigInt(receipt.finalizedBlockNumber) < BigInt(row.observed_receipt_block_number!)) return { row, receipt: observed };
      let cleared: ActionRow | null | undefined;
      try {
        cleared = await store.clearReceiptObservation?.(owner, row.id, row.observed_receipt_block_hash!);
      } catch {
        emitOutcomeEvent(route, row, owner, "OBSERVATION_UNAVAILABLE", "unavailable", startedAt);
      }
      return {
        row: cleared ?? { ...row, observed_receipt_transaction_hash: null, observed_receipt_block_number: null,
          observed_receipt_block_hash: null, observed_receipt_outcome: null, observed_at: null },
        receipt: "pending",
      };
    }
    const outcome = attributeReceipt(row, owner, receipt);
    if (!outcome) {
      emitOutcomeEvent(route, row, owner, "OUTCOME_UNATTRIBUTED", "conflict", startedAt);
      return { row, receipt: "unattributed" };
    }
    const observedOutcome = outcome as ObservedReceiptOutcome;
    const freshStatus = outcome === "succeeded" ? "confirmed" : "failed";
    if (row.observed_receipt_block_hash?.toLowerCase() !== receipt.blockHash.toLowerCase() || row.observed_receipt_outcome !== observedOutcome ||
      row.observed_receipt_transaction_hash?.toLowerCase() !== receipt.transactionHash.toLowerCase()) {
      try {
        row = await store.recordReceiptObservation?.(owner, row.id, {
          transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash, outcome: observedOutcome,
        }) ?? row;
      } catch {
        emitOutcomeEvent(route, row, owner, "OBSERVATION_UNAVAILABLE", "unavailable", startedAt);
      }
    }
    if (!receipt.finalized) return { row, receipt: freshStatus };
    const updated = await recordRowOutcome(store, row, owner, outcome, "chain", new Date(receipt.blockTimestamp), route, startedAt);
    return { row: updated, receipt: freshStatus };
  } catch {
    return { row, receipt: observedReceiptStatus(row) ?? "unavailable" };
  }
}

export function isReconcileCandidate(row: ActionRow, now: Date): boolean {
  const confirmedAt = confirmedAtMs(row);
  return (row.provider === "base-account" || row.provider === "cdp-embedded") &&
    row.confirmed_at !== null &&
    row.outcome === null &&
    row.transaction_hash === null &&
    row.provider_handle !== null &&
    row.provider_handle !== row.id &&
    Number.isFinite(confirmedAt) &&
    now.getTime() - confirmedAt >= RECONCILE_GRACE_MS;
}

export function rotatingWindow<T>(items: T[], size: number, nowMs: number, rotationMs = RECONCILE_ROTATION_MS): T[] {
  if (items.length <= size) return items;
  const start = Math.floor(nowMs / rotationMs) % items.length;
  return Array.from({ length: size }, (_, index) => items[(start + index) % items.length]!);
}

export function confirmedAtMs(row: ActionRow): number {
  if (!row.confirmed_at) return Number.NEGATIVE_INFINITY;
  const value = row.confirmed_at instanceof Date
    ? row.confirmed_at.getTime()
    : Date.parse(row.confirmed_at);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}
