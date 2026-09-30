"use client";

import { useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityPanelView,
  type ActivityPanelDensity,
  type FetchActivity,
} from "@/client/activity";
import { activityOwnerKey, useActivity } from "@/client/activity/use-activity";
import { activityOrdersNeedPolling } from "@/client/activity/activity-feed";
import { parseRecentMoneyActions } from "@/client/actions";
import { fetchRecentActions, recentActionsQueryOptions, useRecentActionsStatus } from "@/client/actions/recent-actions-query";
import { browserHomeQueryClient, ownerQueryKey, ownerQueryMeta, useHomeMutation, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { ownerMutation } from "@/client/query/mutation-options";
import { AccountWalletContext } from "@/client/account/cdp-client";
import { cashoutOrderAction, cashoutProgress, cashoutWithdrawForDeposit, linkedCashoutWithdraw } from "@/client/activity/cash-out-presenter";
import { isRecentActionsResponse, type RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { parseActivityOrders, type ActivityOrder } from "@/shared/activity/contract-orders";
import { FUNDING_ORDER_RESOLUTION_VERSION, readResolveFundingOrderResponse } from "@/shared/funding/contracts/order-resolution";
import type { ActivityLedgerNextActionKind } from "@/client/activity/activity-ledger";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { useCashOutWithdrawJourney } from "@/client/activity/cash-out-withdraw-journey";
import { openPanelAfterClose, useOptionalHomeShellRouting } from "./panel-routing";
import { ShimmerRows } from "./panel-shared";

const EMPTY_OPERATIONS: readonly RecentMoneyActionOperation[] = [];
const EMPTY_ORDERS: readonly ActivityOrder[] = [];

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
  onDetailsOpenChange,
}: {
  density: ActivityPanelDensity;
  header?: ReactNode | null;
  emptyAction?: ReactNode;
  onDetailsOpenChange?: (open: boolean) => void;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  regionId: RegionId;
}) {
  const ownerKey = activitySession?.smartAccount ? activityOwnerKey(activitySession) : null;
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const wallet = useContext(AccountWalletContext);
  const clearOrderMutation = useHomeMutation(ownerMutation({
    owner: ownerKey,
    invalidates: (order: ActivityOrder) => [{ scope: "funding-open-order", key: [order.region], refetchType: "all" }],
    mutationFn: async (order: ActivityOrder) => {
      const body = await wallet!.fetchAccountResource(
        `/api/funding/orders/${encodeURIComponent(order.id)}/resolve`,
        { method: "POST", body: { version: FUNDING_ORDER_RESOLUTION_VERSION } },
      );
      const resolved = readResolveFundingOrderResponse(body);
      if (!resolved || resolved.order.id !== order.id) throw new Error("resolution");
      return resolved;
    },
  }));
  const routing = useOptionalHomeShellRouting();
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [reviewOpened, setReviewOpened] = useState(0);
  const [restoreDetailsRequest, setRestoreDetailsRequest] = useState(0);
  const [suspendDetailsRequest, setSuspendDetailsRequest] = useState(0);
  const assetReturnRef = useRef<{ panel: string; path: string; opening: boolean; suspended: boolean } | null>(null);
  const previousPopRevisionRef = useRef(routing?.popRevision);
  const previousRootRevisionRef = useRef(routing?.rootRequest?.revision);
  useLayoutEffect(() => {
    if (previousPopRevisionRef.current === routing?.popRevision) return;
    previousPopRevisionRef.current = routing?.popRevision;
    const pending = assetReturnRef.current;
    if (!pending) return;
    if (routing?.state.panel === pending.panel && window.location.pathname === pending.path) {
      if (pending.suspended) {
        pending.suspended = false;
        setRestoreDetailsRequest((request) => request + 1);
      }
    } else if (!pending.suspended) {
      pending.suspended = true;
      setSuspendDetailsRequest((request) => request + 1);
    }
  }, [routing?.popRevision, routing?.state.panel]);
  useLayoutEffect(() => {
    if (previousRootRevisionRef.current === routing?.rootRequest?.revision) return;
    previousRootRevisionRef.current = routing?.rootRequest?.revision;
    const pending = assetReturnRef.current;
    if (!pending) return;
    if (pending.opening && routing?.rootRequest?.panel === "investments") {
      pending.opening = false;
      return;
    }
    if (!pending.suspended) setSuspendDetailsRequest((request) => request + 1);
    assetReturnRef.current = null;
  }, [routing?.rootRequest]);
  const cancelAttempt = useRef(0);
  const activity = useActivity(activitySession, fetchActivity, regionId);
  const selectActions = useCallback((value: unknown) => activitySession?.smartAccount
    ? parseRecentMoneyActions(value, activitySession)
    : EMPTY_OPERATIONS, [activitySession]);
  const actions = useHomeQuery({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "actions")
      : ["unauthenticated", "actions-disabled"],
    enabled: ownerKey !== null,
    ...recentActionsQueryOptions,
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !activitySession?.smartAccount ||
        !isRecentActionsResponse(query.state.data)) return false;
      const operations = parseRecentMoneyActions(query.state.data, activitySession);
      return operations.some((operation) => operation.action.kind === "cash-out" &&
        cashoutProgress(operation, linkedCashoutWithdraw(operation, operations)).refreshing) ? 15_000 : false;
    },
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: ({ signal }) => fetchRecentActions(fetchOperations, signal),
    select: selectActions,
  });
  const selectOrders = useCallback((value: unknown) => activitySession?.smartAccount
    ? parseActivityOrders(value, activitySession)
    : EMPTY_ORDERS, [activitySession]);
  const orders = useHomeQuery({
    queryKey: ownerKey ? ownerQueryKey(ownerKey, "activity-orders") : ["unauthenticated", "activity-orders-disabled"],
    enabled: ownerKey !== null && Boolean(wallet),
    ...recentActionsQueryOptions,
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !activitySession?.smartAccount ||
        !query.state.data) return false;
      try {
        const parsed = parseActivityOrders(query.state.data, activitySession);
        return activityOrdersNeedPolling(parsed) ? 15_000 : false;
      } catch {
        return false;
      }
    },
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: ({ signal }) => wallet!.fetchAccountResource("/api/activity/orders", { signal }),
    select: selectOrders,
  });
  const queriedOrdersStatus = useRecentActionsStatus({
    hasData: orders.data !== undefined, isPending: orders.isPending, isError: orders.isError,
    dataUpdatedAt: orders.dataUpdatedAt, errorUpdatedAt: orders.errorUpdatedAt,
  });
  const ordersStatus = ownerKey && wallet ? queriedOrdersStatus : "ready";
  const refetchOrders = orders.refetch;
  const retryOrders = useCallback(() => { void refetchOrders(); }, [refetchOrders]);
  const actionStatus = useRecentActionsStatus({
    hasData: actions.data !== undefined,
    isPending: actions.isPending,
    isError: actions.isError,
    dataUpdatedAt: actions.dataUpdatedAt,
    errorUpdatedAt: actions.errorUpdatedAt,
  });
  const refetchActions = actions.refetch;
  const retryActions = useCallback(() => { void refetchActions(); }, [refetchActions]);

  const withdrawJourney = useCashOutWithdrawJourney({ wallet, ownerKey, onDispatched: () => {
    if (!ownerKey) return;
    void queryClient.invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "actions") });
    void queryClient.invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "activity-orders") });
  } });
  const cancelCashout = (operation: RecentMoneyActionOperation) => {
    const progress = operation.cashout;
    if (progress?.depositId && cashoutProgress(operation, linkedCashoutWithdraw(operation, actions.data ?? EMPTY_OPERATIONS)).cancellable) {
      void withdrawJourney.prepare(progress.providerId, progress.region, progress.depositId);
    }
  };
  const onOrderAction = async (order: ActivityOrder, kind: ActivityLedgerNextActionKind) => {
    if (kind === "resume" || kind === "complete-payment") {
      if (order.kind === "funding" && order.resumable && order.region === regionId && routing?.setFlow("add-money", { mode: "push" })) {
        setReviewOpened((count) => count + 1);
      }
      return;
    }
    if (kind === "withdraw-returned-funds" || kind === "cancel-cash-out") {
      if (order.kind === "cash-out" && order.orderId &&
        cashoutOrderAction(order, cashoutWithdrawForDeposit(order.orderId, actions.data ?? EMPTY_OPERATIONS)) === kind) {
        void withdrawJourney.prepare(order.providerId, order.region, order.orderId);
      }
      return;
    }
    if (kind !== "clear-order" || order.kind !== "funding" || order.status !== "ambiguous" ||
      order.stage !== "unconfirmed" || !order.clearableAt || Date.parse(order.clearableAt) > Date.now() || !wallet || cancelBusy) return;
    const attempt = ++cancelAttempt.current;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await clearOrderMutation.mutateAsync(order);
      if (attempt === cancelAttempt.current) await refetchOrders();
    } catch (error) {
      const failure = error as { serverMessage?: unknown };
      const message = typeof failure.serverMessage === "string" && failure.serverMessage
        ? failure.serverMessage : "Could not clear the order. Try again.";
      if (attempt === cancelAttempt.current) setCancelError(message);
      return { ok: false as const, message };
    } finally {
      if (attempt === cancelAttempt.current) setCancelBusy(false);
    }
  };
  return (
    <ActivityPanelView
      key={`${ownerKey ?? "signed-out"}:${reviewOpened}`}
      activity={activity}
      operations={actions.data ?? EMPTY_OPERATIONS}
      orders={orders.data ?? EMPTY_ORDERS}
      actionsStatus={actionStatus}
      actionsRefreshing={actions.isFetching || actions.isPaused}
      actionsFailed={actions.isError}
      ordersStatus={ordersStatus}
      ordersRefreshing={orders.isFetching || orders.isPaused}
      ordersFailed={orders.isError}
      regionId={regionId}
      density={density}
      header={header}
      emptyAction={emptyAction}
      retryActions={retryActions}
      retryOrders={retryOrders}
      onOrderAction={(order, kind) => { void onOrderAction(order, kind); }}
      onCancelCashout={(operation) => { void cancelCashout(operation); }}
      canOpenAsset={routing?.canOpenAssetDetail}
      onOpenAsset={(assetKey) => {
        if (!routing) return false;
        const previous = assetReturnRef.current;
        assetReturnRef.current = { panel: routing.state.panel, path: window.location.pathname, opening: true, suspended: true };
        if (routing.openAssetDetail(assetKey)) return true;
        assetReturnRef.current = previous;
        return false;
      }}
      restoreDetailsRequest={restoreDetailsRequest}
      suspendDetailsRequest={suspendDetailsRequest}
      cancelBusy={cancelBusy}
      cancelError={cancelError}
      withdrawJourney={withdrawJourney}
      fetchOperations={fetchOperations}
      onViewActivity={(close) => openPanelAfterClose(routing, "activity", close)}
      onDetailsOpenChange={onDetailsOpenChange}
      onDetailsChange={(open) => {
        assetReturnRef.current = open && routing
          ? { panel: routing.state.panel, path: window.location.pathname, opening: false, suspended: false }
          : null;
        cancelAttempt.current += 1;
        setCancelBusy(false);
        setCancelError(null);
        withdrawJourney.reset();
      }}
    />
  );
}
