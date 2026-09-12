import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";
import {
  BASE_CHAIN_ID,
  type PortfolioSnapshot,
  type VerifiedPortfolioAccount,
} from "@/shared/portfolio/types";

export type PortfolioReader = (
  account: VerifiedPortfolioAccount,
  signal?: AbortSignal,
) => Promise<PortfolioSnapshot>;

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createPortfolioHandler(dependencies: {
  authorize: SessionAuthorizer;
  readPortfolio: PortfolioReader;
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

    try {
      const snapshot = await dependencies.readPortfolio(
        {
          address: session.smartAccount.address,
          chainId: BASE_CHAIN_ID,
          verification: "session-smart-account",
        },
        request.signal,
      );
      return privateJson(snapshot, 200);
    } catch {
      return privateJson(
        {
          error: {
            code: "PORTFOLIO_UNAVAILABLE",
            message: "Current Base balances are temporarily unavailable.",
          },
        },
        502,
      );
    }
  };
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: privateResponseHeaders,
  });
}
