import { authorizeFundingRequest, fundingError, fundingJson } from "@/server/funding/core/auth";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  const region = new URL(request.url).searchParams.get("region");
  if (!region) return fundingError("INVALID_REGION", "Choose a country first.", 400);
  try { return fundingJson({ version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: await getFundingCore().listProviderCustomers(authorized.session, region) }); }
  catch { return fundingError("CUSTOMERS_UNAVAILABLE", "Provider setup is unavailable.", 503); }
}
