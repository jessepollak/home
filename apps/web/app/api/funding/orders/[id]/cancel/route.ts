import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingOrderCancellationPost } from "@/server/funding/handlers/orders";

const dependencies = {
  authorize: authorizeFundingSession,
  cancelOrder: (...args: Parameters<ReturnType<typeof getFundingCore>["cancelOrder"]>) =>
    getFundingCore().cancelOrder(...args),
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleFundingOrderCancellationPost(request, id, dependencies);
}
