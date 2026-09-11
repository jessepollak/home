import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
} from "@/shared/account/session-types";
import { ChainDataError } from "@/server/chain-data/errors";
import type { ActivityReader } from "./types";

export type SessionAuthorizer = (request: Request) => Promise<Response>;

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createActivityHandler(dependencies: {
  authorize: SessionAuthorizer;
  readActivity: ActivityReader;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());

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

    const activityRequest = parseActivityRequest(request, now());
    if (!activityRequest) {
      return privateError(
        "INVALID_ACTIVITY_REQUEST",
        "Use a valid activity window and pagination cursor.",
        400,
      );
    }

    try {
      const page = await dependencies.readActivity(
        {
          address: session.smartAccount.address,
          chainId: 8453,
          verification: "session-smart-account",
        },
        activityRequest,
        request.signal,
      );
      return privateJson(page, 200);
    } catch (error) {
      return activityReadError(error);
    }
  };
}

function parseActivityRequest(
  request: Request,
  now: Date,
): { to: string; cursor: string | null } | null {
  const parameters = new URL(request.url).searchParams;
  const allowed = new Set(["to", "cursor"]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key)) return null;
  }
  if (parameters.getAll("to").length !== 1 || parameters.getAll("cursor").length > 1) {
    return null;
  }

  const to = parameters.get("to");
  const cursor = parameters.get("cursor");
  if (typeof to !== "string" || to.length > 64) return null;
  const toDate = new Date(to);
  if (
    !Number.isFinite(toDate.getTime()) ||
    toDate.toISOString() !== to ||
    toDate.getTime() > now.getTime() + 5 * 60 * 1000 ||
    (cursor !== null && (cursor.length === 0 || cursor.length > 4096))
  ) {
    return null;
  }
  return { to, cursor };
}

async function parseAuthorizedSession(
  response: Response,
  expectedProvider: AccountProvider | null,
): Promise<{
  smartAccount: { address: `0x${string}`; chainId: 8453 } | null;
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
  const { address, chainId } = value.smartAccount;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    chainId !== 8453
  ) {
    return null;
  }
  return {
    smartAccount: {
      address: address.toLowerCase() as `0x${string}`,
      chainId: 8453,
    },
  };
}

function readRequestedProvider(request: Request): AccountProvider | null {
  const requested = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (requested === null || requested === "cdp-embedded") {
    return "cdp-embedded";
  }
  return requested === "base-account" ? "base-account" : null;
}

function activityReadError(error: unknown): Response {
  if (error instanceof ChainDataError) {
    switch (error.code) {
      case "invalid-input":
        return privateError(
          "INVALID_ACTIVITY_REQUEST",
          "Use a valid activity window and pagination cursor.",
          400,
        );
      case "not-configured":
        return privateError(
          "ACTIVITY_NOT_CONFIGURED",
          "CDP SQL activity is not configured. Set CDP_SQL_AUTH_MODE and its required server credentials.",
          503,
        );
      case "timed-out":
        return privateError(
          "ACTIVITY_TIMEOUT",
          "Recent Base activity timed out. Try again.",
          504,
        );
      case "rate-limited":
        return privateError(
          "ACTIVITY_RATE_LIMITED",
          "Activity is rate limited. Try again shortly.",
          429,
        );
      case "unauthorized":
        return privateError(
          "ACTIVITY_UNAUTHORIZED",
          "Activity history authentication was rejected.",
          502,
        );
      case "upstream-error":
        return privateError(
          "ACTIVITY_UPSTREAM",
          "Recent Base activity could not be loaded from the data provider.",
          502,
        );
      case "invalid-response":
        return privateError(
          "ACTIVITY_INVALID_RESPONSE",
          "Recent Base activity returned an unexpected response.",
          502,
        );
      case "payment-required":
        return privateError(
          "ACTIVITY_PAYMENT_REQUIRED",
          "Activity history is not entitled on this project.",
          402,
        );
      default:
        break;
    }
  }
  return privateError(
    "ACTIVITY_UNAVAILABLE",
    "Recent Base activity is temporarily unavailable.",
    502,
  );
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
