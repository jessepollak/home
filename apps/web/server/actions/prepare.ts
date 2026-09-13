import "server-only";

import { emitServerEvent } from "@/server/observability/log";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowPreviewRequest } from "@/shared/borrowing/types";
import type { SavingsActionInput } from "@/server/savings/types";
import { TransferExecutionError, type TransferRequest } from "@/shared/transfers/types";
import { isActionKind, type ActionKind } from "@/shared/money-actions/types";
import { authorizeSession } from "@/server/auth/authorize";
import { issueSendMoneyAction } from "@/server/money-actions/prepare-send";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { prepareSavingsAction, SavingsActionError } from "@/server/savings/prepare";
import { prepareBorrowAction, BorrowPreparationError } from "@/server/borrowing/prepare";
import { getBaseBorrowing } from "@/server/borrowing/rpc";
import type { ActionAuthorizer } from "./handler";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization, X-Home-Account-Provider",
} as const;

export function createPrepareActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  prepareSavings?: typeof prepareSavingsAction;
}) {
  return async function POST(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) return privateError("AUTH_UNAVAILABLE", "A verified Base account is required.", 503);
    const body = await readJson(request);
    if (!isRecord(body) || !isActionKind(body.kind) || !isRecord(body.params)) {
      return privateError("INVALID_ACTION", "A valid action kind and parameters are required.", 400);
    }
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
      const action = await prepare(session, body.kind, body.params, request.signal, dependencies);
      return privateJson(action, 201);
    } catch (error) {
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
        return fail(error.code.toUpperCase().replaceAll("-", "_"), error.message, error.code === "stale-state" ? 409 : 400);
      }
      if (error instanceof TransferExecutionError && error.reason === "invalid-request") {
        return fail("INVALID_SEND_REQUEST", "Use a valid Base recipient, asset, and integer amount.", 400);
      }
      return fail("ACTION_PREPARE_UNAVAILABLE", "The action could not be prepared safely.", 502);
    }
  };
}

async function prepare(
  session: VerifiedAccountSession,
  kind: ActionKind,
  params: Record<string, unknown>,
  signal: AbortSignal,
  dependencies: { prepareSavings?: typeof prepareSavingsAction },
) {
  if (kind === "send") {
    return issueSendMoneyAction(session, params as TransferRequest);
  }
  if (kind === "savings-deposit" || kind === "savings-withdraw") {
    const input: SavingsActionInput = {
      kind: kind === "savings-deposit" ? "deposit" : "withdraw",
      vaultAddress: params.vaultAddress as `0x${string}`,
      amountBaseUnits: params.amountBaseUnits as string,
    };
    const draft = await (dependencies.prepareSavings ?? prepareSavingsAction)({ session, action: input, signal });
    return issueMoneyAction(session, draft);
  }
  if (kind === "supply-collateral" || kind === "borrow" || kind === "repay" || kind === "withdraw-collateral") {
    if (!session.smartAccount) throw new BorrowPreparationError("invalid-input", "A verified Base account is required.");
    const request = params as unknown as BorrowPreviewRequest;
    const requestedKind = request.operation === "repay-all" ? "repay" : request.operation;
    if (requestedKind !== kind) {
      throw new BorrowPreparationError("invalid-input", "The borrowing operation does not match the action kind.");
    }
    const rpc = getBaseBorrowing;
    const snapshot = await rpc.readSnapshot(session.smartAccount.address, signal);
    const preparation = await prepareBorrowAction({
      request,
      snapshot,
      rpc,
      signal,
    });
    if (!preparation.fullySimulated) throw new BorrowPreparationError("simulation-failed", preparation.simulationGap ?? "Borrow execution is unavailable.");
    return issueMoneyAction(session, preparation.draft);
  }
  if (kind === "trade") {
    throw new Error("Hosted trades are unavailable.");
  }
  throw new TypeError("Unsupported action kind.");
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}
function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateHeaders });
}
function privateError(code: string, message: string, status: number): Response {
  return privateJson({ error: { code, message } }, status);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
