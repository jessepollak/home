import "server-only";

import {
  ACCOUNT_PROVIDER_HEADER,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";

export type FundingSessionAuthorizer = SessionAuthorizer;

export async function authorizeFundingRequest(
  request: Request,
  authorize: FundingSessionAuthorizer,
): Promise<{ session: VerifiedAccountSession } | { response: Response }> {
  const result = await authorizeSession(request, authorize);
  if (result instanceof Response) {
    return { response: withPrivateFundingHeaders(result) } as const;
  }
  if (!result.smartAccount) {
    return {
      response: fundingError(
        "SMART_ACCOUNT_UNAVAILABLE",
        "A verified Base account is required.",
        403,
      ),
    } as const;
  }
  return { session: result } as const;
}

export const privateFundingHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function fundingJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateFundingHeaders });
}

export function fundingError(
  code: string,
  message: string,
  status: number,
): Response {
  return fundingJson({ error: { code, message } }, status);
}

export function withPrivateFundingHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(privateFundingHeaders).forEach(([name, value]) =>
    headers.set(name, value),
  );
  return new Response(response.body, { status: response.status, headers });
}

/**
 * The origin the browser actually used. `request.url` carries the server's
 * bind address (Next dev on `127.0.0.1` reports it even for `localhost`
 * requests), and providers allowlist hostnames, so prefer the forwarded host
 * the platform or dev server set for this request. Only well-formed
 * `host[:port]` values are accepted; anything else falls back to the URL.
 */
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
