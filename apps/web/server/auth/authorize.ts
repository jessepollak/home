import "server-only";

import {
  ACCOUNT_PROVIDER_HEADER,
  BASE_CHAIN_ID,
  isBaseAccountEnabled,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";

export type SessionAuthorizer = (
  request: Request,
) => Promise<VerifiedAccountSession | Response>;

type SessionBoundary = (
  request: Request,
) => Promise<VerifiedAccountSession | Response>;

export const sessionHandler = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
  homeSessionSecret: process.env.HOME_SESSION_SECRET,
  nativeBaseAccountEnabled: !process.env.NEXT_PUBLIC_CDP_PROJECT_ID?.trim(),
});

/**
 * Authorizes and validates one verified account session. A missing provider
 * header selects `cdp-embedded`; callers never reinterpret provider scope.
 */
export async function authorizeSession(
  request: Request,
  boundary: SessionBoundary = sessionHandler,
): Promise<VerifiedAccountSession | Response> {
  const result = await boundary(request);
  if (result instanceof Response && !result.ok) return result;

  const expectedProvider = requestedProvider(request);
  let value: unknown = result;
  if (result instanceof Response) {
    try {
      value = await result.json();
    } catch {
      value = null;
    }
  }
  const session = parseVerifiedSession(value, expectedProvider);
  return session ?? authUnavailableResponse();
}

function requestedProvider(request: Request): AccountProvider | null {
  const value = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (value === null || value === "cdp-embedded") return "cdp-embedded";
  return value === "base-account" ? "base-account" : null;
}

function parseVerifiedSession(
  value: unknown,
  expectedProvider: AccountProvider | null,
): VerifiedAccountSession | null {
  if (
    !expectedProvider ||
    !isRecord(value) ||
    !isRecord(value.user) ||
    typeof value.user.subject !== "string" ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(value.user.subject) ||
    value.accountProvider !== expectedProvider
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
  const address = value.smartAccount.address;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    value.smartAccount.chainId !== BASE_CHAIN_ID
  ) {
    return null;
  }
  return {
    user: { subject: value.user.subject },
    smartAccount: {
      address: address.toLowerCase() as `0x${string}`,
      chainId: BASE_CHAIN_ID,
    },
    accountProvider: expectedProvider,
  };
}

function authUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is temporarily unavailable.",
      },
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Vary: `Cookie, Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
      },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
