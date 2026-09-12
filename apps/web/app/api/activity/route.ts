import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createActivityHandler } from "@/server/activity/handler";
import { getRecentBaseActivity } from "@/server/activity/reader";
import { getMoneyActionStore } from "@/server/money-actions/runtime-store";
import { writeObservabilityEvent } from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const GET = createActivityHandler({
  authorize: authorizeSession,
  readActivity: getRecentBaseActivity,
  readRecordedOperations: async (owner, signal) => {
    const store = await getMoneyActionStore();
    await store.list(owner, 50, signal);
  },
  observe: writeObservabilityEvent,
});
