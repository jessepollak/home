import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingOrderResolutionPost } from "../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies = {
  authorize: authorizeFundingSession,
  resolveAmbiguousOrder: (...args: Parameters<ReturnType<typeof getFundingCore>["resolveAmbiguousOrder"]>) =>
    getFundingCore().resolveAmbiguousOrder(...args),
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleFundingOrderResolutionPost(request, id, dependencies);
}
