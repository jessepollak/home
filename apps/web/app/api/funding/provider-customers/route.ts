import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingProviderCustomersGet } from "@/server/funding/handlers/provider-customers";


export function GET(request: Request): Promise<Response> {
  return handleFundingProviderCustomersGet(request, {
    authorize: authorizeFundingSession,
    listProviderCustomers: (session, region) => getFundingCore().listProviderCustomers(session, region),
  });
}
