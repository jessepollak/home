import "server-only";

import { ACTIVITY_ORDERS_CONTRACT_VERSION, ACTIVITY_ORDERS_LIMIT, type ActivityOrder, type ActivityOrdersResponse } from "@/shared/activity/contract-orders";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionOwner } from "@/shared/money-actions/types";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { moneyActionOwner } from "@/server/money-actions/session";
import { privateError, privateJson } from "@/server/http/private-response";
import { emitServerEvent } from "@/server/observability/log";
import type { FundingOrder } from "@/server/funding/core/store";
import type { CashoutOrderRow } from "@/server/actions/store";
import { presentFundingOrder, presentCashoutOrder } from "./orders";

function activityTime(order: ActivityOrder): string {
  return order.kind === "funding" ? order.movedAt ?? order.updatedAt : order.updatedAt;
}

export function createActivityOrdersHandler(deps: {
  authorize: SessionAuthorizer;
  listFundingOrders: (session: VerifiedAccountSession, limit: number) => Promise<FundingOrder[]>;
  getOpenFundingOrder: (session: VerifiedAccountSession, region: string) => Promise<FundingOrder | null>;
  listCashoutOrders: (owner: MoneyActionOwner, limit: number) => Promise<CashoutOrderRow[]>;
  now?: () => Date;
}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, deps.authorize);
    if (session instanceof Response) return session;
    const owner = moneyActionOwner(session);
    if (!owner) return privateError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", 503);
    try {
      const [funding, cashouts] = await Promise.all([
        deps.listFundingOrders(session, ACTIVITY_ORDERS_LIMIT),
        deps.listCashoutOrders(owner, ACTIVITY_ORDERS_LIMIT),
      ]);
      const openByRegion = new Map(await Promise.all([...new Set(funding.map((order) => order.region))].map(async (region) =>
        [region, await deps.getOpenFundingOrder(session, region)] as const)));
      const now = deps.now?.() ?? new Date();
      const orders: ActivityOrder[] = [
        ...funding.flatMap((order) => {
          const item = presentFundingOrder(order, now, order.id === openByRegion.get(order.region)?.id);
          return item ? [item] : [];
        }),
        ...cashouts.map(presentCashoutOrder),
      ].sort((left, right) => activityTime(right).localeCompare(activityTime(left)) || left.id.localeCompare(right.id));
      return privateJson({ version: ACTIVITY_ORDERS_CONTRACT_VERSION,
        owner: { subject: session.user.subject, accountProvider: session.accountProvider }, orders,
      } satisfies ActivityOrdersResponse, 200);
    } catch {
      emitServerEvent("action-read", { route: "/api/activity/orders", code: "ORDERS_UNAVAILABLE", outcome: "unavailable", provider: owner.accountProvider, owner });
      return privateJson({ code: "ORDERS_UNAVAILABLE" }, 503);
    }
  };
}
