"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadErrorCard, LoadRetryButton } from "@/components/load-error";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ActivityLoader } from "@/components/activity-loader";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { moneySheetLoading } from "@/client/money-modal";
import { ActivityLedger, uniqueActivityLedgerItems, type ActivityLedgerEntry, type ActivityLedgerItem } from "./activity-ledger";
import type { ActivityListHandle } from "./virtual-activity-list";
import { presentActivityLedgerEntries, presentActivityLedgerItems } from "./activity-ledger-items";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityOrder } from "@/shared/activity/contract-orders";
import type { ActivityLedgerNextActionKind } from "./activity-ledger";
import type { CashOutWithdrawJourney } from "./cash-out-withdraw-journey";
import type { RegionId } from "@/config/regions";
import { mergeActivityFeed, type ActivityFeedItem } from "./activity-feed";
import { activitySourcesAttribute, sourceReadiness, transfersReadiness } from "./activity-sources";
import { type UseActivityResult } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ActivityPanelDensity, ActivityTransfer } from "./types";

const ActivityLedgerSheet = deferSheet(() => import("./activity-ledger-sheet").then((module) => module.ActivityLedgerDetailSheet),
  (props) => moneySheetLoading({ title: props.item?.title ?? "Activity", closeLabel: `Close ${props.item?.title ?? "activity"} details`, onCancel: props.onDismiss, onClosed: props.onClosed }));
const EMPTY_TRANSFERS: readonly ActivityTransfer[] = [];
const EMPTY_OPERATIONS: readonly RecentMoneyActionOperation[] = [];
const EMPTY_ORDERS: readonly ActivityOrder[] = [];

