import type { AccountProvider, VerifiedAccountSession } from "@/shared/account/session-types";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";

export type FundingSessionAuthorizer = (request: Request) => Promise<Response>;

export async function authorizeFundingRequest(request: Request, authorize: FundingSessionAuthorizer): Promise<{ session: VerifiedAccountSession } | { response: Response }> {
  const boundary = await authorize(request);
  if (!boundary.ok) return { response: withPrivateFundingHeaders(boundary) };
  const expected = requestedProvider(request);
  let value: unknown;
  try { value = await boundary.json(); } catch { value = null; }
  if (!expected || !record(value) || !record(value.user) || typeof value.user.subject !== "string" || value.user.subject.trim() === "" || value.accountProvider !== expected || !record(value.smartAccount)) {
    return { response: fundingError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", 503) };
  }
  const address = value.smartAccount.address;
  if (value.smartAccount.chainId !== 8453 || typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return { response: fundingError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base account is required.", 403) };
  }
  return { session: { user: { subject: value.user.subject }, accountProvider: expected, smartAccount: { address: address.toLowerCase() as `0x${string}`, chainId: 8453 } } };
}

export const privateFundingHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function fundingJson(body: unknown, status = 200): Response { return Response.json(body, { status, headers: privateFundingHeaders }); }
export function fundingError(code: string, message: string, status: number): Response { return fundingJson({ error: { code, message } }, status); }
export function withPrivateFundingHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(privateFundingHeaders).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, headers });
}
function requestedProvider(request: Request): AccountProvider | null {
  const value = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (value === null || value === "cdp-embedded") return "cdp-embedded";
  return value === "base-account" ? "base-account" : null;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
