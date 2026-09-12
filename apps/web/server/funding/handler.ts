import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";
import type { CreateCoinbaseOnrampSession } from "./coinbase-onramp";
import { CoinbaseOnrampError } from "./coinbase-onramp";

export type FundingSessionAuthorizer = SessionAuthorizer;

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
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return withFundingHeaders(session);
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
