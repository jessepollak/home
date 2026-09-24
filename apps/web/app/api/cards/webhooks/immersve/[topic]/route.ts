import { getSqlExecutor } from "@/server/db/sql";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { readImmersveConfig } from "@/server/cards/config";
import { createImmersveClient } from "@/server/cards/immersve-client";
import { createCardEventStore } from "@/server/cards/store";
import { createImmersveWebhookHandler, isImmersveWebhookTopic } from "@/server/cards/webhook";
import { emitServerEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedHandler: ReturnType<typeof createImmersveWebhookHandler> | undefined;

export async function POST(request: Request, context: { params: Promise<{ topic: string }> }): Promise<Response> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const accepted = await Promise.race([
      processDelivery(request, context),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 14_000); }),
    ]);
    if (accepted !== true) {
      emitServerEvent("cards-webhook", {
        route: "/api/cards/webhooks/immersve/:topic",
        code: accepted === null ? "WEBHOOK_UNAVAILABLE" : "WEBHOOK_REJECTED",
        outcome: accepted === null ? "unavailable" : "rejected",
        durationMs: Date.now() - startedAt,
      });
    }
  } catch {
    emitServerEvent("cards-webhook", {
      route: "/api/cards/webhooks/immersve/:topic",
      code: "WEBHOOK_UNAVAILABLE",
      outcome: "unavailable",
      durationMs: Date.now() - startedAt,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  return Response.json({ accepted: true }, { status: 202 });
}

async function processDelivery(request: Request, context: { params: Promise<{ topic: string }> }): Promise<boolean> {
  const { topic } = await context.params;
  if (!isImmersveWebhookTopic(topic)) return false;
  const raw = await readBoundedWebhookBody(request);
  if (!raw) return false;
  const config = readImmersveConfig();
  if (!config) return false;
  cachedHandler ??= createImmersveWebhookHandler({
    config,
    client: createImmersveClient(config),
    store: createCardEventStore(getSqlExecutor()),
  });
  return cachedHandler(raw, request.headers, topic);
}
