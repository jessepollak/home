import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
} from "@/shared/account/session-types";
import {
  BASE_CHAIN_ID,
  type Address,
  type PortfolioSnapshot,
  type VerifiedPortfolioAccount,
} from "@/shared/portfolio/types";

export type SessionAuthorizer = (request: Request) => Promise<Response>;
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
    const boundaryResponse = await dependencies.authorize(request);
    if (!boundaryResponse.ok) {
      return boundaryResponse;
    }

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

async function parseAuthorizedSession(
  response: Response,
  expectedProvider: AccountProvider | null,
): Promise<{
  user: { subject: string };
  smartAccount: { address: Address; chainId: typeof BASE_CHAIN_ID } | null;
  accountProvider: AccountProvider;
} | null> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }

  if (!isRecord(value) || !isRecord(value.user) || !expectedProvider) {
    return null;
  }
  if (
    typeof value.user.subject !== "string" ||
    value.user.subject.trim().length === 0 ||
    value.accountProvider !== expectedProvider
  ) {
    return null;
  }

  if (value.smartAccount === null) {
    return {
      user: { subject: value.user.subject },
      smartAccount: null,
      accountProvider: expectedProvider,
    };
  }

  if (!isRecord(value.smartAccount)) {
    return null;
  }
  const { address, chainId } = value.smartAccount;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    chainId !== BASE_CHAIN_ID
  ) {
    return null;
  }

  return {
    user: { subject: value.user.subject },
    smartAccount: {
      address: address.toLowerCase() as Address,
      chainId: BASE_CHAIN_ID,
    },
    accountProvider: expectedProvider,
  };
}

function readRequestedProvider(request: Request): AccountProvider | null {
  const requested = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (requested === null || requested === "cdp-embedded") {
    return "cdp-embedded";
  }
  return requested === "base-account" ? "base-account" : null;
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: privateResponseHeaders,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
