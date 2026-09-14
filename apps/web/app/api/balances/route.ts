import { authorizeSession } from "@/server/auth/authorize";
import { createBalancesHandler } from "@/server/balances/handler";
import { getBalancesSnapshot } from "@/server/balances/coalesce";
import { createCdpWebhookSubscriptions } from "@/server/balances/webhook-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const webhookSubscriptions = createCdpWebhookSubscriptions();

export const GET = createBalancesHandler({
  authorize: authorizeSession,
  readBalances: getBalancesSnapshot,
  ensureAddressSubscribed: (address) => webhookSubscriptions.ensureAddressSubscribed(address),
});
