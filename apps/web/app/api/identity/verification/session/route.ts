import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { authorizeIdentityRequest, identityError, identityFailure, identityJson } from "@/server/identity/http";
import { startIdentityVerificationSession } from "@/server/identity/service";
import { IDENTITY_VERIFICATION_VERSION, parseIdentityVerificationSessionRequest, type IdentityVerificationSessionResponse } from "@/shared/identity/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await authorizeIdentityRequest(request);
  if (session instanceof Response) return session;
  let body: unknown;
  try {
    const raw = await readBoundedWebhookBody(request, { maxBytes: 1024 });
    if (!raw) throw new Error("invalid-body");
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch { return identityError("INVALID_IDENTITY_REQUEST", "Invalid verification request.", 400); }
  const parsed = parseIdentityVerificationSessionRequest(body);
  if (!parsed) return identityError("INVALID_IDENTITY_REQUEST", "Invalid verification request.", 400);
  try {
    const result = await startIdentityVerificationSession(session, parsed);
    return identityJson({ version: IDENTITY_VERIFICATION_VERSION, ...result } satisfies IdentityVerificationSessionResponse);
  } catch (error) { return identityFailure(error); }
}
