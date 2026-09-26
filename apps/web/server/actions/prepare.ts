import "server-only";

import { emitServerEvent } from "@/server/observability/log";
import type { PrepareActionResponse } from "@/shared/actions/contracts/prepare";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { actionKindForBorrowOperation, parseBorrowActionIntent } from "@/shared/borrowing/types";
import type { SavingsActionInput } from "@/server/savings/types";
import { TransferExecutionError, type TransferRequest } from "@/shared/transfers/types";
import { isActionKind, type ActionKind } from "@/shared/money-actions/types";
import { NETWORK_FEE_UNAVAILABLE_CODE } from "@/shared/money-actions/network-fee";
import { authorizeSession } from "@/server/auth/authorize";
import { buildVerifiedSendMoneyActionDraft } from "@/server/money-actions/prepare-send";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { applyNetworkFee, NetworkFeeUnavailableError, NetworkFeeUnfundedError } from "@/server/paymaster/fee";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { privateError, privateJson } from "@/server/http/private-response";
import { prepareSavingsAction, SavingsActionError } from "@/server/savings/prepare";
import { prepareBorrowAction, BorrowPreparationError } from "@/server/borrowing/prepare";
import { getBaseBorrowing } from "@/server/borrowing/rpc";
import { getBorrowMarketRef } from "@/shared/borrowing/config";
import {
  CashoutPreparationError,
  prepareCashoutAction,
  prepareCashoutWithdrawAction,
} from "@/server/funding/cash-out";
import type { ActionAuthorizer } from "./handler";
import { prepareTradeAction, tradePreparationResponse } from "./kinds/trade/prepare";
import { isTradeErrorCode } from "@/shared/trading/contract";
import { getActionsStore, UnresolvedTradeError } from "./store";
import { moneyActionOwner } from "@/server/money-actions/session";

export function createPrepareActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  prepareSavings?: typeof prepareSavingsAction;
  prepareTrade?: typeof prepareTradeAction;
  applyFee?: typeof applyNetworkFee;
}) {
  return async function POST(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    const body = await readJson(request);
    if (!isRecord(body) || !isActionKind(body.kind) || !isRecord(body.params)) {
      return privateError("INVALID_ACTION", "A valid action kind and parameters are required.", 400);
    }
    if (!session.smartAccount && body.kind !== "trade") return privateError("AUTH_UNAVAILABLE", "A verified Base account is required.", 503);
    const startedAt = Date.now();
    const fail = (code: string, message: string, status: number) => {
      emitServerEvent("action-prepare", {
        route: "/api/actions/prepare",
        code,
        outcome: "failed",
        provider: session.accountProvider,
        owner: { subject: session.user.subject, accountProvider: session.accountProvider },
        durationMs: Date.now() - startedAt,
      });
      return privateError(code, message, status);
    };
    try {
      const action = await prepare(session, body.kind, body.params, request, dependencies);
      return privateJson(action satisfies PrepareActionResponse, 201);
    } catch (error) {
      if (error instanceof UnresolvedTradeError) return fail("TRADE_UNRESOLVED", "Check Activity for the previous trade before trading again.", 409);
      if (error instanceof NetworkFeeUnfundedError) return fail(error.code, error.message, 409);
      if (error instanceof NetworkFeeUnavailableError) return fail(NETWORK_FEE_UNAVAILABLE_CODE, error.message, 502);
      const tradeFailure = body.kind === "trade" ? tradePreparationResponse(error) : null;
      if (tradeFailure && isTradeErrorCode(tradeFailure.code)) return fail(tradeFailure.code, tradeFailure.message, tradeFailure.status);
      if (error instanceof SavingsActionError) {
        switch (error.reason) {
          case "invalid-input":
            return fail("SAVINGS_ACTION_INVALID", error.message, 400);
          case "unsupported-vault":
          case "unsupported-asset":
            return fail("SAVINGS_ACTION_UNSUPPORTED", error.message, 422);
          case "limit-exceeded":
            return fail("SAVINGS_ACTION_LIMIT_EXCEEDED", error.message, 409);
          case "rate-limited":
            return fail("SAVINGS_ACTION_RATE_LIMITED", error.message, 429);
          case "rpc":
            return fail("SAVINGS_ACTION_RPC", error.message, 502);
          default:
            return fail("SAVINGS_ACTION_UNAVAILABLE", error.message, 502);
        }
      }
      if (error instanceof BorrowPreparationError) {
        return fail(error.code.toUpperCase().replaceAll("-", "_"), error.message, error.code === "limit-exceeded" ? 409 : 400);
      }
      if (error instanceof TransferExecutionError && error.reason === "invalid-request") {
        return fail("INVALID_SEND_REQUEST", "Use a valid Base recipient, asset, and integer amount.", 400);
      }
      if (error instanceof CashoutPreparationError) {
        const status = error.code === "duplicate-unknown" || error.code === "order-in-flight" ? 409
          : error.code === "identity-mismatch" || error.code === "invalid-input" ? 400
          : error.code === "not-withdrawable" ? 422 : 502;
        return fail(`CASHOUT_${error.code.toUpperCase().replaceAll("-", "_")}`, error.message, status);
      }
      return fail("ACTION_PREPARE_UNAVAILABLE", "The action could not be prepared safely.", 502);
    }
  };
}

