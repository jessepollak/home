import { authorizeFundingRequest, fundingError, fundingJson } from "@/server/funding/core/auth";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FundingCoreError } from "@/server/funding/core/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fundingError("ORDER_NOT_FOUND", "Funding order not found.", 404);
  try { return fundingJson({ order: await getFundingCore().getOrder(authorized.session, id) }); }
  catch (error) { return error instanceof FundingCoreError ? fundingError(error.code, "Funding order not found.", error.status) : fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503); }
}
