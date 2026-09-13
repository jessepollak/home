import "server-only";

import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import type { BorrowResponse } from "@/shared/borrowing/contract";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";
import type { BorrowRpcReader } from "./rpc";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createBorrowHandler(dependencies: {
  authorize: SessionAuthorizer;
  rpc: BorrowRpcReader;
}) {
  return async function GET(request: Request) {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) {
      return privateJson({ error: { code: "SMART_ACCOUNT_UNAVAILABLE", message: "A verified Base smart account is not available yet." } }, 503);
    }
    try {
      const snapshot = await dependencies.rpc.readSnapshot(
        session.smartAccount.address,
        request.signal,
      );
      return privateJson(snapshot satisfies BorrowResponse, 200);
    } catch {
      return privateJson(
        {
          error: {
            code: "BORROW_STATE_UNAVAILABLE",
            message: "Current Morpho position, oracle, liquidity, or limit state is unavailable.",
          },
        },
        502,
      );
    }
  };
}

function privateJson(body: unknown, status: number) {
  return Response.json(body, { status, headers: privateHeaders });
}