async function prepare(
  session: VerifiedAccountSession,
  kind: ActionKind,
  params: Record<string, unknown>,
  request: Request,
  dependencies: { prepareSavings?: typeof prepareSavingsAction; prepareTrade?: typeof prepareTradeAction; applyFee?: typeof applyNetworkFee },
) {
  const signal = request.signal;
  const issue = async (draft: MoneyActionDraft) => issueMoneyAction(session, await (dependencies.applyFee ?? applyNetworkFee)(session, draft, { signal, request }));
  if (kind === "send") {
    return issue(await buildVerifiedSendMoneyActionDraft(params as TransferRequest, new Date(), { signal }));
  }
  if (kind === "cash-out") {
    return issue(await prepareCashoutAction(session, params, signal));
  }
  if (kind === "cash-out-withdraw") {
    return issue(await prepareCashoutWithdrawAction(session, params));
  }
  if (kind === "savings-deposit" || kind === "savings-withdraw") {
    const input: SavingsActionInput = {
      kind: kind === "savings-deposit" ? "deposit" : "withdraw",
      vaultAddress: params.vaultAddress as `0x${string}`,
      amountBaseUnits: params.amountBaseUnits as string,
    };
    const draft = await (dependencies.prepareSavings ?? prepareSavingsAction)({ session, action: input, signal });
    return issue(draft);
  }
  if (kind === "supply-collateral" || kind === "borrow" || kind === "repay" || kind === "withdraw-collateral") {
    if (!session.smartAccount) throw new BorrowPreparationError("invalid-input", "A verified Base account is required.");
    const request = parseBorrowActionIntent(params);
    if (!request || actionKindForBorrowOperation(request.operation) !== kind) {
      throw new BorrowPreparationError("invalid-input", "The borrowing operation or exact base-unit amounts are invalid.");
    }
    const market = getBorrowMarketRef(request.marketId);
    if (!market) throw new BorrowPreparationError("unsupported-market", "The borrowing market is not configured.");
    const rpc = getBaseBorrowing;
    const snapshot = await rpc.readSnapshot(session.smartAccount.address, market, signal);
    const preparation = await prepareBorrowAction({ request, market, snapshot, rpc, signal });
    if (!preparation.fullySimulated) throw new BorrowPreparationError("simulation-failed", preparation.simulationGap ?? "Borrow execution is unavailable.");
    return issue(preparation.draft);
  }
  if (kind === "trade") {
    const owner = moneyActionOwner(session);
    if (owner && await getActionsStore().findUnresolvedTrade(owner)) throw new UnresolvedTradeError();
    const { draft, pending, callGasLimit } = await (dependencies.prepareTrade ?? prepareTradeAction)({ session, request, params, signal });
    const withFee = await (dependencies.applyFee ?? applyNetworkFee)(session, draft, { signal, request, callGasLimit });
    return issueMoneyAction(session, withFee, { pending: { ...pending, swapCallIndex: withFee.calls.length - 1 } });
  }
  throw new TypeError("Unsupported action kind.");
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
