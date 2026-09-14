import { authorizeSession } from "@/server/auth/authorize";
import { createConfirmActionHandler } from "@/server/actions/handler";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createConfirmActionHandler({
  authorize: authorizeSession,
  markHot: (address, until) => getBalanceSnapshotStore().markHot(8453, address, until),
});
