import "server-only";

import { keccak256 } from "viem";

import type { ConfirmActionResponse } from "@/shared/actions/contracts/confirm";
import type { GetActionPendingResponse, GetActionResponse } from "@/shared/actions/contracts/get";
import type { HandleActionResponse } from "@/shared/actions/contracts/handle";
import { DECLINE_ACTION_CONTRACT_VERSION, parseDeclineActionRequest, type DeclineActionResponse } from "@/shared/actions/contracts/decline";
import { RETRY_ACTION_CONTRACT_VERSION, parseRetryActionRequest, type RetryActionResponse } from "@/shared/actions/contracts/retry";
import type { ActionListItem, ListActionsResponse } from "@/shared/actions/contracts/list";
import type { CashoutProgress } from "@/shared/funding/contracts/cash-out-progress";
import type { PendingTradeResponse } from "@/shared/actions/contracts/trade-pending";
import type { MoneyActionCall, MoneyActionOwner } from "@/shared/money-actions/types";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { actionConfirmedEvent } from "@/server/operator-events/events";
import { deferCustomerRecord } from "@/server/customers/resolve";
import { createTransferReceiptReader, type TransferReceiptStatus } from "./receipt";
import { moneyActionOwner } from "@/server/money-actions/session";
import { privateError, privateJson } from "@/server/http/private-response";
import { getActionsStore, UnresolvedTradeError, type ActionRow, type ActionsStore, type CashoutOrderRow, type PendingAction, type ActionOutcome } from "./store";
import { deriveActionStatus, type ActionReceiptState } from "./status";
import { finalizeTradeCalls, type PendingTradeConfirmation } from "./kinds/trade/finalize";
import type { TradeConfirmRequest } from "@/shared/trading/contract";
import { createSmartAccountSignatureVerifier } from "./kinds/trade/signer";
import type { SmartAccountSignatureVerifier } from "@/shared/trading/server-types";
import { emitServerEvent } from "@/server/observability/log";
import { awaitBalanceSignal } from "@/server/balances/signal";
import { cashoutWithdrawalInFlight, refreshCashoutProgress, type CashoutReceiptRow } from "@/server/funding/cash-out-progress";
import {
  applyCoinbaseBatchGasHeadroom,
  encodeCoinbaseExecuteBatch,
  getBaseCoinbaseSmartAccountBatchEstimator,
  type CoinbaseSmartAccountBatchEstimator,
} from "@/server/chain/coinbase-smart-account";
import {
  createActionHandleResolver,
  type ActionHandleResolver,
  type HandleResolution,
} from "./reconcile";

export type ActionAuthorizer = SessionAuthorizer;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const RECONCILE_GRACE_MS = 20_000;
const RECONCILE_MAX_PER_REQUEST = 5;
const RECONCILE_ROTATION_MS = 10_000;
const RECONCILE_DEADLINE_MS = 3_000;
const CASHOUT_REFRESH_DEADLINE_MS = 3_000;
const BALANCES_HOT_WINDOW_MS = 60_000;
let defaultActionHandleResolver: ActionHandleResolver | null = null;

function getDefaultActionHandleResolver(): ActionHandleResolver {
  defaultActionHandleResolver ??= createActionHandleResolver();
  return defaultActionHandleResolver;
}

async function authorizeOwner(request: Request, authorize: ActionAuthorizer): Promise<MoneyActionOwner | Response> {
  const boundary = await authorizeSession(request, authorize);
  if (boundary instanceof Response) return boundary;
  const owner = moneyActionOwner(boundary);
  return owner ?? privateError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", 503);
}

