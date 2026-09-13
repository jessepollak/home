import "server-only";

import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
} from "@/shared/account/session-types";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";
import type { Address } from "@/shared/savings/types";
import type { SavingsPositionsResult } from "@/shared/savings/contracts/positions";

export type SavingsPositionAccount = {
  subject: string;
  address: Address;
  accountProvider: AccountProvider;
};

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createSavingsPositionsHandler(dependencies: {
  authorize: SessionAuthorizer;
  readPositions: (
    account: SavingsPositionAccount,
    signal?: AbortSignal,
  ) => Promise<SavingsPositionsResult>;
}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) {
      return privateJson(
        {
          error: {
            code: "SMART_ACCOUNT_UNAVAILABLE",
            message: "A verified Base smart account is not available yet.",
          },
        },
        503,
      );
    }
    const account: SavingsPositionAccount = {
      subject: session.user.subject,
      address: session.smartAccount.address as Address,
      accountProvider: session.accountProvider,
    };

    try {
      return privateJson(
        await dependencies.readPositions(account, request.signal) satisfies SavingsPositionsResult,
        200,
      );
    } catch {
      return privateJson(
        {
          error: {
            code: "SAVINGS_POSITIONS_UNAVAILABLE",
            message: "Current supported Morpho positions are temporarily unavailable.",
          },
        },
        502,
      );
    }
  };
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}
