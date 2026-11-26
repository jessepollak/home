import { getFundingCore } from "@/server/funding/core/runtime";
import { respondToFundingWebhook } from "@/server/funding/core/webhook-delivery";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await context.params;
  return respondToFundingWebhook(request, provider, getFundingCore);
}
