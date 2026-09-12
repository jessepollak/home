import { fundingJson } from "@/server/funding/core/auth";
import { getFundingCore } from "@/server/funding/core/runtime";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { emitServerEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  const startedAt = Date.now();
  const { provider } = await context.params;
  const raw = await readBoundedWebhookBody(request);
  if (!raw) {
    emitServerEvent("funding-webhook", {
      route: "/api/funding/webhooks/:provider",
      code: "WEBHOOK_REJECTED",
      outcome: "rejected",
      provider,
      durationMs: Date.now() - startedAt,
    });
    return fundingJson({ accepted: true }, 202);
  }
  try {
    return fundingJson(await getFundingCore().handleWebhook(provider, raw, request.headers), 202);
  } catch {
    emitServerEvent("funding-webhook", {
      route: "/api/funding/webhooks/:provider",
      code: "WEBHOOK_UNAVAILABLE",
      outcome: "unavailable",
      provider,
      durationMs: Date.now() - startedAt,
    });
    return fundingJson({ accepted: true }, 202);
  }
}
