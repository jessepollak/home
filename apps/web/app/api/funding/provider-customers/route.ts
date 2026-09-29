import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingProviderCustomersGet } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleFundingProviderCustomersGet(request, {
    authorize: authorizeFundingSession,
    listProviderCustomers: (session, region) => getFundingCore().listProviderCustomers(session, region),
  });
}
