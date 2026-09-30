import { refetchFailedRecentActions, retryRecentActions } from "@/client/actions/recent-actions-query";
import { ownerQuery } from "@/client/query/query-options";
import { parseActivityOrders, type ActivityOrder } from "@/shared/activity/contract-orders";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

export const activityOrdersPath = "/api/activity/orders";

export function activityOrdersQuery(input: {
  owner: string | null;
  session: VerifiedAccountSession | null;
  fetchOrders: (signal?: AbortSignal) => Promise<unknown>;
  enabled?: boolean;
}) {
  return ownerQuery<ActivityOrder[]>({
    owner: input.owner && input.session ? input.owner : null,
    scope: "activity-orders",
    enabled: input.enabled,
    retry: retryRecentActions,
    retryDelay: (attempt: number) => Math.min(500 * 3 ** attempt, 1_500),
    refetchOnWindowFocus: refetchFailedRecentActions,
    refetchOnReconnect: refetchFailedRecentActions,
    queryFn: async ({ signal }) => {
      if (!input.session) throw new Error("Activity orders are unavailable.");
      return parseActivityOrders(await input.fetchOrders(signal), input.session);
    },
  });
}
