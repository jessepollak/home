import { createCdpWebhookHandler } from "@/server/balances/webhook";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { getWebhookSubscriptionStore } from "@/server/balances/webhook-subscription-store";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { emitServerEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handleWebhook = createCdpWebhookHandler({
  store: getBalanceSnapshotStore(),
  subscriptions: getWebhookSubscriptionStore(),
});

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const raw = await readBoundedWebhookBody(request);
  if (!raw) {
    emitServerEvent("balances-webhook", {
      route: "/api/webhooks/cdp",
      code: "WEBHOOK_BODY_REJECTED",
      outcome: "rejected",
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ accepted: false }, { status: 400 });
  }
  return handleWebhook(raw, request.headers.get("X-Hook0-Signature"), request.headers);
}
