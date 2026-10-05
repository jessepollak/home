import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingProvidersRequest } from "@/server/funding/handlers/providers";


export async function GET(request: Request): Promise<Response> {
  return handleFundingProvidersRequest(request, {
    authorize: authorizeFundingSession,
    databaseUrl: process.env.DATABASE_URL,
    listProviders: (region, session, direction) =>
      getFundingCore().listProviders(region, session, direction),
  });
}
