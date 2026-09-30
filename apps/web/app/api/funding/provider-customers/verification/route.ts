import { authorizeFundingRequest, fundingRequestOrigin } from "@/server/funding/core/auth";
import { privateError, privateJson } from "@/server/http/private-response";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FundingCoreError } from "@/server/funding/core/service";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";
import { readJson } from "@/shared/http/read-json";


export async function POST(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return privateError("INVALID_VERIFICATION_REQUEST", "Valid verification details are required.", 400);
  let body: unknown;
  try { body = await readJson(request); } catch { return privateError("INVALID_VERIFICATION_REQUEST", "Valid verification details are required.", 400); }
  try { return privateJson({ version: FUNDING_PROVIDER_CUSTOMERS_VERSION, ...(await getFundingCore().startProviderCustomerVerification(authorized.session, body, fundingRequestOrigin(request), request.headers)) }, 201); }
  catch (error) { return error instanceof FundingCoreError ? privateError(error.code, "Verification could not be started.", error.status) : privateError("VERIFICATION_UNAVAILABLE", "Verification is unavailable.", 503); }
}