export function createGetActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get" | "recordHandle" | "recordOutcome">;
  readReceipt?: (hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>;
  resolveHandle?: ActionHandleResolver;
  now?: () => Date;
}) {
  return async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    const row = await (dependencies.store ?? getActionsStore()).get(owner, id);
    if (!row) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    if (!row.confirmed_at) {
      return privateJson({
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        calls: row.pending?.calls ?? [],
        expiresAt: row.summary.expiresAt,
        ...(row.kind === "trade" && row.summary.signing ? { signing: row.summary.signing } : {}),
      } satisfies GetActionPendingResponse, 200);
    }
    const now = dependencies.now?.() ?? new Date();
    const deadline = createDeadline(request.signal, RECONCILE_DEADLINE_MS);
    try {
      const reconciled = isReconcileCandidate(row, now)
        ? await reconcileRow({
            row,
            owner,
            store: dependencies.store ?? getActionsStore(),
            resolveHandle: dependencies.resolveHandle ?? getDefaultActionHandleResolver(),
            signal: deadline.signal,
            route: "/api/actions/:id",
          })
        : row;
      const result = await settleRow(reconciled, owner, dependencies.store ?? getActionsStore(), dependencies.readReceipt, request.signal, "/api/actions/:id");
      return privateJson(await presentAction(result.row, owner, result.receipt, now), 200);
    } finally {
      deadline.dispose();
    }
  };
}

async function recordConfirmedBestEffort(row: ActionRow, recordConfirmed?: (row: ActionRow) => Promise<void>): Promise<void> {
  try {
    if (recordConfirmed) return await recordConfirmed(row);
    const event = actionConfirmedEvent(row);
    if (event) await deferCustomerRecord((registry) => registry.record(event));
  } catch {
    emitServerEvent("operator-registry", { route: "/operator-registry", code: "OPERATOR_REGISTRY_WRITE_FAILED", outcome: "failed" });
  }
}

export function createConfirmActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get" | "confirm">;
  recordConfirmed?: (row: ActionRow) => Promise<void>;
  verifySmartAccountSignature?: SmartAccountSignatureVerifier;
  markHot?: (address: `0x${string}`, until: Date) => Promise<void>;
  estimateBaseBatch?: CoinbaseSmartAccountBatchEstimator["estimateBatch"];
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const startedAt = Date.now();
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const fail = (code: string, message: string, status: number) => {
      emitServerEvent("action-confirm", {
        route: "/api/actions/:id/confirm",
        code,
        outcome: "failed",
        provider: owner.accountProvider,
        owner,
        durationMs: Date.now() - startedAt,
      });
      return privateError(code, message, status);
    };
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return fail("INVALID_ACTION", "A valid action id is required.", 400);
    const store = dependencies.store ?? getActionsStore();
    const draft = await store.get(owner, id);
    if (!draft) return fail("ACTION_NOT_FOUND", "The action is unavailable or already confirmed.", 404);
    const replay = draft.confirmed_at ? replayableTradeCalls(draft) : null;
    if (replay && tradeExecutionExpired(draft, dependencies.now?.() ?? new Date())) {
      return fail("ACTION_EXPIRED", "The trade quote expired. Get a new quote.", 410);
    }
    const draftCalls = replay ?? (draft.confirmed_at ? null : draft.pending?.calls);
    if (!draftCalls?.length) {
      return fail("ACTION_NOT_FOUND", "The action is unavailable or already confirmed.", 404);
    }
    if (!replay && Date.parse(draft.summary.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) {
      return fail("ACTION_EXPIRED", "The action review expired. Prepare it again.", 410);
    }

    let calls = draftCalls;
    if (!replay && draft.kind === "trade") {
      const body = await readJson(request);
      const signature: TradeConfirmRequest["signature"] | null = isRecord(body) && typeof body.signature === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(body.signature)
        ? body.signature.toLowerCase() as `0x${string}`
        : null;
      if (!signature || !draft.pending || !isPendingTradeConfirmation(draft.pending)) {
        return fail("INVALID_TRADE_SIGNATURE", "A valid reviewed Permit2 signature is required.", 400);
      }
      try {
        calls = await finalizeTradeCalls({
          pending: draft.pending,
          signature,
          owner: owner.address,
          provider: owner.accountProvider,
          verifySmartAccountSignature: dependencies.verifySmartAccountSignature ?? createSmartAccountSignatureVerifier(),
          signal: request.signal,
        });
      } catch {
        return fail("INVALID_TRADE_SIGNATURE", "The Permit2 signature does not match the verified owner.", 400);
      }
    }

    let batchGasLimit: string | undefined;
    let gasHintCode: "BASE_BATCH_GAS_HINT_APPLIED" | "BASE_BATCH_GAS_HINT_UNAVAILABLE" | undefined;
    if (owner.accountProvider === "base-account") {
      try {
        const raw = await (dependencies.estimateBaseBatch ??
          getBaseCoinbaseSmartAccountBatchEstimator.estimateBatch)(calls, owner.address, request.signal);
        const padded = applyCoinbaseBatchGasHeadroom(raw);
        if (padded !== null) batchGasLimit = padded.toString();
        gasHintCode = batchGasLimit
          ? "BASE_BATCH_GAS_HINT_APPLIED"
          : "BASE_BATCH_GAS_HINT_UNAVAILABLE";
      } catch {
        gasHintCode = "BASE_BATCH_GAS_HINT_UNAVAILABLE";
      }
    }

    let row: ActionRow | null;
    try {
      row = replay ? draft : await store.confirm(owner, id, calls);
    } catch (error) {
      if (error instanceof UnresolvedTradeError) return fail("TRADE_UNRESOLVED", "Check Activity for the previous trade before trading again.", 409);
      throw error;
    }
    if (!row || !row.pending?.calls?.length) return fail("ACTION_NOT_FOUND", "The action is unavailable or already confirmed.", 404);
    if (!replay) await recordConfirmedBestEffort(row, dependencies.recordConfirmed);
    if (gasHintCode) {
      emitServerEvent("action-confirm", {
        route: "/api/actions/:id/confirm",
        code: gasHintCode,
        outcome: batchGasLimit ? "ok" : "unavailable",
        provider: owner.accountProvider,
        owner,
        durationMs: Date.now() - startedAt,
      });
    }
    const signalTime = dependencies.now?.() ?? new Date();
    await awaitBalanceSignal(() => dependencies.markHot?.(
      owner.address,
      new Date(signalTime.getTime() + BALANCES_HOT_WINDOW_MS),
    ), { timeoutMs: 2_000 });
    return privateJson({
      id: row.id,
      calls: row.pending.calls,
      summary: row.summary,
      expiresAt: row.summary.expiresAt,
      ...(batchGasLimit ? { batchGasLimit } : {}),
    } satisfies ConfirmActionResponse, 200);
  };
}

