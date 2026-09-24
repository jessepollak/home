import { getSqlExecutor } from "@/server/db/sql";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { readImmersveConfig } from "@/server/cards/config";
import { createImmersveClient } from "@/server/cards/immersve-client";
import { createCardEventStore } from "@/server/cards/store";
import { createImmersveWebhookHandler } from "@/server/cards/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedHandler: ReturnType<typeof createImmersveWebhookHandler> | undefined;

export async function POST(request: Request): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      processDelivery(request),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 14_000); }),
    ]);
  } catch {
    return Response.json({ accepted: true }, { status: 202 });
  } finally {
    if (timer) clearTimeout(timer);
  }
  return Response.json({ accepted: true }, { status: 202 });
}

async function processDelivery(request: Request): Promise<void> {
  const raw = await readBoundedWebhookBody(request);
  if (!raw) return;
  const config = readImmersveConfig();
  if (!config) return;
  cachedHandler ??= createImmersveWebhookHandler({
    config,
    client: createImmersveClient(config),
    store: createCardEventStore(getSqlExecutor()),
  });
  await cachedHandler(raw, request.headers);
}
