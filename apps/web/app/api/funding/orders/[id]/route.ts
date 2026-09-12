import { authorizeFundingRequest, fundingError, fundingJson } from "@/server/funding/core/auth";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FundingCoreError } from "@/server/funding/core/service";
import { emitServerEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const startedAt = Date.now();
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fundingError("ORDER_NOT_FOUND", "Funding order not found.", 404);
  try { return fundingJson({ order: await getFundingCore().getOrder(authorized.session, id) }); }
  catch (error) {
    if (error instanceof FundingCoreError) return fundingError(error.code, "Funding order not found.", error.status);
    emitServerEvent("funding-order", {
      route: "/api/funding/orders/:id",
      code: "ORDER_UNAVAILABLE",
      outcome: "unavailable",
      provider: authorized.session.accountProvider,
      owner: { subject: authorized.session.user.subject, accountProvider: authorized.session.accountProvider },
      durationMs: Date.now() - startedAt,
    });
    return fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503);
  }
}
