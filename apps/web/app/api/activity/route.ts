import { createActivityHandler } from "@/server/activity/handler";
import {
  getRecentBaseActivity,
  resolveActivityHistorySource,
} from "@/server/activity/reader";
import { authorizeSession } from "@/server/auth/authorize";
import { writeObservabilityEvent } from "@/server/observability/log";

export const runtime = "nodejs";
/** Activity reads leave room for bounded chain-data and metadata requests. */
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export const GET = createActivityHandler({
  authorize: authorizeSession,
  readActivity: getRecentBaseActivity,
  source: () => resolveActivityHistorySource(),
  observe: writeObservabilityEvent,
});