export function createHandleActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "recordHandle">;
  markHot?: (address: `0x${string}`, until: Date) => Promise<void>;
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const startedAt = Date.now();
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const fail = (code: string, message: string, status: number) => {
      emitServerEvent("action-handle", {
        route: "/api/actions/:id/handle",
        code,
        outcome: "failed",
        provider: owner.accountProvider,
        owner,
        durationMs: Date.now() - startedAt,
      });
      return privateError(code, message, status);
    };
    const { id } = await context.params;
    const body = await readJson(request);
    if (!uuidPattern.test(id) || !isRecord(body)) return fail("INVALID_ACTION_HANDLE", "A valid action handle is required.", 400);
    const providerHandle = typeof body.providerHandle === "string" && /^[\x21-\x7e]{1,512}$/.test(body.providerHandle)
      ? body.providerHandle : undefined;
    const transactionHash = typeof body.transactionHash === "string" && hashPattern.test(body.transactionHash)
      ? body.transactionHash.toLowerCase() : undefined;
    if ((!providerHandle && !transactionHash) || Object.keys(body).some((key) => key !== "providerHandle" && key !== "transactionHash")) {
      return fail("INVALID_ACTION_HANDLE", "A provider handle or transaction hash is required.", 400);
    }
    const row = await (dependencies.store ?? getActionsStore()).recordHandle(owner, id, { providerHandle, transactionHash });
    if (!row) return fail("ACTION_NOT_FOUND", "The action is unavailable or the handle conflicts.", 404);
    const signalTime = dependencies.now?.() ?? new Date();
    await awaitBalanceSignal(() => dependencies.markHot?.(
      owner.address,
      new Date(signalTime.getTime() + BALANCES_HOT_WINDOW_MS),
    ), { timeoutMs: 2_000 });
    return privateJson({ action: await presentAction(row, owner) } satisfies HandleActionResponse, 200);
  };
}

