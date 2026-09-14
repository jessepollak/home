import { authorizeSession } from "@/server/auth/authorize";
import { createHandleActionHandler } from "@/server/actions/handler";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createHandleActionHandler({
  authorize: authorizeSession,
  markHot: (address, until) => getBalanceSnapshotStore().markHot(8453, address, until),
});
