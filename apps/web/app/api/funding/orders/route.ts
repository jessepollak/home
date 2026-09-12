import { authorizeFundingRequest, fundingError, fundingJson } from "@/server/funding/core/auth";
import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { FundingCoreError } from "@/server/funding/core/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return fundingError("INVALID_ORDER_REQUEST", "A valid quote token is required.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return fundingError("INVALID_ORDER_REQUEST", "A valid quote token is required.", 400); }
  try { return fundingJson({ order: await getFundingCore().createOrder(authorized.session, body, new URL(request.url).origin) }, 201); }
  catch (error) { return error instanceof FundingCoreError ? fundingError(error.code, "The funding order could not be created.", error.status) : fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503); }
}

export async function GET(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  const region = new URL(request.url).searchParams.get("region");
  if (!region) return fundingError("INVALID_REGION", "Choose a country first.", 400);
  try { return fundingJson({ order: await getFundingCore().getOpenOrder(authorized.session, region) }); }
  catch { return fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503); }
}
