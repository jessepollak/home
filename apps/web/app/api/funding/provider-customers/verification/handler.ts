import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { authorizeFundingRequest, fundingError, fundingJson, fundingRequestOrigin, type FundingSessionAuthorizer } from "@/server/funding/core/auth";
import { FundingCoreError } from "@/server/funding/core/service";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";
import { readJson } from "@/shared/http/read-json";

type FundingVerificationPostDependencies = {
  authorize: FundingSessionAuthorizer;
  startVerification: (session: VerifiedAccountSession, body: unknown, origin: string, headers: Headers) => Promise<object>;
};

export async function handleFundingVerificationPost(request: Request, dependencies: FundingVerificationPostDependencies): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return fundingError("INVALID_VERIFICATION_REQUEST", "Valid verification details are required.", 400);
  let body: unknown;
  try { body = await readJson(request); } catch { return fundingError("INVALID_VERIFICATION_REQUEST", "Valid verification details are required.", 400); }
  try { return fundingJson({ version: FUNDING_PROVIDER_CUSTOMERS_VERSION, ...(await dependencies.startVerification(authorized.session, body, fundingRequestOrigin(request), request.headers)) }, 201); }
  catch (error) { return error instanceof FundingCoreError ? fundingError(error.code, error.publicMessage ?? "Verification could not be started.", error.status) : fundingError("VERIFICATION_UNAVAILABLE", "Verification is unavailable.", 503); }
}
