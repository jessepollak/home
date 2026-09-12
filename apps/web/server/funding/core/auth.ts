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
