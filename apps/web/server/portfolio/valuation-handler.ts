import { isRegionId, type RegionId } from "@/config/regions";
import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
} from "@/shared/account/session-types";
import type { PortfolioValuationSnapshot } from "@/shared/portfolio/valuation-types";
import {
  BASE_CHAIN_ID,
  type Address,
  type VerifiedPortfolioAccount,
} from "@/shared/portfolio/types";
import type { SessionAuthorizer } from "./handler";

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
  ) => Promise<PortfolioValuationSnapshot>;
}) {
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

    const boundaryResponse = await dependencies.authorize(request);
    if (!boundaryResponse.ok) return boundaryResponse;
    const session = await parseAuthorizedSession(
      boundaryResponse,
      readRequestedProvider(request),
    );
    if (!session) {
      return privateJson(
        {
          error: {
            code: "AUTH_UNAVAILABLE",
            message: "Authentication is temporarily unavailable.",
          },
        },
        503,
      );
    }
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
      const snapshot = await dependencies.readValuation(
        {
          address: session.smartAccount.address,
          chainId: BASE_CHAIN_ID,
          verification: "session-smart-account",
        },
        region,
        request.signal,
      );
      return privateJson(snapshot, 200);
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

async function parseAuthorizedSession(
  response: Response,
  expectedProvider: AccountProvider | null,
): Promise<{
  smartAccount: { address: Address; chainId: typeof BASE_CHAIN_ID } | null;
} | null> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    typeof value.user.subject !== "string" ||
    value.user.subject.trim().length === 0 ||
    !expectedProvider ||
    value.accountProvider !== expectedProvider
  ) {
    return null;
  }
  if (value.smartAccount === null) return { smartAccount: null };
  if (!isRecord(value.smartAccount)) return null;
  if (
    typeof value.smartAccount.address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.smartAccount.address) ||
    value.smartAccount.chainId !== BASE_CHAIN_ID
  ) {
    return null;
  }
  return {
    smartAccount: {
      address: value.smartAccount.address.toLowerCase() as Address,
      chainId: BASE_CHAIN_ID,
    },
  };
}

function readRequestedProvider(request: Request): AccountProvider | null {
  const requested = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (requested === null || requested === "cdp-embedded") return "cdp-embedded";
  return requested === "base-account" ? "base-account" : null;
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
