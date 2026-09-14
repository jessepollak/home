import {
  authorizeFundingRequest,
  fundingError,
  fundingJson,
  type FundingSessionAuthorizer,
} from "@/server/funding/core/auth";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

type FundingProvidersRouteDependencies = {
  authorize: FundingSessionAuthorizer;
  databaseUrl: string | undefined;
  listProviders: (
    region: string,
    session: VerifiedAccountSession,
  ) => Promise<unknown>;
};

export async function handleFundingProvidersRequest(
  request: Request,
  dependencies: FundingProvidersRouteDependencies,
): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  const region = new URL(request.url).searchParams.get("region");
  if (!region) return fundingError("INVALID_REGION", "Choose a country first.", 400);
  if (!dependencies.databaseUrl?.trim()) return fundingJson({ providers: [] });

  try {
    return fundingJson({
      providers: await dependencies.listProviders(region, authorized.session),
    });
  } catch {
    return fundingError(
      "PROVIDERS_UNAVAILABLE",
      "Funding methods are unavailable.",
      503,
    );
  }
}
