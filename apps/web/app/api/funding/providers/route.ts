import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingProvidersRequest } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleFundingProvidersRequest(request, {
    authorize: authorizeFundingSession,
    databaseUrl: process.env.DATABASE_URL,
    listProviders: (region, session, direction) =>
      getFundingCore().listProviders(region, session, direction),
  });
}
