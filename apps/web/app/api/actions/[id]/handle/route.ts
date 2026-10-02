import { after } from "next/server";
import { createAfterSchedule } from "@/server/scheduling/after-schedule";
import { emitServerEvent } from "@/server/observability/log";
import { authorizeSession } from "@/server/auth/authorize";
import { createHandleActionHandler } from "@/server/actions/handler";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";

export const maxDuration = 60;

export const POST = createHandleActionHandler({
  authorize: authorizeSession,
  schedule: createAfterSchedule(after, () => emitServerEvent("action-reconcile", {
    route: "/api/actions/:id/handle", code: "FOLLOW_SCHEDULE_UNAVAILABLE", outcome: "unavailable",
  })),
  markHot: (address, until) => getBalanceSnapshotStore().markHot(8453, address, until),
});
