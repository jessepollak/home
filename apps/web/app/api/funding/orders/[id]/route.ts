import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import { handleFundingOrderGetById } from "@/server/funding/handlers/orders";


const dependencies = {
  authorize: authorizeFundingSession,
  getOrder: (...args: Parameters<ReturnType<typeof getFundingCore>["getOrder"]>) =>
    getFundingCore().getOrder(...args),
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleFundingOrderGetById(request, id, dependencies);
}
