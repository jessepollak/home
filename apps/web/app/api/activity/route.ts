import { createActivityHandler } from "@/server/activity/handler";
import {
  getRecentBaseActivity,
  resolveActivityHistorySource,
} from "@/server/activity/reader";
import { authorizeSession } from "@/server/auth/authorize";
import { writeObservabilityEvent } from "@/server/observability/log";
import { resolveCustomer } from "@/server/customers/resolve";
import { readActivityCardPurchases } from "@/server/cards/transaction-refresh";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export const GET = createActivityHandler({
  authorize: authorizeSession,
  readActivity: getRecentBaseActivity,
  readCards: async (session, window) => readActivityCardPurchases((await resolveCustomer(session, { create: false }))?.id ?? null, window),
  source: () => resolveActivityHistorySource(),
  observe: writeObservabilityEvent,
});
