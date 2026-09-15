"use client";

import type { ReactNode } from "react";
import {
  ActivityPanelView,
  type ActivityPanelDensity,
  type FetchActivity,
} from "@/client/activity";
import { activityOwnerKey, useActivity } from "@/client/activity/use-activity";
import { parseRecentMoneyActions } from "@/client/actions";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
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
        className="space-y-3"
        aria-label="Activity"
        aria-busy="true"
      >
        <ShimmerRows count={4} />
      </section>
    );
  }
  return (
    <div>
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
  const actionStatus = actions.isPending ? "loading" : actions.isError ? "error" : "ready";

  return (
    <ActivityPanelView
      key={ownerKey ?? "signed-out"}
      activity={activity}
      operations={actions.data ?? []}
      actionsStatus={actionStatus}
      regionId={regionId}
      density={density}
      header={header}
    />
  );
}
