import "server-only";

import { assertSessionLive } from "@/server/account-deletion/tombstone";
import { deletionAuthErrorResponse } from "@/server/account-deletion/errors";
import { readHomeSessionSecret } from "@/server/config/env";

import {
  ACCOUNT_PROVIDER_HEADER,
  BASE_CHAIN_ID,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { createSessionHandler } from "@/server/cdp/session";
import { readJson } from "@/shared/http/read-json";

export type SessionAuthorizer = (
  request: Request,
) => Promise<VerifiedAccountSession | Response>;

type SessionBoundary = (
  request: Request,
) => Promise<VerifiedAccountSession | Response>;

export const sessionHandler = createSessionHandler({
  getValidator: () => getCdpAccessTokenValidator(),
  baseAccountEnabled: () => isHomeSessionConfigured(readHomeSessionSecret()),
});

const rawSessionHandler = createSessionHandler({
  getValidator: () => getCdpAccessTokenValidator(),
  baseAccountEnabled: () => isHomeSessionConfigured(readHomeSessionSecret()),
  assertLive: async () => {},
});

export async function authorizeSession(
  request: Request,
  boundary: SessionBoundary = sessionHandler,
  live: typeof assertSessionLive = assertSessionLive,
): Promise<VerifiedAccountSession | Response> {
  const session = await authorizeRawSession(request, boundary);
  if (session instanceof Response) return session;
  try { await live(session); return session; }
  catch (error) { return deletionAuthErrorResponse(error) ?? authUnavailableResponse(); }
}

export async function authorizeRawSession(request: Request, boundary: SessionBoundary = rawSessionHandler): Promise<VerifiedAccountSession | Response> {
  const result = await boundary(request);
  if (result instanceof Response && !result.ok) return result;

  const expectedProvider = requestedProvider(request);
  let value: unknown = result;
  if (result instanceof Response) {
    try {
      value = await readJson(result);
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
        "Referrer-Policy": "no-referrer",
        Vary: `Cookie, Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
      },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
