import "server-only";

import { keccak256 } from "viem";
import { PRODUCT_NOT_OFFERED_CODE, PRODUCT_NOT_OFFERED_MESSAGE } from "@/shared/actions/contracts/prepare";
import { offeredMarketMode, offeredVaultMode, resolveProductOffering } from "@/shared/operator-settings/products";
import { readProductOffering } from "@/server/operator-settings/offering";

import { CONFIRM_CASHOUT_ERRORS, supportsBaseBatchGasHint, type ConfirmActionErrorCode, type ConfirmActionResponse } from "@/shared/actions/contracts/confirm";
import type { GetActionPendingResponse, GetActionResponse } from "@/shared/actions/contracts/get";
import type { HandleActionResponse } from "@/shared/actions/contracts/handle";
import { DECLINE_ACTION_CONTRACT_VERSION, parseDeclineActionRequest, type DeclineActionResponse } from "@/shared/actions/contracts/decline";
import { RETRY_ACTION_CONTRACT_VERSION, parseRetryActionRequest, type RetryActionResponse } from "@/shared/actions/contracts/retry";
import { LIST_ACTIONS_CONTRACT_VERSION, RECENT_ACTIONS_LIMIT, type ActionListItem, type ListActionsResponse } from "@/shared/actions/contracts/list";
import type { CashoutProgress } from "@/shared/funding/contracts/cash-out-progress";
import type { CardAllowanceMoneyActionMetadata, MoneyActionCall, MoneyActionOwner } from "@/shared/money-actions/types";
import { parseCardAllowanceMetadata } from "@/shared/cards/allowance-contract";
import { cardAllowanceSetEnabled, readCardAllowanceRegistry } from "@/server/cards/allowance/config";
import { readCardJourneyConfig } from "@/server/cards/bridge/journey-config";
import { checkCardAllowanceEligibility, CardAllowancePreparationError } from "@/server/cards/allowance/prepare";
import type { FundingDirection } from "@/shared/funding/provider-contract";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { actionConfirmedEvent } from "@/server/operator-events/events";
import { deferCustomerRecord } from "@/server/customers/resolve";
import type { TransferReceiptStatus } from "./receipt";
import { moneyActionOwner } from "@/server/money-actions/session";
import { privateError, privateJson } from "@/server/http/private-response";
import type { PendingTradeResponse } from "@/shared/actions/contracts/trade-pending";
import { cashoutMetadataRegion, getActionsStore, type ActionRow, type ActionsStore, type CashoutOrderRow, type PendingAction } from "./store";
import { isRegionOffered } from "@/server/operator-settings/regions";
import { deriveActionStatus, type ActionReceiptState } from "./status";
import { finalizeTradeCalls, type PendingTradeConfirmation } from "./kinds/trade/finalize";
import { assertStockTradeConfirmAllowed } from "./kinds/trade/stock-eligibility";
import { tradeBuyBlocked } from "./kinds/trade/buy-policy";
import type { TradeConfirmRequest } from "@/shared/trading/contract";
import { createSmartAccountSignatureVerifier } from "./kinds/trade/signer";
import type { SmartAccountSignatureVerifier } from "@/shared/trading/server-types";
import type { resolveConvertPair } from "@/shared/currencies/convert";
import { tradeMetadataDirection, tradeMetadataTradeable } from "@/shared/trading/assets";
import { emitServerEvent } from "@/server/observability/log";
import { awaitBalanceSignal } from "@/server/balances/signal";
import { cashoutWithdrawalInFlight, refreshCashoutProgress, type CashoutReceiptRow, type RefreshedCashoutOrder } from "@/server/funding/cash-out-progress";
import { isCashoutCorridorOffered } from "@/server/funding/offering";
import {
  applyCoinbaseBatchGasHeadroom,
  encodeCoinbaseExecuteBatch,
  getBaseCoinbaseSmartAccountBatchEstimator,
  type CoinbaseSmartAccountBatchEstimator,
} from "@/server/chain/coinbase-smart-account";
import type { ActionHandleResolver } from "./reconcile";
import { followActionUntilSettled, type FollowActionDeps } from "./follow-through";
import { confirmedAtMs, getDefaultActionHandleResolver, isReconcileCandidate, reconcileRow, rotatingWindow, settleRow } from "./settle";
import { readJsonBody } from "@/server/http/request";
import { getBorrowMarketRef, type BorrowMarketRef } from "@/shared/borrowing/config";
import { actionKindForBorrowOperation, increasesBorrowRisk, isBorrowOperation, type BorrowOperation } from "@/shared/borrowing/types";
import { getVerifiedSaveVault, isSaveActionAllowed, type VerifiedSaveVaultRef } from "@/shared/savings/config";
import { getBaseBorrowing } from "@/server/borrowing/rpc";

