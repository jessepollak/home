import { authorizeIdentityRequest, identityJson } from "@/server/identity/http";
import { readIdentityVerificationStatus } from "@/server/identity/service";
import { IDENTITY_VERIFICATION_VERSION, type IdentityVerificationStatusResponse } from "@/shared/identity/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await authorizeIdentityRequest(request);
  if (session instanceof Response) return session;
  return identityJson({ version: IDENTITY_VERIFICATION_VERSION, status: await readIdentityVerificationStatus(session) } satisfies IdentityVerificationStatusResponse);
}