export function ActivityPanelView({
  activity,
  operations = EMPTY_OPERATIONS,
  orders = EMPTY_ORDERS,
  actionsStatus = "ready",
  actionsRefreshing = false,
  actionsFailed = false,
  ordersStatus = "ready",
  ordersRefreshing = false,
  ordersFailed = false,
  regionId = "GLOBAL",
  density = "page",
  header,
  emptyAction,
  retryActions,
  retryOrders,
  onCancelCashout,
  onOrderAction,
  cancelBusy = false,
  cancelError = null,
  withdrawJourney,
  fetchOperations,
  onViewActivity,
  onDetailsChange,
  initialDetailItem = null,
  onDetailsSelectionChange,
  onDetailsOpenChange,
  canOpenAsset,
  onOpenAsset,
  restoreDetailsRequest = 0,
  suspendDetailsRequest = 0,
}: {
  activity: UseActivityResult;
  operations?: readonly RecentMoneyActionOperation[];
  orders?: readonly ActivityOrder[];
  actionsStatus?: "loading" | "ready" | "error";
  actionsRefreshing?: boolean;
  actionsFailed?: boolean;
  ordersStatus?: "loading" | "ready" | "error";
  ordersRefreshing?: boolean;
  ordersFailed?: boolean;
  regionId?: RegionId;
  density?: ActivityPanelDensity;
  header?: ReactNode | null;
  emptyAction?: ReactNode;
  retryActions?: () => void;
  retryOrders?: () => void;
  onCancelCashout?: (operation: RecentMoneyActionOperation) => void;
  onOrderAction?: (order: ActivityOrder, kind: ActivityLedgerNextActionKind) => void;
  cancelBusy?: boolean;
  cancelError?: string | null;
  withdrawJourney?: CashOutWithdrawJourney;
  fetchOperations?: (signal?: AbortSignal) => Promise<unknown>;
  onViewActivity?: (close: () => void) => void;
  onDetailsChange?: (open: boolean) => void;
  initialDetailItem?: ActivityLedgerItem | null;
  onDetailsSelectionChange?: (item: ActivityLedgerItem | null) => void;
  onDetailsOpenChange?: (open: boolean) => void;
  canOpenAsset?: (assetKey: string) => boolean;
  onOpenAsset?: (assetKey: string) => boolean;
  restoreDetailsRequest?: number;
  suspendDetailsRequest?: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const [selection, setSelection] = useState<{ key: string; last: ActivityLedgerItem } | null>(() => initialDetailItem
    ? { key: `${initialDetailItem.family}:${initialDetailItem.id}`, last: initialDetailItem } : null);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailItem !== null);
  const [immediateClose, setImmediateClose] = useState(false);
  if (initialDetailItem && !selection && !detailsOpen && activity.status === "ready") {
    setSelection({ key: `${initialDetailItem.family}:${initialDetailItem.id}`, last: initialDetailItem });
    setDetailsOpen(true);
  }
  useEffect(() => {
    onDetailsOpenChange?.(detailsOpen);
    return () => { onDetailsOpenChange?.(false); };
  }, [detailsOpen, onDetailsOpenChange]);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const [pendingReturn, setPendingReturn] = useState(false);
  const [seenRestoreRequest, setSeenRestoreRequest] = useState(restoreDetailsRequest);
  const [seenSuspendRequest, setSeenSuspendRequest] = useState(suspendDetailsRequest);
  if (seenSuspendRequest !== suspendDetailsRequest) {
    setSeenSuspendRequest(suspendDetailsRequest);
    if (detailsOpen) {
      setPendingReturn(true);
      setImmediateClose(true);
      setDetailsOpen(false);
    }
  }
  if (seenRestoreRequest !== restoreDetailsRequest) {
    setSeenRestoreRequest(restoreDetailsRequest);
    if (pendingReturn && selection && activity.status === "ready") {
      setPendingReturn(false);
      setImmediateClose(false);
      setDetailsOpen(true);
    }
  }
  const recentRef = useRef<ActivityListHandle>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const onDetailsChangeRef = useRef(onDetailsChange);
  useEffect(() => { onDetailsChangeRef.current = onDetailsChange; }, [onDetailsChange]);
  const openDetail = useCallback((item: ActivityLedgerItem, opener: HTMLElement) => {
    setPendingReturn(false);
    setImmediateClose(false);
    detailOpenerRef.current = opener;
    onDetailsChangeRef.current?.(true);
    onDetailsSelectionChange?.(item);
    setSelection({ key: `${item.family}:${item.id}`, last: item });
    setDetailsOpen(true);
  }, [onDetailsSelectionChange]);
  const [detailsStatus, setDetailsStatus] = useState(activity.status);
  if (detailsStatus !== activity.status) {
    setDetailsStatus(activity.status);
    if (activity.status !== "ready") {
      setPendingReturn(false);
      setDetailsOpen(false);
      setSelection(null);
    }
  }
  const heading = header === undefined ? <DefaultActivityHeader /> : header;
  const labelledBy = header === null ? undefined : "activity-title";
  const labelled = header === null ? "Activity" : undefined;
  const transfers = activity.status === "ready" ? activity.page.transfers : EMPTY_TRANSFERS;
  const pendingWindowEnd = activity.status === "ready" && activity.page.nextCursor !== null ? activity.page.window.to : null;
  const loadedThrough = useMemo(() => pendingWindowEnd !== null
    ? transfers.length > 0
      ? transfers.reduce((oldest, transfer) =>
        Date.parse(transfer.blockTimestamp) < Date.parse(oldest) ? transfer.blockTimestamp : oldest,
      transfers[0]!.blockTimestamp)
      : pendingWindowEnd
    : null, [transfers, pendingWindowEnd]);
  const cards = activity.status === "ready" ? activity.page.cards?.rows : undefined;
  const feed = useMemo(() => mergeActivityFeed({ transfers, operations, orders, cards, loadedThrough }), [transfers, operations, orders, cards, loadedThrough]);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const deadline = orders.reduce((earliest, order) => {
      if (order.kind !== "funding" || order.status !== "ambiguous" || order.stage !== "unconfirmed" || order.clearableAt === null) return earliest;
      const clearableAt = Date.parse(order.clearableAt);
      return clearableAt > now ? Math.min(earliest, clearableAt) : earliest;
    }, Infinity);
    if (deadline === Infinity) return;
    const timeout = setTimeout(() => setClock((value) => value + 1), Math.min(deadline - Date.now(), 2 ** 31 - 1));
    return () => clearTimeout(timeout);
  }, [orders, clock]);
  const [presented, setPresented] = useState<{
    feed: readonly ActivityFeedItem[];
    regionId: RegionId;
    clock: number;
    pairs: { source: ActivityFeedItem; item: ActivityLedgerItem }[];
    entries: ActivityLedgerEntry[];
    transfers: Map<string, { source: ActivityFeedItem; item: ActivityLedgerItem }>;
  }>(() => ({ feed: [], regionId, clock, pairs: [], entries: [], transfers: new Map() }));
  let current = presented;
  if (presented.feed !== feed || presented.regionId !== regionId || presented.clock !== clock) {
    const transfers = new Map<string, { source: ActivityFeedItem; item: ActivityLedgerItem }>();
    const pairs = uniqueActivityLedgerItems(feed.map((source) => {
      const previous = source.kind === "transfer" ? presented.transfers.get(source.id) : undefined;
      const item = previous && source.kind === "transfer" && previous.source.kind === "transfer" &&
        previous.source.transfer === source.transfer && presented.regionId === regionId
        ? previous.item : presentActivityLedgerItems([source], { regionId })[0]!;
      if (source.kind === "transfer") transfers.set(source.id, { source, item });
      return { item, source };
    }), (pair) => pair.item);
    current = { feed, regionId, clock, pairs, transfers,
      entries: presentActivityLedgerEntries(pairs, { regionId }, presented.regionId === regionId ? presented.entries : []),
    };
    setPresented(current);
  }
  const { pairs, entries } = current;
  const items = useMemo(() => pairs.map((pair) => pair.item), [pairs]);
  const hasRows = items.length > 0;
  const selectedItem = selection
    ? items.find((item) => `${item.family}:${item.id}` === selection.key) ?? selection.last
    : null;
  if (selection && selectedItem && selectedItem !== selection.last) {
    setSelection({ key: selection.key, last: selectedItem });
  }
  const exhausted = activity.status !== "ready" || activity.page.nextCursor === null && activity.page.onchainStatus !== "unavailable";
  const plain = density === "feed";
  const onchainUnavailable = activity.status === "ready" && activity.page.onchainStatus === "unavailable";
  const latestUnavailable = activity.status === "ready" && activity.latestUnavailable === true;
  const sourcesPending = activity.status === "loading" || actionsStatus === "loading" || ordersStatus === "loading";
  if (!revealed && !sourcesPending) setRevealed(true);
  const retryFailedSources = () => {
    if (activity.status === "error" || onchainUnavailable || latestUnavailable) activity.retry();
    if (actionsStatus === "error") retryActions?.();
    if (ordersStatus === "error") retryOrders?.();
    if (activity.status === "ready" && activity.loadMoreError) activity.retryLoadMore();
  };
  const inlineStatus = !plain;

  const historyUnknown = activity.status === "error" || onchainUnavailable || latestUnavailable || actionsStatus === "error" || ordersStatus === "error";
  const sources = activitySourcesAttribute({ transfers: transfersReadiness(activity), actions: sourceReadiness(actionsStatus, actionsRefreshing, actionsFailed), orders: sourceReadiness(ordersStatus, ordersRefreshing, ordersFailed) });

  if (activity.status === "unavailable" && !hasRows && actionsStatus !== "error" && ordersStatus !== "error") {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} sources={sources} sectionRef={sectionRef}>
        <ActivityEmpty plain={plain} action={emptyAction} />
      </ActivitySurface>
    );
  }

  if (sourcesPending && (!revealed || !hasRows)) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} busy sources={sources} sectionRef={sectionRef}>
        <ShimmerRows count={plain ? 3 : 4} />
        <span className="sr-only">Loading recent activity…</span>
      </ActivitySurface>
    );
  }

  if (historyUnknown && !hasRows && plain) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} sources={sources} sectionRef={sectionRef}>
        <ActivityUnavailable message="Activity unavailable" onReload={retryFailedSources} />
      </ActivitySurface>
    );
  }

  if (activity.status === "error" && !hasRows) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} sources={sources} sectionRef={sectionRef}>
        <LoadErrorCard
          tone="destructive"
          role="alert"
          title="Activity is temporarily unavailable."
          description={activity.error.message || activity.error.code || undefined}
          onRetry={activity.retry}
        />
      </ActivitySurface>
    );
  }

  const cardUnavailable = activity.status === "ready" && activity.page.cards?.status === "unavailable";
  const footer = activity.status === "ready" && !onchainUnavailable ? (
    activity.page.nextCursor === null ? hasRows ? (
      <p className="text-center text-xs text-muted-foreground" role="status">End of activity</p>
    ) : null : (
      <ActivityContinuation activity={activity} inlineStatus={inlineStatus} feedStatus={plain && !historyUnknown} />
    )
  ) : null;
  return (
    <>
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} busy={sourcesPending} rows={hasRows} sources={sources} sectionRef={sectionRef}>
        {cardUnavailable ? <p role="status" className="text-sm text-muted-foreground">Card purchases may be out of date.</p> : null}
        {inlineStatus && (activity.status === "error" || onchainUnavailable) ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-muted-foreground">
              Onchain transfers are unavailable. Other available activity is still shown.
            </p>
            <LoadRetryButton onRetry={activity.retry}>Retry onchain transfers</LoadRetryButton>
          </div>
        ) : null}
        {inlineStatus && activity.status !== "error" && latestUnavailable && !onchainUnavailable ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-muted-foreground">
              Latest activity didn&apos;t load. Earlier activity is still shown.
            </p>
            <LoadRetryButton onRetry={activity.retry}>Retry latest activity</LoadRetryButton>
          </div>
        ) : null}
        {inlineStatus && actionsStatus === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-muted-foreground">
              Recorded Home actions are unavailable.{transfers.length > 0 ? " Onchain transfers are still shown." : ""}
            </p>
            {retryActions ? <LoadRetryButton onRetry={retryActions}>Retry recorded actions</LoadRetryButton> : null}
          </div>
        ) : null}
        {inlineStatus && ordersStatus === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-muted-foreground">Add money and cash-out orders are unavailable.</p>
            {retryOrders ? <LoadRetryButton onRetry={retryOrders}>Retry orders</LoadRetryButton> : null}
          </div>
        ) : null}
        {plain && historyUnknown ? (
          <ActivityUnavailable message="Some activity is unavailable" onReload={retryFailedSources} />
        ) : null}
        {!hasRows ? (exhausted && !historyUnknown ? <ActivityEmpty plain={plain} action={emptyAction} /> : null) : (
          <div onPointerDown={() => void ActivityLedgerSheet.preload()}>
            <ActivityLedger
              items={entries}
              layout={plain ? "feed" : "page"}
              footer={footer}
              exhausted={exhausted}
              recentRef={recentRef}
              onOpen={openDetail}
            />
          </div>
        )}
        {!hasRows ? footer : null}
      </ActivitySurface>
      <ActivityLedgerSheet
        open={detailsOpen}
        immediate={immediateClose}
        item={selectedItem}
        canOpenAsset={canOpenAsset}
        onOpenAsset={(item) => {
          const key = item.detailAsset?.assetKey;
          if (!key || !onOpenAsset?.(key)) return;
          setPendingReturn(true);
          setImmediateClose(true);
          setDetailsOpen(false);
        }}
        onDismiss={() => {
          setPendingReturn(false);
          setDetailsOpen(false);
          onDetailsChange?.(false);
          onDetailsSelectionChange?.(null);
        }}
        onClosed={() => {
          if (pendingReturn || detailsOpen) return;
          setSelection(null);
          const opener = detailOpenerRef.current;
          detailOpenerRef.current = null;
          if (opener?.isConnected && sectionRef.current?.contains(opener)) {
            opener.focus({ preventScroll: true });
          } else if (!selection || !recentRef.current?.restore(selection.key)) {
            sectionRef.current?.focus();
          }
        }}
        onAction={(item, kind) => {
          const source = pairs.find((pair) => `${pair.item.family}:${pair.item.id}` === `${item.family}:${item.id}`)?.source;
          if (source?.kind === "order" && (item.family === "funding-order" || item.family === "cash-out-order")) {
            onOrderAction?.(source.order, kind);
          } else if (kind === "cancel-cash-out" && item.family === "home-action" &&
            source?.kind === "action" && source.operation.action.kind === "cash-out") onCancelCashout?.(source.operation);
        }}
        actionBusy={cancelBusy}
        actionError={cancelError}
        withdrawJourney={withdrawJourney}
        fetchOperations={fetchOperations}
        onViewActivity={onViewActivity}
      />
    </>
  );
}

