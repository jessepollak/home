"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { LoadErrorCard } from "@/components/load-error";
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
import { retainActivityRows } from "./retained-activity";
import { type UseActivityResult } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ActivityPanelDensity, ActivityTransfer } from "./types";

const ActivityLedgerSheet = deferSheet(() => import("./activity-ledger-sheet").then((module) => module.ActivityLedgerDetailSheet),
  (props) => moneySheetLoading({ title: props.item?.title ?? "Activity", closeLabel: `Close ${props.item?.title ?? "activity"} details`, onCancel: props.onDismiss, onClosed: props.onClosed }));
const EMPTY_TRANSFERS: readonly ActivityTransfer[] = [];
const EMPTY_OPERATIONS: readonly RecentMoneyActionOperation[] = [];
const EMPTY_ORDERS: readonly ActivityOrder[] = [];

export function ActivityPanelView({
  quietLoading = false,
  activity,
  operations: nextOperations = EMPTY_OPERATIONS,
  orders: nextOrders = EMPTY_ORDERS,
  actionsStatus = "ready",
  actionsFailed = false,
  ordersStatus = "ready",
  ordersFailed = false,
  regionId = "GLOBAL",
  density = "page",
  header,
  emptyAction,
  retryActions,
  retryOrders,
  onCancelCashout,
  onOrderAction,
  onCardAction,
  canCardAct,
  cancelBusy = false,
  cancelActionKind = null,
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
  quietLoading?: boolean;
  activity: UseActivityResult;
  operations?: readonly RecentMoneyActionOperation[];
  orders?: readonly ActivityOrder[];
  actionsStatus?: "loading" | "ready" | "error";
  actionsFailed?: boolean;
  ordersStatus?: "loading" | "ready" | "error";
  ordersFailed?: boolean;
  regionId?: RegionId;
  density?: ActivityPanelDensity;
  header?: ReactNode | null;
  emptyAction?: ReactNode;
  retryActions?: () => void;
  retryOrders?: () => void;
  onCancelCashout?: (operation: RecentMoneyActionOperation) => void;
  onOrderAction?: (order: ActivityOrder, kind: ActivityLedgerNextActionKind) => void;
  onCardAction?: (kind: "unlock-card" | "add-money", close: () => void) => void;
  canCardAct?: (kind: "unlock-card" | "add-money") => boolean;
  cancelBusy?: boolean;
  cancelActionKind?: ActivityLedgerNextActionKind | null;
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
  const retentionOwner = activity.ownerKey ?? (activity.status === "ready" ? activity.page.walletAddress : null);
  const [retainedSources, setRetainedSources] = useState({ owner: retentionOwner, regionId, operations: nextOperations, orders: nextOrders });
  const sameScope = retainedSources.owner === retentionOwner && retainedSources.regionId === regionId;
  const operations = useMemo(() => sameScope
    ? retainActivityRows(retainedSources.operations, nextOperations, (row) => row.action.id, actionsStatus === "ready" && !actionsFailed)
    : nextOperations, [sameScope, retainedSources.operations, nextOperations, actionsStatus, actionsFailed]);
  const orders = useMemo(() => sameScope
    ? retainActivityRows(retainedSources.orders, nextOrders, (row) => row.id, ordersStatus === "ready" && !ordersFailed)
    : nextOrders, [sameScope, retainedSources.orders, nextOrders, ordersStatus, ordersFailed]);
  if (!sameScope || operations.length !== retainedSources.operations.length || operations.some((row, index) => row !== retainedSources.operations[index]) ||
    orders.length !== retainedSources.orders.length || orders.some((row, index) => row !== retainedSources.orders[index])) {
    setRetainedSources({ owner: retentionOwner, regionId, operations, orders });
  }
  const [revealed, setRevealed] = useState(false);
  const [selection, setSelection] = useState<{ key: string; last: ActivityLedgerItem; opener: HTMLElement | null } | null>(() => initialDetailItem
    ? { key: `${initialDetailItem.family}:${initialDetailItem.id}`, last: initialDetailItem, opener: null } : null);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailItem !== null);
  const [immediateClose, setImmediateClose] = useState(false);
  const [detailsInvalidated, setDetailsInvalidated] = useState(false);
  if (initialDetailItem && !selection && !detailsOpen && !detailsInvalidated && activity.status === "ready") {
    setSelection({ key: `${initialDetailItem.family}:${initialDetailItem.id}`, last: initialDetailItem, opener: null });
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
  const onDetailsSelectionChangeRef = useRef(onDetailsSelectionChange);
  useEffect(() => {
    onDetailsChangeRef.current = onDetailsChange;
    onDetailsSelectionChangeRef.current = onDetailsSelectionChange;
  }, [onDetailsChange, onDetailsSelectionChange]);
  useEffect(() => {
    if (!detailsInvalidated) return;
    onDetailsChangeRef.current?.(false);
    onDetailsSelectionChangeRef.current?.(null);
  }, [detailsInvalidated]);
  const openDetail = useCallback((item: ActivityLedgerItem, opener: HTMLElement) => {
    setDetailsInvalidated(false);
    setPendingReturn(false);
    setImmediateClose(false);
    detailOpenerRef.current = opener;
    onDetailsChangeRef.current?.(true);
    onDetailsSelectionChange?.(item);
    setSelection({ key: `${item.family}:${item.id}`, last: item, opener });
    setDetailsOpen(true);
  }, [onDetailsSelectionChange]);
  const [detailsStatus, setDetailsStatus] = useState(activity.status);
  if (detailsStatus !== activity.status) {
    setDetailsStatus(activity.status);
    if (activity.status !== "ready") {
      if (detailsStatus === "ready") setDetailsInvalidated(true);
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
  const [eligibility, setEligibility] = useState({ owner: retentionOwner, regionId, ids: new Set<string>() });
  const presentedIds = eligibility.owner === retentionOwner && eligibility.regionId === regionId ? eligibility.ids : undefined;
  const feed = useMemo(() => mergeActivityFeed({ transfers, operations, orders, cards, loadedThrough, presentedIds }), [transfers, operations, orders, cards, loadedThrough, presentedIds]);
  if (!presentedIds || feed.some((row) => !presentedIds.has(`${row.kind}:${row.id}`))) {
    setEligibility({ owner: retentionOwner, regionId, ids: new Set([...(presentedIds ?? []), ...feed.map((row) => `${row.kind}:${row.id}`)]) });
  }
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const deadline = orders.reduce((earliest, order) => {
      if (order.kind !== "funding") return earliest;
      const candidate = order.status === "ambiguous" && order.stage === "unconfirmed" && order.clearableAt !== null
        ? Date.parse(order.clearableAt)
        : order.stage === "awaiting-payment" && order.expiresAt !== null
          ? Date.parse(order.expiresAt)
          : Number.NaN;
      return Number.isFinite(candidate) && candidate > now ? Math.min(earliest, candidate) : earliest;
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
    setSelection({ ...selection, last: selectedItem });
  }
  const exhausted = activity.status !== "ready" || activity.page.nextCursor === null && activity.page.onchainStatus !== "unavailable";
  const plain = density === "feed";
  const onchainUnavailable = activity.status === "ready" && activity.page.onchainStatus === "unavailable";
  const latestUnavailable = activity.status === "ready" && activity.latestUnavailable === true;
  const sourcesPending = activity.status === "loading" || actionsStatus === "loading" || ordersStatus === "loading";
  if (!revealed && !sourcesPending) setRevealed(true);
  const retryFailedSources = () => {
    if (activity.status === "error" || activity.failed || onchainUnavailable || latestUnavailable ||
      activity.status === "ready" && activity.page.cards?.status === "unavailable") activity.retry();
    if (actionsStatus === "error") retryActions?.();
    if (ordersStatus === "error") retryOrders?.();
    if (activity.status === "ready" && activity.loadMoreError) activity.retryLoadMore();
  };

  const historyUnknown = activity.status === "error" || activity.failed || onchainUnavailable || latestUnavailable ||
    activity.status === "ready" && activity.page.cards?.status === "unavailable" || actionsStatus === "error" || ordersStatus === "error";
  const sources = activitySourcesAttribute({ transfers: hasRows ? "ready" : transfersReadiness(activity), actions: sourceReadiness(actionsStatus, hasRows), orders: sourceReadiness(ordersStatus, hasRows) });

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
        <ShimmerRows count={plain ? 3 : 4} variant={quietLoading ? "reserved" : "rows"} />
        <span className="sr-only">Loading recent activity…</span>
      </ActivitySurface>
    );
  }

  if (historyUnknown && !hasRows) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} sources={sources} sectionRef={sectionRef}>
        <LoadErrorCard texture="cant-load" role="alert" title="Activity is temporarily unavailable."
          description={activity.status === "error" ? activity.error.message || activity.error.code || undefined : undefined}
          onRetry={retryFailedSources} />
      </ActivitySurface>
    );
  }

  const footer = activity.status === "ready" && !onchainUnavailable ? (
    activity.page.nextCursor === null ? hasRows && !historyUnknown ? (
      <p className="text-center text-xs text-muted-foreground" role="status">End of activity</p>
    ) : null : (
      <ActivityContinuation activity={activity} />
    )
  ) : null;
  return (
    <>
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} busy={sourcesPending} rows={hasRows} sources={sources} sectionRef={sectionRef}>
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
        opener={selection?.opener ?? null}
        immediate={immediateClose}
        item={selectedItem}
        canOpenAsset={canOpenAsset}
        canAct={(kind) => (kind === "unlock-card" || kind === "add-money") && Boolean(onCardAction) && (canCardAct?.(kind) ?? true)}
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
          if (item.family === "card" && (kind === "unlock-card" || kind === "add-money")) {
            if (canCardAct?.(kind) === false) return;
            onCardAction?.(kind, () => {
              setPendingReturn(false);
              setDetailsOpen(false);
              onDetailsChange?.(false);
              onDetailsSelectionChange?.(null);
            });
            return;
          }
          const source = pairs.find((pair) => `${pair.item.family}:${pair.item.id}` === `${item.family}:${item.id}`)?.source;
          if (source?.kind === "order" && (item.family === "funding-order" || item.family === "cash-out-order")) {
            onOrderAction?.(source.order, kind);
          } else if (kind === "cancel-cash-out" && item.family === "home-action" &&
            source?.kind === "action" && source.operation.action.kind === "cash-out") onCancelCashout?.(source.operation);
        }}
        actionBusy={cancelBusy}
        actionBusyKind={cancelActionKind}
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
}: {
  activity: UseActivityResult;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const setSentinelVisible = activity.setSentinelVisible;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    let observer: IntersectionObserver | null = null;
    let resizeFrame: number | null = null;
    const observe = () => {
      observer?.disconnect();
      const next = new IntersectionObserver(
        (entries) => {
          if (observer !== next) return;
          const entry = entries[entries.length - 1];
          if (entry) setSentinelVisible(entry.isIntersecting);
        },
        { rootMargin: `0px 0px ${window.innerHeight * 1.5}px 0px` },
      );
      observer = next;
      next.observe(sentinel);
    };
    const resize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        observe();
      });
    };
    observe();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      observer = null;
      setSentinelVisible(false);
    };
  }, [setSentinelVisible]);

  return (
    <div>
      <p className="sr-only" role="status">
        {activity.continuing ? "Loading older activity" : ""}
      </p>
      <ActivityLoader loading={!activity.loadMoreError && (activity.continuing || activity.loadingMore)} />
      <div ref={sentinelRef} className="h-px w-full" data-activity-sentinel="" aria-hidden="true" />
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
