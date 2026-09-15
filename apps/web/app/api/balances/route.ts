import { after } from "next/server";
import { authorizeSession } from "@/server/auth/authorize";
import { createBalancesHandler } from "@/server/balances/handler";
import { createBalancesService } from "@/server/balances/coalesce";
import { createBalancesPricer } from "@/server/balances/price";
import { createCdpWebhookSubscriptions } from "@/server/balances/webhook-subscriptions";
import { emitServerEvent } from "@/server/observability/log";
import { createAfterSchedule } from "./after-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schedule = createAfterSchedule(after, () => {
  emitServerEvent("balances-store", {
    route: "/api/balances",
    code: "BALANCES_AFTER_UNAVAILABLE",
    outcome: "unavailable",
    durationMs: 0,
  });
});
const readBalances = createBalancesService({
  schedule,
  priceBalances: createBalancesPricer({ schedule }),
});
const webhookSubscriptions = createCdpWebhookSubscriptions();

export const GET = createBalancesHandler({
  authorize: authorizeSession,
  readBalances,
  ensureAddressSubscribed: (address) => webhookSubscriptions.ensureAddressSubscribed(address),
});
