import { authorizeFundingRequest, fundingError, fundingJson, fundingRequestOrigin } from "@/server/funding/core/auth";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FundingCoreError } from "@/server/funding/core/service";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return fundingError("INVALID_VERIFICATION_REQUEST", "Valid verification details are required.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return fundingError("INVALID_VERIFICATION_REQUEST", "Valid verification details are required.", 400); }
  try { return fundingJson({ version: FUNDING_PROVIDER_CUSTOMERS_VERSION, ...(await getFundingCore().startProviderCustomerVerification(authorized.session, body, fundingRequestOrigin(request), request.headers)) }, 201); }
  catch (error) { return error instanceof FundingCoreError ? fundingError(error.code, "Verification could not be started.", error.status) : fundingError("VERIFICATION_UNAVAILABLE", "Verification is unavailable.", 503); }
}
