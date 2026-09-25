import { getSqlExecutor } from "@/server/db/sql";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { readBridgeConfig } from "@/server/cards/bridge/config";
import { createStripeWebhookProvider } from "@/server/cards/bridge/webhook";
import { createCardWebhookHandler } from "@/server/cards/provider";
import { createCardEventStore } from "@/server/cards/store";
import { emitServerEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedHandler: ReturnType<typeof createCardWebhookHandler> | undefined;

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      processDelivery(request),
      new Promise<"unavailable">((resolve) => { timer = setTimeout(() => resolve("unavailable"), 14_000); }),
    ]);
    if (result === "unavailable") {
      observe("WEBHOOK_UNAVAILABLE", "unavailable", startedAt);
      return Response.json({ accepted: false }, { status: 503 });
    }
    if (result === "rejected") observe("WEBHOOK_REJECTED", "rejected", startedAt);
    return Response.json({ accepted: result !== "disabled" }, { status: 202 });
  } catch {
    observe("WEBHOOK_UNAVAILABLE", "unavailable", startedAt);
    return Response.json({ accepted: false }, { status: 503 });
  } finally { if (timer) clearTimeout(timer); }
}

function observe(code: "WEBHOOK_UNAVAILABLE" | "WEBHOOK_REJECTED", outcome: "unavailable" | "rejected", startedAt: number): void {
  emitServerEvent("cards-webhook", { route: "/api/cards/webhooks/stripe", provider: "bridge", code, outcome, durationMs: Date.now() - startedAt });
}

async function processDelivery(request: Request): Promise<"accepted" | "rejected" | "unavailable" | "disabled"> {
  let config: ReturnType<typeof readBridgeConfig>;
  try { config = readBridgeConfig(); }
  catch { return "disabled"; }
  if (!config) return "disabled";
  const raw = await readBoundedWebhookBody(request);
  if (!raw) return "rejected";
  cachedHandler ??= createCardWebhookHandler(createStripeWebhookProvider(config), createCardEventStore(getSqlExecutor()));
  return cachedHandler(raw, request.headers);
}
