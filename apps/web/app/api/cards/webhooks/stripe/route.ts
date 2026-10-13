import { getSqlExecutor } from "@/server/db/sql";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { readBridgeEventSource } from "@/server/cards/bridge/webhook";
import { createCardWebhookHandler, type CardWebhookResult } from "@/server/cards/provider";
import { createCardEventStore } from "@/server/cards/store";
import { refreshObservedCardEvent } from "@/server/cards/transaction-refresh";
import { emitServerEvent } from "@/server/observability/log";


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
    if (result === "stale") {
      observe("WEBHOOK_STALE", "rejected", startedAt);
      return Response.json({ accepted: false }, { status: 400 });
    }
    if (result === "rejected") observe("WEBHOOK_REJECTED", "rejected", startedAt);
    if (typeof result === "object") observe(result.code, "rejected", startedAt);
    return Response.json({ accepted: result !== "disabled" }, { status: 202 });
  } catch {
    observe("WEBHOOK_UNAVAILABLE", "unavailable", startedAt);
    return Response.json({ accepted: false }, { status: 503 });
  } finally { if (timer) clearTimeout(timer); }
}

function observe(code: "WEBHOOK_UNAVAILABLE" | "WEBHOOK_REJECTED" | "WEBHOOK_STALE" | "API_VERSION_MISMATCH", outcome: "unavailable" | "rejected", startedAt: number): void {
  emitServerEvent("cards-webhook", { route: "/api/cards/webhooks/stripe", provider: "bridge", code, outcome, durationMs: Date.now() - startedAt });
}

async function processDelivery(request: Request): Promise<CardWebhookResult | "disabled"> {
  let source: ReturnType<typeof readBridgeEventSource>;
  try { source = readBridgeEventSource("stripe"); }
  catch { return "disabled"; }
  if (!source) return "disabled";
  const raw = await readBoundedWebhookBody(request);
  if (!raw) return "rejected";
  cachedHandler ??= createCardWebhookHandler(source, {
    async insert(event) {
      const inserted = await createCardEventStore(getSqlExecutor()).insert(event);
      if (inserted) {
        try { await refreshObservedCardEvent(event); } catch {
          emitServerEvent("cards-webhook", { route: "/api/cards/webhooks/stripe", provider: "bridge", code: "WEBHOOK_UNAVAILABLE", outcome: "unavailable", durationMs: 0 });
        }
      }
      return inserted;
    },
  });
  return cachedHandler(raw, request.headers);
}