export function ActivitySurface({
  heading,
  labelledBy,
  label,
  busy = false,
  plain = false,
  rows = false,
  sources,
  sectionRef,
  children,
}: {
  heading: ReactNode;
  labelledBy?: string;
  label?: string;
  busy?: boolean;
  plain?: boolean;
  rows?: boolean;
  sources?: string;
  sectionRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  if (plain) {
    return (
      <section
        ref={sectionRef}
        tabIndex={-1}
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-busy={busy || undefined}
        data-activity-feed=""
        data-activity-sources={sources}
      >
        <Card className="gap-3">
          {heading ? <CardHeader>{heading}</CardHeader> : null}
          <CardContent inset="list">
            <div className="space-y-3">{children}</div>
          </CardContent>
        </Card>
      </section>
    );
  }
  if (rows) {
    return (
      <section ref={sectionRef} tabIndex={-1} aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined} data-activity-sources={sources}>
        {heading ? <div className="mb-3">{heading}</div> : null}
        <div className="space-y-3">{children}</div>
      </section>
    );
  }
  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined} data-activity-sources={sources}>
      <Card>
        {heading ? <CardHeader>{heading}</CardHeader> : null}
        <CardContent inset="list">
          <div className="space-y-3">{children}</div>
        </CardContent>
      </Card>
    </section>
  );
}