export function createDeclineActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "recordDecline">;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const startedAt = Date.now();
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return privateError("INVALID_ACTION", "A valid action id is required.", 400);
    const body = parseDeclineActionRequest(await readJson(request));
    if (!body) {
      return privateError("INVALID_ACTION_DECLINE", "A valid versioned decline request is required.", 400);
    }
    const result = await (dependencies.store ?? getActionsStore()).recordDecline(owner, id, body.attempt);
    if (!result.row) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    if (!result.changed && (result.row.provider_handle || result.row.transaction_hash || result.row.outcome)) {
      emitServerEvent("action-decline", {
        route: "/api/actions/:id/decline", code: "DECLINE_IGNORED", outcome: "ignored",
        provider: owner.accountProvider, owner, durationMs: Date.now() - startedAt,
      });
    }
    return privateJson({ version: DECLINE_ACTION_CONTRACT_VERSION, action: await presentAction(result.row, owner) } satisfies DeclineActionResponse, 200);
  };
}

export function createRetryActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get" | "beginRetry">;
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return privateError("INVALID_ACTION", "A valid action id is required.", 400);
    const body = parseRetryActionRequest(await readJson(request));
    if (!body) return privateError("INVALID_ACTION_RETRY", "A valid versioned retry request is required.", 400);
    const store = dependencies.store ?? getActionsStore();
    const row = await store.get(owner, id);
    if (row && tradeExecutionExpired(row, dependencies.now?.() ?? new Date())) {
      return privateError("ACTION_EXPIRED", "The trade quote expired. Get a new quote.", 409);
    }
    const result = await store.beginRetry(owner, id, body.attempt);
    if (!result.row) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    if (result.conflict) return privateError(result.dispatched ? "ACTION_ALREADY_DISPATCHED" : "ACTION_RETRY_CONFLICT", "The action cannot be retried.", 409);
    return privateJson({ version: RETRY_ACTION_CONTRACT_VERSION, action: await presentAction(result.row, owner) } satisfies RetryActionResponse, 200);
  };
}

export function createGetPendingTradeHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "findUnresolvedTrade">;
  now?: () => Date;
}) {
  return async function GET(request: Request): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const row = await (dependencies.store ?? getActionsStore()).findUnresolvedTrade(owner, dependencies.now?.() ?? new Date());
    const direction = row?.summary.metadata?.product === "trade" ? row.summary.metadata.direction : null;
    return privateJson({ version: 1, trade: row ? { id: row.id, direction } : null } satisfies PendingTradeResponse, 200);
  };
}

