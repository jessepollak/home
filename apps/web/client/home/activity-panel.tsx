"use client";

import { useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  ActivityPanelView,
  type ActivityPanelDensity,
  type FetchActivity,
} from "@/client/activity";
import { activityOwnerKey, useActivity } from "@/client/activity/use-activity";
import { parseRecentMoneyActions } from "@/client/actions";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { AccountWalletContext } from "@/client/account/cdp-client";
import { linkedCashoutWithdraw, presentCashout } from "@/client/activity/cash-out-presenter";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import { announceActionFailure } from "./action-toast-events";
import { useOptionalHomeShellRouting } from "./panel-routing";
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
  emptyAction,
}: {
  density: ActivityPanelDensity;
  header?: ReactNode | null;
  emptyAction?: ReactNode;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  regionId: RegionId;
}) {
  const ownerKey = activitySession?.smartAccount ? activityOwnerKey(activitySession) : null;
  const wallet = useContext(AccountWalletContext);
  const routing = useOptionalHomeShellRouting();
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [reviewOpened, setReviewOpened] = useState(0);
  const cancelAttempt = useRef(0);
  const activity = useActivity(activitySession, fetchActivity, regionId);
  const actions = useHomeQuery({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "actions")
      : ["unauthenticated", "actions-disabled"],
    enabled: ownerKey !== null,
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !activitySession?.smartAccount) return false;
      const operations = parseRecentMoneyActions(query.state.data, activitySession);
      return operations.some((operation) => operation.action.kind === "cash-out" &&
        presentCashout(operation, linkedCashoutWithdraw(operation, operations)).refreshing) ? 15_000 : false;
    },
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: ({ signal }) => fetchOperations(signal),
    select: (value) => activitySession?.smartAccount
      ? parseRecentMoneyActions(value, activitySession)
      : [],
  });
  const actionStatus = actions.isPending ? "loading" : actions.isError ? "error" : "ready";
  const refetchActions = actions.refetch;
  const retryActions = useCallback(() => { void refetchActions(); }, [refetchActions]);

  const cancelCashout = async (operation: RecentMoneyActionOperation) => {
    const progress = operation.cashout;
    if (!wallet || !routing || !progress?.depositId || cancelBusy ||
      !presentCashout(operation, linkedCashoutWithdraw(operation, actions.data ?? [])).cancellable) return;
    const attempt = ++cancelAttempt.current;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const prepared = await wallet.prepareMoneyAction("cash-out-withdraw", {
        providerId: progress.providerId,
        region: progress.region as RegionId,
        depositId: progress.depositId,
      });
      if (prepared.kind !== "cash-out-withdraw" || prepared.metadata?.product !== "cashout" || prepared.metadata.operation !== "withdraw") {
        throw new Error("Cash-out withdrawal review is unavailable. Try again.");
      }
      if (attempt !== cancelAttempt.current) return;
      if (!routing.setFlow("send", { actionId: prepared.id, mode: "push" })) {
        throw new Error("Cash-out withdrawal review is unavailable. Try again.");
      }
      setReviewOpened((count) => count + 1);
    } catch (error) {
      const failure = error as { code?: unknown; serverMessage?: unknown };
      const message = networkFeeErrorMessage(error) ?? (typeof failure.code === "string" && failure.code.startsWith("CASHOUT_") && typeof failure.serverMessage === "string"
        ? failure.serverMessage
        : error instanceof Error && error.message === "Cash-out withdrawal review is unavailable. Try again."
          ? error.message
          : "Could not prepare the withdrawal. Try again.");
      setCancelError((current) => attempt === cancelAttempt.current ? message : current);
      if (attempt === cancelAttempt.current) announceActionFailure("cash-out-withdraw", message);
    } finally {
      if (attempt === cancelAttempt.current) setCancelBusy(false);
    }
  };
  return (
    <ActivityPanelView
      key={`${ownerKey ?? "signed-out"}:${reviewOpened}`}
      activity={activity}
      operations={actions.data ?? []}
      actionsStatus={actionStatus}
      regionId={regionId}
      density={density}
      header={header}
      emptyAction={emptyAction}
      retryActions={retryActions}
      onCancelCashout={(operation) => { void cancelCashout(operation); }}
      cancelBusy={cancelBusy}
      cancelError={cancelError}
      onDetailsChange={() => {
        cancelAttempt.current += 1;
        setCancelBusy(false);
        setCancelError(null);
      }}
    />
  );
}
