import { after } from "next/server";
import { settleOpenActionsForAccounts } from "@/server/actions/follow-through";
import { createAfterSchedule } from "@/server/scheduling/after-schedule";
import { createCdpWebhookHandler } from "@/server/balances/webhook";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { getHistoryStore } from "@/server/balances/history/store";
import { getWebhookSubscriptionStore } from "@/server/balances/webhook-subscription-store";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { emitServerEvent } from "@/server/observability/log";
import { resolveSecretKeyring } from "@/server/secrets/at-rest";

export const maxDuration = 30;

const resolvedKeyring = resolveSecretKeyring(process.env);
const handleWebhook = createCdpWebhookHandler({
  store: getBalanceSnapshotStore(),
  history: getHistoryStore(),
  subscriptions: getWebhookSubscriptionStore(),
  keyring: resolvedKeyring.ok ? resolvedKeyring.keyring : null,
  schedule: createAfterSchedule(after, () => emitServerEvent("balances-webhook", {
    route: "/api/webhooks/cdp", code: "WEBHOOK_SETTLE_UNAVAILABLE", outcome: "unavailable",
  })),
  settleActions: (addresses, signal) => settleOpenActionsForAccounts(addresses, { signal, route: "/api/webhooks/cdp" }),
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