export function createListActionsHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "list" | "recordHandle" | "recordOutcome"> & Partial<Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "linkedCashoutDepositIds" | "linkCashoutDeposit" | "updateCashoutProgress">>;
  readReceipt?: (hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>;
  resolveHandle?: ActionHandleResolver;
  refreshCashouts?: typeof refreshCashoutProgress;
  now?: () => Date;
}) {
  return async function GET(request: Request): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const store = dependencies.store ?? getActionsStore();
    const rows = await store.list(owner);
    const now = dependencies.now?.() ?? new Date();
    const candidateIds = new Set(rotatingWindow(
      rows
        .filter((row) => isReconcileCandidate(row, now))
        .sort((left, right) => confirmedAtMs(right) - confirmedAtMs(left)),
      RECONCILE_MAX_PER_REQUEST,
      now.getTime(),
    ).map((row) => row.id));
    const deadline = createDeadline(request.signal, RECONCILE_DEADLINE_MS);
    let observed: CashoutReceiptRow[];
    try {
      observed = await Promise.all(rows.map(async (row): Promise<CashoutReceiptRow> => {
        const reconciled = candidateIds.has(row.id)
          ? await reconcileRow({
              row,
              owner,
              store,
              resolveHandle: dependencies.resolveHandle ?? getDefaultActionHandleResolver(),
              signal: deadline.signal,
              route: "/api/actions",
            })
          : row;
        return await settleRow(reconciled, owner, store, dependencies.readReceipt, deadline.signal, "/api/actions");
      }));
    } finally {
      deadline.dispose();
    }
    const refreshDeadline = createDeadline(request.signal, CASHOUT_REFRESH_DEADLINE_MS);
    try {
      const records = await (dependencies.refreshCashouts ?? refreshCashoutProgress)({ owner, rows: observed, store: store as ActionsStore, signal: refreshDeadline.signal, now: () => now });
      const byAction = new Map(records.map((record) => [record.action_id, record]));
      const actions = await Promise.all(observed.map(async ({ row, receipt }) => {
        const record = row.kind === "cash-out" ? byAction.get(row.id) : undefined;
        return {
          ...await presentAction(row, owner, receipt, now),
          ...(record ? { cashout: presentCashoutProgress(record,
            record.deposit_id !== null && cashoutWithdrawalInFlight(observed, owner, record.deposit_id, now)) } : {}),
        };
      }));
      return privateJson({ actions } satisfies ListActionsResponse, 200);
    } finally {
      refreshDeadline.dispose();
    }
  };
}

export function presentCashoutProgress(record: CashoutOrderRow, withdrawing: boolean): CashoutProgress {
  return {
    version: 1,
    providerId: record.provider_id,
    region: record.region,
    depositId: record.deposit_id,
    state: record.state,
    platform: record.platform,
    platformLabel: record.platform_label,
    amountAtomic: record.amount_atomic,
    filledAtomic: record.filled_atomic,
    returnedAtomic: record.returned_atomic,
    remainingAtomic: record.remaining_atomic,
    withdrawable: record.withdrawable,
    withdrawing,
    etaSeconds: record.eta_seconds,
    settledAt: iso(record.settled_at),
    updatedAt: iso(record.updated_at)!,
  };
}

export async function presentAction(
  row: ActionRow,
  owner: MoneyActionOwner,
  receipt: ActionReceiptState | null = null,
  now = new Date(),
) {
  const confirmedAt = iso(row.confirmed_at) ?? iso(row.created_at)!;
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    summary: row.summary,
    status: deriveActionStatus({
      confirmedAt,
      transactionHash: row.transaction_hash,
      receipt,
      outcome: row.outcome,
      now,
    }),
    createdAt: iso(row.created_at)!,
    confirmedAt,
    ...(iso(row.handle_recorded_at) ? { submittedAt: iso(row.handle_recorded_at)! } : {}),
    ...(row.provider_handle ? { providerHandle: row.provider_handle } : {}),
    ...(row.transaction_hash ? { transactionHash: row.transaction_hash.toLowerCase() } : {}),
    owner: {
      subject: owner.subject,
      address: owner.address,
      chainId: 8453,
      accountProvider: owner.accountProvider,
    },
  } satisfies ActionListItem & GetActionResponse;
}

