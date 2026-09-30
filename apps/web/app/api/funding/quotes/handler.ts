import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { authorizeFundingRequest, fundingError, fundingJson, fundingRequestOrigin, type FundingSessionAuthorizer } from "@/server/funding/core/auth";
import { FundingCoreError } from "@/server/funding/core/service";
import { FundingProviderConfigurationError } from "@/server/funding/core/provider-context";
import { emitServerEvent } from "@/server/observability/log";
import { readJson } from "@/shared/http/read-json";

export async function handleFundingQuotePost(request: Request, dependencies: {
  authorize: FundingSessionAuthorizer;
  createQuote: (session: VerifiedAccountSession, body: unknown, origin: string) => Promise<unknown>;
}): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return fundingError("INVALID_QUOTE_REQUEST", "A valid funding request is required.", 400);
  let body: unknown;
  try { body = await readJson(request); } catch { return fundingError("INVALID_QUOTE_REQUEST", "A valid funding request is required.", 400); }
  try { return fundingJson(await dependencies.createQuote(authorized.session, body, fundingRequestOrigin(request))); }
  catch (error) {
    if (error instanceof FundingCoreError) return fundingError(error.code, error.publicMessage ?? "The funding quote could not be created.", error.status);
    if (error instanceof FundingProviderConfigurationError) {
      emitServerEvent("funding-order", {
        route: "/api/funding/quotes",
        code: error.code,
        outcome: "unavailable",
        owner: {
          subject: authorized.session.user.subject,
          accountProvider: authorized.session.accountProvider,
        },
      });
    }
    return fundingError("QUOTE_UNAVAILABLE", "The funding quote is unavailable.", 503);
  }
}
