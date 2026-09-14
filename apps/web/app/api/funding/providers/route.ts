import { authorizeFundingRequest, fundingError, fundingJson } from "@/server/funding/core/auth";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  const search = new URL(request.url).searchParams;
  const region = search.get("region");
  if (!region) return fundingError("INVALID_REGION", "Choose a country first.", 400);
  const requestedDirection = search.get("direction") ?? "onramp";
  if (requestedDirection !== "onramp" && requestedDirection !== "offramp") {
    return fundingError("INVALID_DIRECTION", "Choose a valid funding direction.", 400);
  }
  return fundingJson({
    version: FUNDING_PROVIDERS_VERSION,
    direction: requestedDirection,
    providers: await getFundingCore().listProviders(region, authorized.session, requestedDirection),
  });
}
