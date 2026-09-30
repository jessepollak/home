import { createActivityOrdersHandler } from "@/server/activity/orders-handler";
import { authorizeSession } from "@/server/auth/authorize";
import { getActionsStore } from "@/server/actions/store";
import { getFundingCore } from "@/server/funding/core/runtime";

export const maxDuration = 15;

export const GET = createActivityOrdersHandler({
  authorize: authorizeSession,
  listFundingOrders: (session, limit) => getFundingCore().listOrderHistory(session, limit),
  getOpenFundingOrder: (session, region) => getFundingCore().peekOpenOrder(session, region),
  listCashoutOrders: (owner, limit) => getActionsStore().cashoutOrderHistory(owner, limit),
});
