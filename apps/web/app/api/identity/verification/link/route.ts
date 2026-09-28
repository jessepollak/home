import { authorizeIdentityRequest, identityFailure, identityJson } from "@/server/identity/http";
import { createIdentityVerificationLink } from "@/server/identity/service";
import { IDENTITY_VERIFICATION_VERSION, type IdentityVerificationLinkResponse } from "@/shared/identity/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await authorizeIdentityRequest(request);
  if (session instanceof Response) return session;
  try { return identityJson({ version: IDENTITY_VERIFICATION_VERSION, url: await createIdentityVerificationLink(session) } satisfies IdentityVerificationLinkResponse); }
  catch (error) { return identityFailure(error); }
}
