import { authorizeFundingRequest } from "@/server/funding/core/auth";
import { privateError, privateJson } from "@/server/http/private-response";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";


export async function GET(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  const region = new URL(request.url).searchParams.get("region");
  if (!region) return privateError("INVALID_REGION", "Choose a country first.", 400);
  try { return privateJson({ version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: await getFundingCore().listProviderCustomers(authorized.session, region) }); }
  catch { return privateError("CUSTOMERS_UNAVAILABLE", "Provider setup is unavailable.", 503); }
}
