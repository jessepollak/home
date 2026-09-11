import {
  ACCOUNT_PROVIDER_HEADER,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type {
  MoneyActionDraft,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { MoneyActionIssueError } from "@/server/money-actions/issue";
import { readAuthorizedMoneyActionSession } from "@/server/money-actions/session";
import { SavingsActionError } from "./prepare";
import type { PrepareSavingsAction, SavingsActionInput } from "./types";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createSavingsActionsHandler(dependencies: {
  authorize: (request: Request) => Promise<Response>;
  prepare: PrepareSavingsAction;
  issue: (
    session: VerifiedAccountSession,
    draft: MoneyActionDraft,
  ) => Promise<PreparedMoneyAction>;
}) {
  return async function POST(request: Request): Promise<Response> {
    const boundaryResponse = await dependencies.authorize(request);
    if (!boundaryResponse.ok) return boundaryResponse;

    const session = await readAuthorizedMoneyActionSession(
      request,
      boundaryResponse,
    );
    if (!session) {
      return privateJson(errorBody("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable."), 503);
    }

    let action: SavingsActionInput;
    try {
      action = parseActionInput(await request.json());
    } catch {
      return privateJson(
        errorBody("SAVINGS_ACTION_INVALID", "Enter a valid supported vault and positive USDC amount."),
        400,
      );
    }

    try {
      const draft = await dependencies.prepare({
        session,
        action,
        signal: request.signal,
      });
      return privateJson(await dependencies.issue(session, draft), 201);
    } catch (error) {
      if (error instanceof SavingsActionError) {
        switch (error.reason) {
          case "invalid-input":
            return privateJson(errorBody("SAVINGS_ACTION_INVALID", error.message), 400);
          case "unsupported-vault":
          case "unsupported-asset":
            return privateJson(errorBody("SAVINGS_ACTION_UNSUPPORTED", error.message), 422);
          case "limit-exceeded":
            return privateJson(errorBody("SAVINGS_ACTION_LIMIT_EXCEEDED", error.message), 409);
          case "rate-limited":
            return privateJson(
              errorBody("SAVINGS_ACTION_RATE_LIMITED", error.message),
              429,
            );
          case "rpc":
            return privateJson(errorBody("SAVINGS_ACTION_RPC", error.message), 502);
          default:
            return privateJson(errorBody("SAVINGS_ACTION_UNAVAILABLE", error.message), 502);
        }
      }
      if (error instanceof MoneyActionIssueError) {
        return privateJson(
          errorBody(
            "SAVINGS_ACTION_ISSUE",
            "The savings review could not be stored for this account.",
          ),
          502,
        );
      }
      return privateJson(
        errorBody("SAVINGS_ACTION_UNAVAILABLE", "Savings action preparation is temporarily unavailable."),
        502,
      );
    }
  };
}

function parseActionInput(value: unknown): SavingsActionInput {
  if (
    !isRecord(value) ||
    (value.kind !== "deposit" && value.kind !== "withdraw") ||
    typeof value.vaultAddress !== "string" ||
    typeof value.amountBaseUnits !== "string"
  ) {
    throw new TypeError("Invalid savings action input.");
  }
  return {
    kind: value.kind,
    vaultAddress: value.vaultAddress as `0x${string}`,
    amountBaseUnits: value.amountBaseUnits,
  };
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
