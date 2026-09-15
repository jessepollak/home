import { authorizeFundingRequest, fundingError, fundingJson, fundingRequestOrigin } from "@/server/funding/core/auth";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FundingCoreError } from "@/server/funding/core/service";
import { FundingProviderConfigurationError } from "@/server/funding/core/provider-context";
import { emitServerEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return fundingError("INVALID_QUOTE_REQUEST", "A valid funding request is required.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return fundingError("INVALID_QUOTE_REQUEST", "A valid funding request is required.", 400); }
  try { return fundingJson(await getFundingCore().createQuote(authorized.session, body, fundingRequestOrigin(request))); }
  catch (error) {
    if (error instanceof FundingCoreError) return fundingError(error.code, "The funding quote could not be created.", error.status);
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
