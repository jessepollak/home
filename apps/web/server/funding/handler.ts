import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type { CreateCoinbaseOnrampSession } from "./coinbase-onramp";
import { CoinbaseOnrampError } from "./coinbase-onramp";

export type FundingSessionAuthorizer = (request: Request) => Promise<Response>;

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createFundingOnrampSessionHandler(dependencies: {
  authorize: FundingSessionAuthorizer;
  createOnrampSession: CreateCoinbaseOnrampSession;
}) {
  return async function POST(request: Request): Promise<Response> {
    const requestOrigin = new URL(request.url).origin;
    const boundaryResponse = await dependencies.authorize(request);
    if (!boundaryResponse.ok) return withFundingHeaders(boundaryResponse);

    const session = await parseAuthorizedSession(
      boundaryResponse,
      readRequestedProvider(request),
    );
    if (!session) {
      return privateError(
        "AUTH_UNAVAILABLE",
        "Authentication is temporarily unavailable.",
        503,
      );
    }
    if (!session.smartAccount) {
      return privateError(
        "SMART_ACCOUNT_UNAVAILABLE",
        "A verified Base smart account is not available yet.",
        503,
      );
    }

    if (!(await hasValidRequestBody(request))) {
      return privateError(
        "INVALID_FUNDING_REQUEST",
        "Only canonical USDC on Base is available through hosted funding.",
        400,
      );
    }

    const redirectUrl = new URL("/fund?return=coinbase", requestOrigin).toString();
    try {
      const hosted = await dependencies.createOnrampSession({
        address: session.smartAccount.address,
        redirectUrl,
        signal: request.signal,
      });
      return privateJson(hosted, 200);
    } catch (error) {
      if (error instanceof CoinbaseOnrampError && error.code === "not-configured") {
        return privateError(
          "ONRAMP_NOT_CONFIGURED",
          "Coinbase Onramp needs this deployment's existing CDP secret key credentials.",
          424,
        );
      }
      return privateError(
        "ONRAMP_UNAVAILABLE",
        "Coinbase could not create a hosted Onramp session. Verify Onramp access and allowlist this Home return origin in the existing CDP project.",
        503,
      );
    }
  };
}

async function hasValidRequestBody(request: Request): Promise<boolean> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return false;
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return false;
  }
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    value.assetId === "usdc"
  );
}

async function parseAuthorizedSession(
  response: Response,
  expectedProvider: AccountProvider | null,
): Promise<VerifiedAccountSession | null> {
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
    value.accountProvider !== expectedProvider ||
    !expectedProvider
  ) {
    return null;
  }
  if (value.smartAccount === null) {
    return expectedProvider === "cdp-embedded"
      ? {
          user: { subject: value.user.subject },
          smartAccount: null,
          accountProvider: expectedProvider,
        }
      : null;
  }
  if (!isRecord(value.smartAccount)) return null;
  const { address, chainId } = value.smartAccount;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    chainId !== 8453
  ) {
    return null;
  }
  return {
    user: { subject: value.user.subject },
    smartAccount: {
      address: address.toLowerCase() as `0x${string}`,
      chainId: 8453,
    },
    accountProvider: expectedProvider,
  };
}

function readRequestedProvider(request: Request): AccountProvider | null {
  const requested = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (requested === null || requested === "cdp-embedded") return "cdp-embedded";
  return requested === "base-account" ? "base-account" : null;
}

function withFundingHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateResponseHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function privateError(code: string, message: string, status: number): Response {
  return privateJson({ error: { code, message } }, status);
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
