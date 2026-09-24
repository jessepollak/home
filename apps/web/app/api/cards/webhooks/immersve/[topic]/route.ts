import { getSqlExecutor } from "@/server/db/sql";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { readImmersveConfig } from "@/server/cards/config";
import { createImmersveClient } from "@/server/cards/immersve-client";
import { createCardEventStore } from "@/server/cards/store";
import { createImmersveWebhookHandler, isImmersveWebhookTopic, type ImmersveWebhookResult } from "@/server/cards/webhook";
import { emitServerEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedHandler: ReturnType<typeof createImmersveWebhookHandler> | undefined;

export async function POST(request: Request, context: { params: Promise<{ topic: string }> }): Promise<Response> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      processDelivery(request, context),
      new Promise<"unavailable">((resolve) => { timer = setTimeout(() => resolve("unavailable"), 14_000); }),
    ]);
    if (result === "unavailable") {
      observe("WEBHOOK_UNAVAILABLE", "unavailable", startedAt);
      return Response.json({ accepted: false }, { status: 503 });
    }
    if (result === "rejected") observe("WEBHOOK_REJECTED", "rejected", startedAt);
    return Response.json({ accepted: true }, { status: 202 });
  } catch {
    observe("WEBHOOK_UNAVAILABLE", "unavailable", startedAt);
    return Response.json({ accepted: false }, { status: 503 });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function observe(code: "WEBHOOK_UNAVAILABLE" | "WEBHOOK_REJECTED", outcome: "unavailable" | "rejected", startedAt: number): void {
  emitServerEvent("cards-webhook", {
    route: "/api/cards/webhooks/immersve/:topic", code, outcome, durationMs: Date.now() - startedAt,
  });
}

async function processDelivery(request: Request, context: { params: Promise<{ topic: string }> }): Promise<ImmersveWebhookResult> {
  const { topic } = await context.params;
  if (!isImmersveWebhookTopic(topic)) return "rejected";
  const raw = await readBoundedWebhookBody(request);
  if (!raw) return "rejected";
  let config: ReturnType<typeof readImmersveConfig>;
  try { config = readImmersveConfig(); }
  catch { return "rejected"; }
  if (!config) return "rejected";
  cachedHandler ??= createImmersveWebhookHandler({
    config,
    client: createImmersveClient(config),
    store: createCardEventStore(getSqlExecutor()),
  });
  return cachedHandler(raw, request.headers, topic);
}