export type ActionAuthorizer = SessionAuthorizer;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const RECONCILE_MAX_PER_REQUEST = 5;
const RECONCILE_DEADLINE_MS = 3_000;
const CASHOUT_REFRESH_DEADLINE_MS = 3_000;
const BORROW_DEBT_DEADLINE_MS = 3_000;
const BALANCES_HOT_WINDOW_MS = 60_000;
const FOLLOW_UP_THROTTLE_MS = 15_000;
const FOLLOW_UP_MAX_ENTRIES = 500;

async function authorizeOwner(request: Request, authorize: ActionAuthorizer): Promise<MoneyActionOwner | Response> {
  const boundary = await authorizeSession(request, authorize);
  if (boundary instanceof Response) return boundary;
  const owner = moneyActionOwner(boundary);
  return owner ?? privateError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", 503);
}

export function createGetActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get" | "recordHandle" | "recordOutcome"> & Partial<Pick<ActionsStore, "recordReceiptObservation" | "clearReceiptObservation">>;
  readReceipt?: (hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>;
  resolveHandle?: ActionHandleResolver;
  now?: () => Date;
}) {
  return async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    let row: ActionRow | null;
    try {
      row = await (dependencies.store ?? getActionsStore()).get(owner, id);
    } catch {
      emitServerEvent("action-read", {
        route: "/api/actions/:id", code: "ACTIONS_STORE_UNAVAILABLE", outcome: "unavailable",
        provider: owner.accountProvider, owner,
      });
      return privateError("ACTIONS_UNAVAILABLE", "Recorded actions are temporarily unavailable.", 503);
    }
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

async function checkCardAllowanceSetGate(row: ActionRow, owner: MoneyActionOwner, signal: AbortSignal, dependencies: {
  cardAllowanceSetAllowed?: (metadata: CardAllowanceMoneyActionMetadata) => boolean | Promise<boolean>;
  cardAllowanceEligible?: typeof checkCardAllowanceEligibility;
}, fail: (code: ConfirmActionErrorCode, message: string, status: number) => Response): Promise<Response | null> {
  const metadata = parseCardAllowanceMetadata(row.summary.metadata);
  if (!metadata) return fail("CARD_ALLOWANCE_UNAVAILABLE", "Card spending limits are unavailable right now. Prepare again.", 503);
  if (metadata.operation !== "set-allowance") return null;
  const allowed = await Promise.resolve().then(() => (dependencies.cardAllowanceSetAllowed ?? cardAllowanceSetConfirmAllowed)(metadata)).catch(() => false);
  if (!allowed) return fail("CARD_ALLOWANCE_UNAVAILABLE", "Card spending limits changed. Prepare again.", 503);
  try {
    await (dependencies.cardAllowanceEligible ?? checkCardAllowanceEligibility)({
      user: { subject: owner.subject }, accountProvider: owner.accountProvider,
      smartAccount: { address: owner.address, chainId: owner.chainId },
    }, metadata.mode, signal);
  } catch (error) {
    if (error instanceof CardAllowancePreparationError && error.code === "CARD_ALLOWANCE_NOT_READY")
      return fail("CARD_ALLOWANCE_NOT_READY", "An eligible card is required. Prepare again.", 409);
    return fail("CARD_ALLOWANCE_UNAVAILABLE", "Card spending limits are unavailable right now. Prepare again.", 503);
  }
  return null;
}

function isBorrowAdmissionAllowed(operation: BorrowOperation, availability: BorrowMarketRef["availability"], debt: bigint): boolean {
  return availability === "enabled" || !increasesBorrowRisk(operation, debt);
}

async function readCurrentBorrowDebt(owner: `0x${string}`, market: BorrowMarketRef, signal: AbortSignal): Promise<bigint> {
  const snapshot = await getBaseBorrowing.readSnapshot(owner, market, signal);
  return BigInt(snapshot.position.debtAssetsRaw);
}

async function readBorrowDebtWithDeadline(
  read: typeof readCurrentBorrowDebt, owner: `0x${string}`, market: BorrowMarketRef, signal: AbortSignal,
): Promise<bigint> {
  const deadline = createDeadline(signal, BORROW_DEBT_DEADLINE_MS);
  let onAbort: () => void = () => undefined;
  try {
    deadline.signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(deadline.signal.reason);
      deadline.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([read(owner, market, deadline.signal), aborted]);
  } finally {
    deadline.signal.removeEventListener("abort", onAbort);
  }
}

export function createConfirmActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get" | "confirm">;
  recordConfirmed?: (row: ActionRow) => Promise<void>;
  ensureAddressSubscribed?: (address: `0x${string}`) => Promise<void>;
  verifySmartAccountSignature?: SmartAccountSignatureVerifier;
  convertPair?: typeof resolveConvertPair;
  buyBlocked?: typeof tradeBuyBlocked;
  markHot?: (address: `0x${string}`, until: Date) => Promise<void>;
  estimateBaseBatch?: CoinbaseSmartAccountBatchEstimator["estimateBatch"];
  readOffering?: typeof readProductOffering;
  now?: () => Date;
  regionOffered?: (region: string) => Promise<boolean>;
  cardAllowanceSetAllowed?: (metadata: CardAllowanceMoneyActionMetadata) => boolean | Promise<boolean>;
  cardAllowanceEligible?: typeof checkCardAllowanceEligibility;
  corridorOffered?: (providerId: string, region: string, direction: FundingDirection, signal: AbortSignal) => Promise<boolean>;
  saveVault?: (address: string) => VerifiedSaveVaultRef | null;
  borrowMarket?: (marketId: string) => BorrowMarketRef | null;
  readBorrowDebt?: typeof readCurrentBorrowDebt;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const startedAt = Date.now();
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const fail = (code: ConfirmActionErrorCode, message: string, status: number) => {
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
    if (draft.kind === "trade" && !assertStockTradeConfirmAllowed({ metadata: draft.summary.metadata, request })) {
      return fail("TRADE_STOCK_RESTRICTED", "Stock buys aren't available in this location.", 403);
    }
    if (!replay && Date.parse(draft.summary.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) {
      return fail("ACTION_EXPIRED", "The action review expired. Prepare it again.", 410);
    }
    const tradeMetadata = draft.summary.metadata;
    if (!replay && draft.kind === "trade" && tradeMetadata?.product === "trade") {
      const from = isRecord(tradeMetadata.fromAsset) ? tradeMetadata.fromAsset : null;
      const to = isRecord(tradeMetadata.toAsset) ? tradeMetadata.toAsset : null;
      if ((tradeMetadata.currencyRecordId !== undefined || (typeof from?.address === "string" && typeof to?.address === "string")) &&
        !tradeMetadataTradeable(tradeMetadata, { convertPair: dependencies.convertPair })) {
        return fail("TRADE_ADMISSION_REVOKED", "This trade is no longer available.", 409);
      }
      if (tradeMetadata.direction === "buy" && (typeof tradeMetadata.assetId !== "string" ||
        (dependencies.buyBlocked ?? tradeBuyBlocked)(tradeMetadata.assetId))) {
        return fail("TRADE_ADMISSION_REVOKED", "This trade is no longer available.", 409);
      }
    }
    if (!replay && draft.kind === "trade" && tradeMetadata?.product === "trade" && tradeMetadata.operatorFee?.recipient.toLowerCase() === owner.address.toLowerCase()) {
      return fail("ACTION_EXPIRED", "This trade's fee destination is your own account. Prepare the trade again.", 410);
    }

    if (!draft.confirmed_at && draft.kind === "card-allowance") {
      const failure = await checkCardAllowanceSetGate(draft, owner, request.signal, dependencies, fail);
      if (failure) return failure;
    }

    if (!draft.confirmed_at && (draft.kind === "savings-deposit" || draft.kind === "savings-withdraw")) {
      const metadata = draft.summary.metadata;
      const operation = draft.kind === "savings-deposit" ? "deposit" : "withdraw";
      const vault = metadata?.product === "savings" && metadata.operation === operation && typeof metadata.vaultAddress === "string"
        ? (dependencies.saveVault ?? getVerifiedSaveVault)(metadata.vaultAddress) : null;
      if (!isSaveActionAllowed(vault?.capabilities.save, operation)) {
        return fail("ACTION_EXPIRED", "This vault is no longer available for this action. Prepare again.", 410);
      }
    }

    if (!draft.confirmed_at && (draft.kind === "supply-collateral" || draft.kind === "borrow" || draft.kind === "repay" || draft.kind === "withdraw-collateral")) {
      const metadata = draft.summary.metadata;
      if (metadata?.product !== "borrow" || !isBorrowOperation(metadata.operation) ||
        actionKindForBorrowOperation(metadata.operation) !== draft.kind || typeof metadata.marketId !== "string") {
        return fail("ACTION_EXPIRED", "This borrowing review is no longer available. Prepare again.", 410);
      }
      const market = (dependencies.borrowMarket ?? getBorrowMarketRef)(metadata.marketId);
      if (!market) return fail("ACTION_EXPIRED", "This borrowing market is no longer available. Prepare again.", 410);
      let debt = BigInt(0);
      if (market.availability !== "enabled" && metadata.operation === "withdraw-collateral") {
        try {
          debt = await readBorrowDebtWithDeadline(dependencies.readBorrowDebt ?? readCurrentBorrowDebt, owner.address, market, request.signal);
        } catch {
          emitServerEvent("action-confirm", {
            route: "/api/actions/:id/confirm", code: "BORROW_DEBT_UNAVAILABLE", outcome: "unavailable",
            provider: owner.accountProvider, owner, durationMs: Date.now() - startedAt,
          });
          return fail("ACTION_EXPIRED", "This borrowing position could not be checked. Prepare again.", 410);
        }
      }
      if (!isBorrowAdmissionAllowed(metadata.operation, market.availability, debt)) {
        return fail("ACTION_EXPIRED", "This market now accepts only actions that reduce risk. Prepare again.", 410);
      }
    }

    if (!draft.confirmed_at && draft.kind === "cash-out") {
      const metadata = draft.summary.metadata;
      const deposit = metadata?.product === "cashout" && metadata.operation === "deposit" ? metadata : null;
      const region = deposit ? cashoutMetadataRegion(deposit) : null;
      const offered = region === null ? null : await (dependencies.regionOffered ?? isRegionOffered)(region).catch(() => null);
      if (offered === null) return fail(CONFIRM_CASHOUT_ERRORS["settings-unavailable"].code, "Cash out is unavailable right now. Try again shortly.", CONFIRM_CASHOUT_ERRORS["settings-unavailable"].status);
      if (!offered) return fail(CONFIRM_CASHOUT_ERRORS.unavailable.code, "Cash out isn't available in your region.", CONFIRM_CASHOUT_ERRORS.unavailable.status);
      if (deposit && region !== null) {
        const corridorOffered = await (dependencies.corridorOffered ?? isCashoutCorridorOffered)(deposit.providerId, region, "offramp", request.signal).catch(() => null);
        if (corridorOffered === null) return fail(CONFIRM_CASHOUT_ERRORS["settings-unavailable"].code, "Cash out is unavailable right now. Try again shortly.", CONFIRM_CASHOUT_ERRORS["settings-unavailable"].status);
        if (!corridorOffered) return fail(CONFIRM_CASHOUT_ERRORS.unavailable.code, "This cash-out option is no longer offered.", CONFIRM_CASHOUT_ERRORS.unavailable.status);
      }
    }
    if (!replay && !draft.confirmed_at && await entryPaused(draft, dependencies.readOffering ?? readProductOffering)) {
      return fail(PRODUCT_NOT_OFFERED_CODE, PRODUCT_NOT_OFFERED_MESSAGE, 409);
    }

    let calls = draftCalls;
    if (!replay && draft.kind === "trade") {
      const result = await readJsonBody(request, { maxBytes: 64 * 1024 });
      const body = result.kind === "ok" ? result.value : null;
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
    let gasHintCode: "BASE_BATCH_GAS_HINT_APPLIED" | "BASE_BATCH_GAS_HINT_UNAVAILABLE" | "BASE_BATCH_GAS_HINT_SKIPPED" | undefined;
    if (owner.accountProvider === "base-account") {
      if (!supportsBaseBatchGasHint(calls)) {
        gasHintCode = "BASE_BATCH_GAS_HINT_SKIPPED";
      } else {
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
    }

    const row = replay ? draft : await store.confirm(owner, id, calls);
    if (!row || !row.pending?.calls?.length) return fail("ACTION_NOT_FOUND", "The action is unavailable or already confirmed.", 404);
    if (!replay) await recordConfirmedBestEffort(row, dependencies.recordConfirmed);
    if (!replay && dependencies.ensureAddressSubscribed) {
      void Promise.resolve().then(() => dependencies.ensureAddressSubscribed?.(owner.address)).catch(() => undefined);
    }
    if (gasHintCode) {
      emitServerEvent("action-confirm", {
        route: "/api/actions/:id/confirm",
        code: gasHintCode,
        outcome: gasHintCode === "BASE_BATCH_GAS_HINT_SKIPPED" ? "skipped" : batchGasLimit ? "ok" : "unavailable",
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

function cardAllowanceSetConfirmAllowed(metadata: CardAllowanceMoneyActionMetadata): boolean {
  const registry = readCardAllowanceRegistry();
  return Boolean(registry && cardAllowanceSetEnabled(registry, readCardJourneyConfig) &&
    metadata.mode === registry.bridge.mode && metadata.spender === registry.current &&
    metadata.maximumBaseUnits === registry.maximumBaseUnits);
}

export function createHandleActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "recordHandle">;
  schedule?: (task: () => Promise<unknown>) => void;
  followDeps?: FollowActionDeps;
  markHot?: (address: `0x${string}`, until: Date) => Promise<void>;
  now?: () => Date;
}) {
  const followUps = new Map<string, number>();

  function followUpNow(): number {
    return (dependencies.now?.() ?? new Date()).getTime();
  }

  function isFollowUpDue(id: string, at: number): boolean {
    const last = followUps.get(id) ?? Number.NEGATIVE_INFINITY;
    return at - last >= FOLLOW_UP_THROTTLE_MS;
  }

  function markFollowUpScheduled(id: string, at: number): void {
    followUps.delete(id);
    followUps.set(id, at);
    while (followUps.size > FOLLOW_UP_MAX_ENTRIES) {
      const oldest = followUps.keys().next().value;
      if (typeof oldest !== "string") break;
      followUps.delete(oldest);
    }
  }

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
    const result = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const body = result.kind === "ok" ? result.value : null;
    if (!uuidPattern.test(id) || !isRecord(body)) return fail("INVALID_ACTION_HANDLE", "A valid action handle is required.", 400);
    const providerHandle = typeof body.providerHandle === "string" && /^[\x21-\x7e]{1,512}$/.test(body.providerHandle)
      ? body.providerHandle : undefined;
    const transactionHash = typeof body.transactionHash === "string" && hashPattern.test(body.transactionHash)
      ? body.transactionHash.toLowerCase() : undefined;
    if ((!providerHandle && !transactionHash) || Object.keys(body).some((key) => key !== "providerHandle" && key !== "transactionHash")) {
      return fail("INVALID_ACTION_HANDLE", "A provider handle or transaction hash is required.", 400);
    }
    const store = dependencies.store ?? getActionsStore();
    const row = await store.recordHandle(owner, id, { providerHandle, transactionHash });
    if (!row) return fail("ACTION_NOT_FOUND", "The action is unavailable or the handle conflicts.", 404);
    if (dependencies.schedule && row.confirmed_at && !row.outcome && (row.provider_handle || row.transaction_hash) && isFollowUpDue(row.id, followUpNow())) {
      try {
        dependencies.schedule(async () => {
          await followActionUntilSettled(row, { deadlineMs: 45_000, signal: new AbortController().signal, route: "/api/actions/:id/handle", deps: dependencies.followDeps });
        });
        markFollowUpScheduled(row.id, followUpNow());
      } catch {
        emitServerEvent("action-reconcile", { route: "/api/actions/:id/handle", code: "FOLLOW_SCHEDULE_UNAVAILABLE",
          outcome: "unavailable", provider: row.provider, owner });
      }
    }
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
    const read = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const body = parseDeclineActionRequest(read.kind === "ok" ? read.value : null);
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

export function createGetPendingTradeHandler(dependencies: { authorize: ActionAuthorizer }) {
  return async function GET(request: Request): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    return privateJson({ version: 1, trade: null } satisfies PendingTradeResponse, 200);
  };
}

export function createRetryActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get" | "beginRetry">;
  cardAllowanceSetAllowed?: (metadata: CardAllowanceMoneyActionMetadata) => boolean | Promise<boolean>;
  cardAllowanceEligible?: typeof checkCardAllowanceEligibility;
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return privateError("INVALID_ACTION", "A valid action id is required.", 400);
    const read = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const body = parseRetryActionRequest(read.kind === "ok" ? read.value : null);
    if (!body) return privateError("INVALID_ACTION_RETRY", "A valid versioned retry request is required.", 400);
    const store = dependencies.store ?? getActionsStore();
    const row = await store.get(owner, id);
    if (row && tradeExecutionExpired(row, dependencies.now?.() ?? new Date())) {
      return privateError("ACTION_EXPIRED", "The trade quote expired. Get a new quote.", 409);
    }
    if (row?.confirmed_at && row.kind === "card-allowance") {
      const failure = await checkCardAllowanceSetGate(row, owner, request.signal, dependencies, privateError);
      if (failure) return failure;
    }
    const result = await store.beginRetry(owner, id, body.attempt);
    if (!result.row) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    if (result.conflict) return privateError(result.dispatched ? "ACTION_ALREADY_DISPATCHED" : "ACTION_RETRY_CONFLICT", "The action cannot be retried.", 409);
    return privateJson({ version: RETRY_ACTION_CONTRACT_VERSION, action: await presentAction(result.row, owner) } satisfies RetryActionResponse, 200);
  };
}

export function createListActionsHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "list" | "recordHandle" | "recordOutcome"> & Partial<Pick<ActionsStore, "listRetainedSavingsDeposits" | "recordReceiptObservation" | "clearReceiptObservation" | "ensureCashoutOrder" | "cashoutOrders" | "linkedCashoutDepositIds" | "linkCashoutDeposit" | "updateCashoutProgress">>;
  readReceipt?: (hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>;
  resolveHandle?: ActionHandleResolver;
  refreshCashouts?: typeof refreshCashoutProgress;
  now?: () => Date;
}) {
  return async function GET(request: Request): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    let store: Pick<ActionsStore, "list" | "recordHandle" | "recordOutcome"> & Partial<Pick<ActionsStore, "listRetainedSavingsDeposits" | "recordReceiptObservation" | "clearReceiptObservation">>;
    let rows: ActionRow[];
    let retainedRead: Promise<ActionRow[]>;
    let retainedSavingsDepositsUnavailable = false;
    try {
      store = dependencies.store ?? getActionsStore();
      const recentRead = store.list(owner);
      retainedRead = (async () => store.listRetainedSavingsDeposits?.(owner) ?? [])().catch(() => {
        retainedSavingsDepositsUnavailable = true;
        return [];
      });
      rows = await recentRead;
    } catch {
      emitServerEvent("action-read", {
        route: "/api/actions", code: "ACTIONS_STORE_UNAVAILABLE", outcome: "unavailable",
        provider: owner.accountProvider, owner,
      });
      return privateError("ACTIONS_UNAVAILABLE", "Recorded actions are temporarily unavailable.", 503);
    }
    const recentIds = new Set(rows.map((row) => row.id));
    const retainedRows = (await retainedRead).filter((row) => !recentIds.has(row.id));
    if (retainedSavingsDepositsUnavailable) {
      emitServerEvent("action-read", {
        route: "/api/actions", code: "RETAINED_SAVINGS_DEPOSITS_UNAVAILABLE", outcome: "unavailable",
        provider: owner.accountProvider, owner,
      });
    }
    const now = dependencies.now?.() ?? new Date();
    const candidateIds = new Set(rotatingWindow(
      [...rows, ...retainedRows]
        .filter((row) => isReconcileCandidate(row, now))
        .sort((left, right) => confirmedAtMs(right) - confirmedAtMs(left)),
      RECONCILE_MAX_PER_REQUEST,
      now.getTime(),
    ).map((row) => row.id));
    const deadline = createDeadline(request.signal, RECONCILE_DEADLINE_MS);
    const allObserved = await Promise.all([...rows, ...retainedRows].map(async (row): Promise<CashoutReceiptRow> => {
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
    const observed = allObserved.slice(0, rows.length);
    const retainedObserved = allObserved.slice(rows.length);
    const refreshDeadline = createDeadline(request.signal, CASHOUT_REFRESH_DEADLINE_MS);
    const records = await (dependencies.refreshCashouts ?? refreshCashoutProgress)({ owner, rows: observed, store: store as ActionsStore, signal: refreshDeadline.signal, now: () => now });
    const byAction = new Map(records.map((record) => [record.action_id, record]));
    const actions = await Promise.all(observed.map(async ({ row, receipt }) => {
      const record = row.kind === "cash-out" ? byAction.get(row.id) : undefined;
      return {
        ...await presentAction(row, owner, receipt, now),
        ...(row.kind === "cash-out-withdraw" && finalizedSucceededReceiptBlock(row) !== undefined
          ? { receiptBlockNumber: finalizedSucceededReceiptBlock(row) } : {}),
        ...(record ? { cashout: presentCashoutProgress(record,
          record.deposit_id !== null && cashoutWithdrawalInFlight(observed, owner, record.deposit_id, now), row) } : {}),
      };
    }));
    const truncated = observed.length === RECENT_ACTIONS_LIMIT &&
      (observed.at(-1)?.row.kind === "cash-out" || observed.at(-1)?.row.kind === "cash-out-withdraw");
    const retainedSavingsDeposits = await Promise.all(retainedObserved.map(({ row, receipt }) => presentAction(row, owner, receipt, now)));
    return privateJson({
      version: LIST_ACTIONS_CONTRACT_VERSION,
      actions,
      truncated,
      ...(retainedSavingsDeposits.length ? { retainedSavingsDeposits } : {}),
      ...(retainedSavingsDepositsUnavailable ? { retainedSavingsDepositsUnavailable: true } : {}),
    } satisfies ListActionsResponse, 200);
  };
}

function finalizedSucceededReceiptBlock(row?: ActionRow): string | undefined {
  return row?.outcome === "succeeded" && row.observed_receipt_outcome === "succeeded" && row.observed_receipt_block_number != null &&
    row.transaction_hash && row.observed_receipt_transaction_hash?.toLowerCase() === row.transaction_hash.toLowerCase()
    ? row.observed_receipt_block_number : undefined;
}

export function presentCashoutProgress(record: RefreshedCashoutOrder | CashoutOrderRow, withdrawing: boolean, row?: ActionRow): CashoutProgress {
  return {
    version: 1,
    providerId: record.provider_id,
    region: record.region,
    depositId: record.deposit_id,
    ...(finalizedSucceededReceiptBlock(row) !== undefined
      ? { depositBlockNumber: finalizedSucceededReceiptBlock(row) } : {}),
    progressConfirmed: "progressConfirmed" in record && record.progressConfirmed === true,
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
  const settledAt = iso(row.settled_at);
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    summary: row.summary,
    status: deriveActionStatus({
      confirmedAt,
      submittedAt: iso(row.handle_recorded_at),
      transactionHash: row.transaction_hash,
      receipt,
      outcome: row.outcome,
      now,
    }),
    createdAt: iso(row.created_at)!,
    confirmedAt,
    ...(iso(row.handle_recorded_at) ? { submittedAt: iso(row.handle_recorded_at)! } : {}),
    ...(settledAt ? { settledAt } : {}),
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

function createDeadline(parentSignal: AbortSignal, ms: number): { signal: AbortSignal } {
  return { signal: AbortSignal.any([parentSignal, AbortSignal.timeout(ms)]) };
}

function iso(value: string | Date | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

async function entryPaused(row: ActionRow, read: typeof readProductOffering): Promise<boolean> {
  const metadata = row.summary.metadata;
  if (row.kind === "withdraw-collateral" && metadata?.product === "borrow" && metadata.riskIncreased === false) return false;
  if (row.kind !== "send" && row.kind !== "savings-deposit" && row.kind !== "borrow" && row.kind !== "withdraw-collateral" &&
    !(row.kind === "trade" && metadata?.product === "trade" && tradeMetadataDirection(metadata) === "buy")) return false;
  let offering;
  try { offering = await read(); }
  catch { offering = resolveProductOffering({ kind: "unavailable" }); }
  if (row.kind === "send") return offering.products.send !== "on";
  if (row.kind === "savings-deposit") {
    const vault = metadata?.product === "savings" ? getVerifiedSaveVault(metadata.vaultAddress) : null;
    return !vault || offering.products.save !== "on" || offeredVaultMode(offering, vault.id) !== "enabled";
  }
  if (row.kind === "borrow" || row.kind === "withdraw-collateral") return metadata?.product !== "borrow" || offering.products.borrow !== "on" ||
    offeredMarketMode(offering, metadata.marketId) !== "enabled";
  return offering.products.invest !== "on";
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
