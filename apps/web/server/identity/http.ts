import "server-only";

import { authorizeSession } from "@/server/auth/authorize";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import type { IdentityVerificationErrorCode } from "@/shared/identity/contract";
import { IdentityConfigurationError, IdentityConflict, IdentityRateLimited } from "./service";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
};
export function identityJson(body: unknown, status = 200): Response { return Response.json(body, { status, headers: privateHeaders }); }
export function identityError(code: IdentityVerificationErrorCode, message: string, status: number): Response { return identityJson({ error: { code, message } }, status); }
export async function authorizeIdentityRequest(request: Request): Promise<VerifiedAccountSession | Response> {
  const result = await authorizeSession(request);
  if (!(result instanceof Response)) return result;
  const headers = new Headers(result.headers);
  Object.entries(privateHeaders).forEach(([name, value]) => headers.set(name, value));
  return new Response(result.body, { status: result.status, headers });
}
export function identityFailure(error: unknown): Response {
  if (error instanceof IdentityRateLimited) {
    const response = identityError("IDENTITY_RATE_LIMITED", "Too many verification requests.", 429);
    response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  if (error instanceof IdentityConfigurationError) return identityError("IDENTITY_CONFIGURATION_UNAVAILABLE", "Identity verification is not configured.", 503);
  if (error instanceof IdentityConflict) {
    const code: IdentityVerificationErrorCode = error.consentRequired ? "CONSENT_REQUIRED" : "IDENTITY_STATE_CONFLICT";
    return identityJson({ error: { code, message: error.consentRequired ? "Consent is required to start verification." : "Verification cannot continue in this state." }, status: error.status }, error.consentRequired ? 400 : 409);
  }
  return identityError("IDENTITY_TEMPORARILY_UNAVAILABLE", "Identity verification is temporarily unavailable.", 503);
}
