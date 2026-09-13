import { createActivityHandler } from "@/server/activity/handler";
import { getRecentBaseActivity } from "@/server/activity/reader";
import { authorizeSession } from "@/server/auth/authorize";
import { writeObservabilityEvent } from "@/server/observability/log";

export const runtime = "nodejs";
/** Activity reads wait up to 20s on the CDP SQL transport (#300). */
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export const GET = createActivityHandler({
  authorize: authorizeSession,
  readActivity: getRecentBaseActivity,
  observe: writeObservabilityEvent,
});
