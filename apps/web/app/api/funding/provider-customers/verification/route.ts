import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingVerificationPost } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return handleFundingVerificationPost(request, {
    authorize: authorizeFundingSession,
    startVerification: (session, body, origin, headers) => getFundingCore().startProviderCustomerVerification(session, body, origin, headers),
  });
}
