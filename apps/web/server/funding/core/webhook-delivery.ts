import "server-only";

import { privateJson } from "@/server/http/private-response";
import { emitServerEvent } from "@/server/observability/log";
import { readBoundedWebhookBody } from "./webhook-body";
import type { FundingCore } from "./service";

export async function respondToFundingWebhook(
  request: Request,
  provider: string,
  core: () => Pick<FundingCore, "handleWebhook">,
): Promise<Response> {
  const startedAt = Date.now();
  const raw = await readBoundedWebhookBody(request);
  if (!raw) {
    emitServerEvent("funding-webhook", {
      route: "/api/funding/webhooks/:provider",
      code: "WEBHOOK_REJECTED",
      outcome: "rejected",
      provider,
      durationMs: Date.now() - startedAt,
    });
    return privateJson({ accepted: true }, 202);
  }
  try {
    return privateJson(await core().handleWebhook(provider, raw, request.headers), 202);
  } catch {
    emitServerEvent("funding-webhook", {
      route: "/api/funding/webhooks/:provider",
      code: "WEBHOOK_UNAVAILABLE",
      outcome: "unavailable",
      provider,
      durationMs: Date.now() - startedAt,
    });
    return privateJson({ accepted: false }, 503);
  }
}
