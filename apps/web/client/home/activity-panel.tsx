"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  ActivityPanel,
  type ActivityPanelDensity,
  type FetchActivity,
} from "@/client/activity";
import { activityOwnerKey, useActivity } from "@/client/activity/use-activity";
import {
  RecentMoneyActions,
  dedupeRecentMoneyActions,
  parseRecentMoneyActions,
} from "@/client/actions";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { markHomePerformance } from "@/client/observability/perf-marks";
import { ShimmerRows } from "./panel-shared";

export function ActivityPage({
  activitySession,
  fetchActivity,
  fetchOperations,
  regionId,
  showSessionShimmer,
}: {
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  regionId: RegionId;
  showSessionShimmer: boolean;
}) {
  if (showSessionShimmer) {
    return (
      <section
        className="activity-panel nested-home-panel"
        aria-label="Activity"
        aria-busy="true"
      >
        <ShimmerRows count={4} />
      </section>
    );
  }
  return (
    <div className="activity-panel activity-panel-slot nested-home-panel">
      <ConnectedActivityPanel
        density="page"
        header={null}
        activitySession={activitySession}
        fetchActivity={fetchActivity}
        fetchOperations={fetchOperations}
        regionId={regionId}
      />
    </div>
  );
}

export function ConnectedActivityPanel({
  density,
  header,
  activitySession,
  fetchActivity,
  fetchOperations,
  regionId,
}: {
  density: ActivityPanelDensity;
  header?: ReactNode | null;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  regionId: RegionId;
}) {
  const ownerKey = activitySession?.smartAccount ? activityOwnerKey(activitySession) : null;
  const activity = useActivity(activitySession, fetchActivity);
  const actions = useHomeQuery({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "actions")
      : ["unauthenticated", "actions-disabled"],
    enabled: ownerKey !== null,
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: ({ signal }) => fetchOperations(signal),
    select: (value) => activitySession?.smartAccount
      ? parseRecentMoneyActions(value, activitySession)
      : [],
  });
  const indexedTransactionHashes = useMemo(() => activity.status === "ready"
    ? new Set(activity.page.transfers.map((transfer) => transfer.transactionHash.toLowerCase()))
    : new Set<string>(), [activity]);
  const visibleActions = useMemo(() => dedupeRecentMoneyActions(
    actions.data ?? [],
    indexedTransactionHashes,
  ), [actions.data, indexedTransactionHashes]);
  const indexedRowCount = activity.status === "ready" ? activity.page.transfers.length : 0;

  useEffect(() => {
    if (visibleActions.length > 0 || indexedRowCount > 0) {
      markHomePerformance("activity:first-row");
    }
  }, [indexedRowCount, visibleActions.length]);

  return (
    <ActivityPanel
      session={activitySession}
      fetchActivity={fetchActivity}
      regionId={regionId}
      suppressEmpty={visibleActions.length > 0}
      density={density}
      header={header}
      leading={
        <RecentMoneyActions
          session={activitySession}
          fetchOperations={fetchOperations}
          excludeTransactionHashes={indexedTransactionHashes}
          embedded
          showUnavailableNotice={false}
        />
      }
    />
  );
}
