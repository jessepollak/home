import "server-only";

import { fundingErrorBody, type FundingErrorCode } from "@/shared/funding/contracts/errors";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";
import { privateError, privateJson, withPrivateHeaders } from "@/server/http/private-response";

export type FundingSessionAuthorizer = SessionAuthorizer;

export async function authorizeFundingRequest(
  request: Request,
  authorize: FundingSessionAuthorizer,
): Promise<{ session: VerifiedAccountSession } | { response: Response }> {
  const result = await authorizeSession(request, authorize);
  if (result instanceof Response) {
    return { response: withPrivateHeaders(result) } as const;
  }
  if (!result.smartAccount) {
    return {
      response: privateError(
        "SMART_ACCOUNT_UNAVAILABLE",
        "A verified Base account is required.",
        403,
      ),
    } as const;
  }
  return { session: result } as const;
}

export function fundingJson(body: unknown, status = 200): Response {
  return privateJson(body, status);
}

export function fundingError(
  code: FundingErrorCode,
  message: string,
  status: number,
): Response {
  return privateJson(fundingErrorBody(code, message), status);
}

export function fundingRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(forwardedHost) ? forwardedHost : url.host;
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? `${forwardedProto}:` : url.protocol;
  const candidate = `${protocol}//${host}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return url.origin;
  }
}