function ActivityContinuation({
  activity,
  inlineStatus,
  feedStatus,
}: {
  activity: UseActivityResult;
  inlineStatus: boolean;
  feedStatus: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const setSentinelVisible = activity.setSentinelVisible;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setSentinelVisible(entry.isIntersecting);
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      setSentinelVisible(false);
    };
  }, [setSentinelVisible]);

  return (
    <div className="space-y-2">
      <p className="sr-only" role="status">
        {activity.continuing ? "Loading older activity" : ""}
      </p>
      <ActivityLoader loading={!activity.loadMoreError && (activity.continuing || activity.loadingMore)}>
        {activity.loadMoreError ? inlineStatus ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-destructive" role="alert">
              More activity could not be loaded. Your current results are unchanged.
            </p>
            <LoadRetryButton onRetry={activity.retryLoadMore} />
          </div>
        ) : feedStatus ? (
          <ActivityUnavailable message="More activity unavailable" onReload={activity.retryLoadMore} />
        ) : null : null}
      </ActivityLoader>
      <div ref={sentinelRef} className="h-px w-full" data-activity-sentinel="" aria-hidden="true" />
    </div>
  );
}

function ActivityUnavailable({
  message,
  onReload,
  reloadLabel = "Reload activity",
}: {
  message: string;
  onReload: () => void;
  reloadLabel?: string;
}) {
  return (
    <div className="flex items-center justify-center gap-1" data-activity-unavailable="">
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 md:pointer-fine:size-8"
        aria-label={reloadLabel}
        onClick={onReload}
      >
        <RotateCw aria-hidden="true" />
      </Button>
    </div>
  );
}

function ActivityEmpty({ plain, action }: { plain: boolean; action?: ReactNode }) {
  if (plain && action) {
    return <EmptyState title="No activity yet" className="gap-3 p-4" content={action} data-activity-nux="" />;
  }
  return <EmptyState title="No activity yet" align="start" />;
}

function DefaultActivityHeader() {
  return <h2 id="activity-title" className="text-lg font-semibold">Activity</h2>;
}
