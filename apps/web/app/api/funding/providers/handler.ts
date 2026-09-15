import {
  authorizeFundingRequest,
  fundingError,
  fundingJson,
  type FundingSessionAuthorizer,
} from "@/server/funding/core/auth";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import type { FundingDirection } from "@/shared/funding/provider-contract";

type FundingProvidersRouteDependencies = {
  authorize: FundingSessionAuthorizer;
  databaseUrl: string | undefined;
  listProviders: (
    region: string,
    session: VerifiedAccountSession,
    direction: FundingDirection,
  ) => Promise<unknown>;
};

export async function handleFundingProvidersRequest(
  request: Request,
  dependencies: FundingProvidersRouteDependencies,
): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  const search = new URL(request.url).searchParams;
  const region = search.get("region");
  if (!region) return fundingError("INVALID_REGION", "Choose a country first.", 400);
  const requestedDirection = search.get("direction") ?? "onramp";
  if (requestedDirection !== "onramp" && requestedDirection !== "offramp") {
    return fundingError("INVALID_DIRECTION", "Choose a valid funding direction.", 400);
  }
  if (!dependencies.databaseUrl?.trim()) {
    return fundingJson({
      version: FUNDING_PROVIDERS_VERSION,
      direction: requestedDirection,
      providers: [],
    });
  }

  try {
    return fundingJson({
      version: FUNDING_PROVIDERS_VERSION,
      direction: requestedDirection,
      providers: await dependencies.listProviders(
        region,
        authorized.session,
        requestedDirection,
      ),
    });
  } catch {
    return fundingError(
      "PROVIDERS_UNAVAILABLE",
      "Funding methods are unavailable.",
      503,
    );
  }
}