async function reconcileRow(input: {
  row: ActionRow;
  owner: MoneyActionOwner;
  store: Pick<ActionsStore, "recordHandle" | "recordOutcome">;
  resolveHandle: ActionHandleResolver;
  signal: AbortSignal;
  route: string;
}): Promise<ActionRow> {
  const startedAt = Date.now();
  const observe = (resolution: HandleResolution["status"], outcome: "ok" | "conflict" | "unavailable" | "failed") => {
    emitServerEvent("action-reconcile", {
      route: input.route,
      code: resolution.toUpperCase(),
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
    observe(resolution.status, updated ? "ok" : "conflict");
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

async function settleRow(
  row: ActionRow, owner: MoneyActionOwner, store: Pick<ActionsStore, "recordOutcome">,
  readReceipt: ((hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>) | undefined,
  signal: AbortSignal, route: string,
): Promise<{ row: ActionRow; receipt: ActionReceiptState | null }> {
  if (row.outcome || !row.transaction_hash || !hashPattern.test(row.transaction_hash)) return { row, receipt: null };
  const startedAt = Date.now();
  try {
    const reader = readReceipt ?? ((hash: `0x${string}`, nextSignal?: AbortSignal) =>
      createTransferReceiptReader()(hash, nextSignal));
    const receipt = await reader(row.transaction_hash.toLowerCase() as `0x${string}`, signal);
    if (receipt.status === "pending") return { row, receipt: "pending" };
    const outcome = attributeReceipt(row, owner, receipt);
    if (!outcome) {
      emitOutcomeEvent(route, row, owner, "OUTCOME_UNATTRIBUTED", "conflict", startedAt);
      return { row, receipt: "unavailable" };
    }
    if (!receipt.finalized) return { row, receipt: outcome === "succeeded" ? "confirmed" : "failed" };
    const updated = await recordRowOutcome(store, row, owner, outcome, "chain", new Date(receipt.blockTimestamp), route, startedAt);
    return { row: updated, receipt: "unavailable" };
  } catch {
    return { row, receipt: "unavailable" };
  }
}

function isReconcileCandidate(row: ActionRow, now: Date): boolean {
  const confirmedAt = confirmedAtMs(row);
  return row.provider === "base-account" &&
    row.confirmed_at !== null &&
    row.outcome === null &&
    row.transaction_hash === null &&
    row.provider_handle !== null &&
    row.provider_handle !== row.id &&
    Number.isFinite(confirmedAt) &&
    now.getTime() - confirmedAt >= RECONCILE_GRACE_MS;
}

function rotatingWindow<T>(items: T[], size: number, nowMs: number): T[] {
  if (items.length <= size) return items;
  const start = Math.floor(nowMs / RECONCILE_ROTATION_MS) % items.length;
  return Array.from({ length: size }, (_, index) => items[(start + index) % items.length]!);
}

function confirmedAtMs(row: ActionRow): number {
  if (!row.confirmed_at) return Number.NEGATIVE_INFINITY;
  const value = row.confirmed_at instanceof Date
    ? row.confirmed_at.getTime()
    : Date.parse(row.confirmed_at);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function createDeadline(parentSignal: AbortSignal, ms: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  if (parentSignal.aborted) abortFromParent();
  const timeout = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

function iso(value: string | Date | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

function replayableTradeCalls(row: ActionRow): MoneyActionCall[] | null {
  const calls = row.pending?.calls;
  if (row.kind !== "trade" || !row.confirmed_at || !calls?.length || row.provider_handle || row.transaction_hash ||
    row.outcome || row.declined_reported_at || row.dispatch_attempt !== 0 || !row.confirmed_call_data_hash) return null;
  return keccak256(encodeCoinbaseExecuteBatch(calls)).toLowerCase() === row.confirmed_call_data_hash.toLowerCase() ? calls : null;
}

function tradeExecutionExpired(row: ActionRow, now: Date): boolean {
  if (row.kind !== "trade") return false;
  const metadata = row.summary.metadata;
  if (metadata?.product !== "trade") return true;
  const deadline = metadata.executionDeadline;
  const permitDeadline = metadata.permitDeadline;
  if (typeof deadline !== "string" || !/^[1-9][0-9]*$/.test(deadline) ||
    typeof permitDeadline !== "string" || !/^[1-9][0-9]*$/.test(permitDeadline)) return true;
  const execution = BigInt(deadline);
  const permit = BigInt(permitDeadline);
  return permit > (BigInt(1) << BigInt(256)) - BigInt(1) || execution > permit ||
    execution * BigInt(1000) <= BigInt(now.getTime()) + BigInt(30_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPendingTradeConfirmation(pending: PendingAction): pending is PendingAction & PendingTradeConfirmation {
  return Boolean(
    pending.permitHash &&
    pending.signingTypedData &&
    pending.signerAddress &&
    pending.signerOwnerIndex === 0 &&
    typeof pending.signerDeployed === "boolean" &&
    Number.isSafeInteger(pending.swapCallIndex),
  );
}
