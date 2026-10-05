"use client";

import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityPanelView,
  type ActivityPanelDensity,
  type FetchActivity,
} from "@/client/activity";
import { activityOwnerKey, useActivity, type RetrySchedule } from "@/client/activity/use-activity";
import { activityOrdersNeedPolling } from "@/client/activity/activity-feed";
import { activityOrdersPath, activityOrdersQuery } from "@/client/activity/activity-orders-query";
import { recentActionsQuery, useRecentActionsStatus } from "@/client/actions/recent-actions-query";
import { browserHomeQueryClient, ownerQueryKey, useHomeMutation, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { ownerMutation } from "@/client/query/mutation-options";
import { AccountWalletContext } from "@/client/account/cdp-client";
import { cashoutOrderAction, cashoutProgress, cashoutWithdrawForDeposit, linkedCashoutWithdraw } from "@/client/activity/cash-out-presenter";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityOrder } from "@/shared/activity/contract-orders";
import { FUNDING_ORDER_RESOLUTION_VERSION, readResolveFundingOrderResponse } from "@/shared/funding/contracts/order-resolution";
import type { ActivityLedgerNextActionKind } from "@/client/activity/activity-ledger";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { useCashOutWithdrawJourney } from "@/client/activity/cash-out-withdraw-journey";
import { openPanelAfterClose, useOptionalHomeShellRouting } from "./panel-routing";
import { ShimmerRows } from "./panel-shared";
import { cancellationErrorCopy, cancellationNeedsRefetch, useCancelFundingOrder } from "@/client/funding/cancel-order";
import { fundingOrderKey } from "@/client/funding/funding-queries";
import { readFundingOrderResponse } from "@/shared/funding/contracts/order";

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
  quietLoading = false,
  density,
  header,
  activitySession,
  fetchActivity,
  fetchOperations,
  regionId,
  emptyAction,
  onDetailsOpenChange,
  scheduleContinuationRetry,
}: {
  quietLoading?: boolean;
  density: ActivityPanelDensity;
  header?: ReactNode | null;
  emptyAction?: ReactNode;
  onDetailsOpenChange?: (open: boolean) => void;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  regionId: RegionId;
  scheduleContinuationRetry?: RetrySchedule;
}) {
  const ownerKey = activitySession?.smartAccount ? activityOwnerKey(activitySession) : null;
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const wallet = useContext(AccountWalletContext);
  const cancelOrderMutation = useCancelFundingOrder(ownerKey, async (path, options) => {
    if (!wallet) throw new Error("Funding is unavailable.");
    return wallet.fetchAccountResource(path, options);
  });
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
  const [cancelActionKind, setCancelActionKind] = useState<ActivityLedgerNextActionKind | null>(null);
  const [reviewOpened, setReviewOpened] = useState(0);
  const [restoreDetailsRequest, setRestoreDetailsRequest] = useState(0);
  const [suspendDetailsRequest, setSuspendDetailsRequest] = useState(0);
  const [appliedPopRevision, setAppliedPopRevision] = useState(routing?.popRevision);
  const [appliedRootRevision, setAppliedRootRevision] = useState(routing?.rootRequest?.revision);
  if (routing && appliedPopRevision !== routing.popRevision) {
    setAppliedPopRevision(routing.popRevision);
    const pending = routing.getActivityReturn?.();
    if (pending) {
      if (routing.state.panel === pending.panel && window.location.pathname === pending.path) {
        if (!pending.suspended) {
          setRestoreDetailsRequest((request) => request + 1);
        }
      } else if (!pending.suspended) {
        setSuspendDetailsRequest((request) => request + 1);
      }
    }
  }
  if (routing && appliedRootRevision !== routing.rootRequest?.revision) {
    setAppliedRootRevision(routing.rootRequest?.revision);
    const pending = routing.getActivityReturn?.();
    if (pending && !(pending.opening && routing.rootRequest?.panel === "investments") && !pending.suspended) {
      setSuspendDetailsRequest((request) => request + 1);
    }
  }
  const cancelAttempt = useRef(0);
  const cancelInFlightRef = useRef(false);
  const cancelOwnerRef = useRef(ownerKey);
  useEffect(() => {
    cancelOwnerRef.current = ownerKey;
    return () => { cancelAttempt.current += 1; cancelInFlightRef.current = false; };
  }, [ownerKey]);
  const [cancelStateOwner, setCancelStateOwner] = useState(ownerKey);
  if (cancelStateOwner !== ownerKey) {
    setCancelStateOwner(ownerKey);
    setCancelBusy(false);
    setCancelActionKind(null);
    setCancelError(null);
  }
  const activity = useActivity(activitySession, fetchActivity, regionId, { scheduleContinuationRetry });
  const actions = useHomeQuery({
    ...recentActionsQuery({ owner: ownerKey, session: activitySession, fetchOperations }),
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !activitySession?.smartAccount ||
        !Array.isArray(query.state.data?.operations)) return false;
      const operations = query.state.data.operations;
      return operations.some((operation) => operation.action.kind === "cash-out" &&
        cashoutProgress(operation, linkedCashoutWithdraw(operation, operations)).refreshing) ? 15_000 : false;
    },
  });
  const ordersQuery = useHomeQuery({
    ...activityOrdersQuery({ owner: ownerKey, session: activitySession,
      fetchOrders: (signal) => wallet!.fetchAccountResource(activityOrdersPath, { signal }), enabled: Boolean(wallet) }),
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !activitySession?.smartAccount ||
        !Array.isArray(query.state.data)) return false;
      return activityOrdersNeedPolling(query.state.data) ? 15_000 : false;
    },
  });
  const operations = Array.isArray(actions.data?.operations) ? actions.data.operations : EMPTY_OPERATIONS;
  const orders = Array.isArray(ordersQuery.data) ? ordersQuery.data : EMPTY_ORDERS;
  const queriedOrdersStatus = useRecentActionsStatus({
    hasData: Array.isArray(ordersQuery.data), isPending: ordersQuery.isPending, isError: ordersQuery.isError,
    dataUpdatedAt: ordersQuery.dataUpdatedAt, errorUpdatedAt: ordersQuery.errorUpdatedAt,
  });
  const ordersStatus = ownerKey && wallet ? queriedOrdersStatus : "ready";
  const refetchOrders = ordersQuery.refetch;
  const retryOrders = useCallback(() => { void refetchOrders(); }, [refetchOrders]);
  const actionStatus = useRecentActionsStatus({
    hasData: Array.isArray(actions.data?.operations),
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
    if (progress?.depositId && cashoutProgress(operation, linkedCashoutWithdraw(operation, operations)).cancellable) {
      void withdrawJourney.prepare(progress.providerId, progress.region, progress.depositId);
    }
  };
  const onOrderAction = async (order: ActivityOrder, kind: ActivityLedgerNextActionKind) => {
    if (kind === "resume" || kind === "complete-payment") {
      if (order.kind === "funding" && order.resumable && order.region === regionId && routing?.setFlow("add-money", { mode: "push", opener: null })) {
        routing.setActivityReturn?.(null);
        setReviewOpened((count) => count + 1);
      }
      return;
    }
    if (kind === "withdraw-returned-funds" || kind === "cancel-cash-out") {
      if (order.kind === "cash-out" && order.orderId &&
        cashoutOrderAction(order, cashoutWithdrawForDeposit(order.orderId, operations)) === kind) {
        void withdrawJourney.prepare(order.providerId, order.region, order.orderId);
      }
      return;
    }
    if (kind === "cancel-order") {
      const latest = orders.find((candidate) => candidate.id === order.id && candidate.kind === "funding");
      if (order.kind !== "funding" || latest?.kind !== "funding" || latest.status !== "waiting-customer" ||
        latest.stage !== "awaiting-payment" || !wallet || !ownerKey || cancelInFlightRef.current) return;
      const attempt = ++cancelAttempt.current;
      const owner = ownerKey;
      const current = () => attempt === cancelAttempt.current && owner === cancelOwnerRef.current;
      cancelInFlightRef.current = true;
      setCancelBusy(true);
      setCancelActionKind(kind);
      setCancelError(null);
      try {
        const resolved = await cancelOrderMutation.mutateAsync(latest);
        if (!current()) return;
        queryClient.setQueryData(fundingOrderKey(owner, resolved.order), resolved.order);
        await refetchOrders();
      } catch (failure) {
        if (!current()) return { ok: false as const, message: cancellationErrorCopy(failure) };
        setCancelError(cancellationErrorCopy(failure));
        if (cancellationNeedsRefetch(failure)) {
          const value = await wallet.fetchAccountResource(`/api/funding/orders/${encodeURIComponent(order.id)}`).catch(() => null);
          const refreshed = readFundingOrderResponse(value);
          if (!current()) return;
          if (refreshed?.id === order.id) queryClient.setQueryData(fundingOrderKey(owner, refreshed), refreshed);
          await refetchOrders();
        }
        return { ok: false as const, message: cancellationErrorCopy(failure) };
      } finally {
        if (current()) { cancelInFlightRef.current = false; setCancelBusy(false); setCancelActionKind(null); }
      }
      return;
    }
    if (kind !== "clear-order" || order.kind !== "funding" || order.status !== "ambiguous" ||
      order.stage !== "unconfirmed" || !order.clearableAt || Date.parse(order.clearableAt) > Date.now() || !wallet || cancelBusy) return;
    const attempt = ++cancelAttempt.current;
    setCancelBusy(true);
    setCancelActionKind(kind);
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
      quietLoading={quietLoading}
      key={`${ownerKey ?? "signed-out"}:${reviewOpened}`}
      activity={activity}
      operations={operations}
      orders={orders}
      actionsStatus={actionStatus}
      actionsRefreshing={actions.isFetching || actions.isPaused}
      actionsFailed={actions.isError}
      ordersStatus={ordersStatus}
      ordersRefreshing={ordersQuery.isFetching || ordersQuery.isPaused}
      ordersFailed={ordersQuery.isError}
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
        const previous = routing.getActivityReturn?.() ?? null;
        if (previous) routing.setActivityReturn?.({ ...previous, opening: true, suspended: true });
        if (routing.openAssetDetail(assetKey)) return true;
        routing.setActivityReturn?.(previous);
        return false;
      }}
      restoreDetailsRequest={restoreDetailsRequest}
      suspendDetailsRequest={suspendDetailsRequest}
      cancelBusy={cancelBusy}
      cancelActionKind={cancelActionKind}
      cancelError={cancelError}
      withdrawJourney={withdrawJourney}
      fetchOperations={fetchOperations}
      onViewActivity={(close) => openPanelAfterClose(routing, "activity", close)}
      onDetailsOpenChange={onDetailsOpenChange}
      initialDetailItem={ownerKey && routing?.activityReturn?.ownerKey === ownerKey &&
        routing.activityReturn.path === window.location.pathname && !routing.activityReturn.suspended
          ? routing.activityReturn.item : null}
      onDetailsSelectionChange={(item) => {
        routing?.setActivityReturn?.(item && ownerKey
          ? { ownerKey, panel: routing.state.panel, path: window.location.pathname, item, opening: false, suspended: false }
          : null);
      }}
      onDetailsChange={(open) => {
        if (!open) routing?.setActivityReturn?.(null);
        cancelAttempt.current += 1;
        cancelInFlightRef.current = false;
        setCancelActionKind(null);
        setCancelBusy(false);
        setCancelError(null);
        withdrawJourney.reset();
      }}
    />
  );
}
