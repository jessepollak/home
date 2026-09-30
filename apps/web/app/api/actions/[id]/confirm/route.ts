import { after } from "next/server";
import { authorizeSession } from "@/server/auth/authorize";
import { createConfirmActionHandler } from "@/server/actions/handler";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { getBalanceWebhookSubscriptions } from "@/server/balances/webhook-subscriptions";


export const POST = createConfirmActionHandler({
  authorize: authorizeSession,
  markHot: (address, until) => getBalanceSnapshotStore().markHot(8453, address, until),
  ensureAddressSubscribed: async (address) => {
    after(() => getBalanceWebhookSubscriptions().ensureAddressSubscribed(address));
  },
});
