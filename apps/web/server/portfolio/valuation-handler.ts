import "server-only";

import { isRegionId, type RegionId } from "@/config/regions";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";
import type { PortfolioValuationSnapshot } from "@/shared/portfolio/contract";
import {
  BASE_CHAIN_ID,
  type Address,
  type VerifiedPortfolioAccount,
} from "@/shared/portfolio/types";
import {
  createPortfolioFreshReadLimiter,
  type PortfolioFreshReadLimiter,
} from "./fresh-read-limiter";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createPortfolioValuationHandler(dependencies: {
  authorize: SessionAuthorizer;
  readValuation: (
    account: VerifiedPortfolioAccount,
    region: RegionId,
    signal?: AbortSignal,
    options?: { fresh?: boolean },
  ) => Promise<PortfolioValuationSnapshot>;
  freshReadLimiter?: PortfolioFreshReadLimiter;
}) {
  const freshReadLimiter = dependencies.freshReadLimiter ?? createPortfolioFreshReadLimiter();
  return async function GET(request: Request): Promise<Response> {
    const region = readRegion(request);
    if (!region) {
      return privateJson(
        {
          error: {
            code: "INVALID_REGION",
            message: "A supported portfolio region is required.",
          },
        },
        400,
      );
    }

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
      const wantsFresh = new URL(request.url).searchParams.get("fresh") === "1";
      const snapshot = await dependencies.readValuation(
        {
          address: session.smartAccount.address,
          chainId: BASE_CHAIN_ID,
          verification: "session-smart-account",
        },
        region,
        request.signal,
        { fresh: wantsFresh && freshReadLimiter.take(ownerKey(session)) },
      );
      return privateJson(snapshot satisfies PortfolioValuationSnapshot, 200);
    } catch {
      return privateJson(
        {
          error: {
            code: "PORTFOLIO_VALUATION_UNAVAILABLE",
            message: "Supported portfolio value is temporarily unavailable.",
          },
        },
        502,
      );
    }
  };
}

function readRegion(request: Request): RegionId | null {
  const values = new URL(request.url).searchParams.getAll("region");
  return values.length === 1 && isRegionId(values[0]) ? values[0] : null;
}

function ownerKey(session: { user: { subject: string }; smartAccount: { address: Address } | null; accountProvider: string }): string {
  return `${session.user.subject}\u0000${session.smartAccount?.address ?? "none"}\u0000${session.accountProvider}`;
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}
