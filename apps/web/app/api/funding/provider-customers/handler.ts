import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  authorizeFundingRequest,
  type FundingSessionAuthorizer,
} from "@/server/funding/core/auth";
import { privateError, privateJson } from "@/server/http/private-response";
import { assertFundingProviderCustomersResponse, FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";

type FundingProviderCustomersGetDependencies = {
  authorize: FundingSessionAuthorizer;
  listProviderCustomers: (session: VerifiedAccountSession, region: string) => Promise<unknown>;
};

export async function handleFundingProviderCustomersGet(
  request: Request,
  dependencies: FundingProviderCustomersGetDependencies,
): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  const region = new URL(request.url).searchParams.get("region");
  if (!region) return privateError("INVALID_REGION", "Choose a country first.", 400);
  try {
    const response = {
      version: FUNDING_PROVIDER_CUSTOMERS_VERSION,
      customers: await dependencies.listProviderCustomers(authorized.session, region),
    };
    assertFundingProviderCustomersResponse(response, region);
    return privateJson(response);
  } catch {
    return privateError("CUSTOMERS_UNAVAILABLE", "Provider setup is unavailable.", 503);
  }
}
