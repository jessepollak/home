import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingQuotePost } from "./handler";


export async function POST(request: Request): Promise<Response> {
  return handleFundingQuotePost(request, { authorize: authorizeFundingSession, createQuote: (session, body, origin) => getFundingCore().createQuote(session, body, origin) });
}
