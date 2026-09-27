"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadErrorCard, LoadRetryButton } from "@/components/load-error";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ActivityLoader } from "@/components/activity-loader";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { ActivityLedger, uniqueActivityLedgerItems, type ActivityLedgerItem } from "./activity-ledger";
import type { ActivityListHandle } from "./virtual-activity-list";
import { presentActivityLedgerItems } from "./activity-ledger-items";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { RegionId } from "@/config/regions";
import { mergeActivityFeed } from "./activity-feed";
import { type UseActivityResult } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ActivityPanelDensity, ActivityTransfer } from "./types";

const ActivityLedgerSheet = deferSheet(() => import("./activity-ledger-sheet").then((module) => module.ActivityLedgerDetailSheet));
const EMPTY_TRANSFERS: readonly ActivityTransfer[] = [];
const EMPTY_OPERATIONS: readonly RecentMoneyActionOperation[] = [];

export function ActivityPanelView({
  activity,
  operations = EMPTY_OPERATIONS,
  actionsStatus = "ready",
  regionId = "GLOBAL",
  density = "page",
  header,
  emptyAction,
  retryActions,
  onCancelCashout,
  cancelBusy = false,
  cancelError = null,
  onDetailsChange,
  onDetailsOpenChange,
  canOpenAsset,
  onOpenAsset,
  restoreDetailsRequest = 0,
  suspendDetailsRequest = 0,
}: {
  activity: UseActivityResult;
  operations?: readonly RecentMoneyActionOperation[];
  actionsStatus?: "loading" | "ready" | "error";
  regionId?: RegionId;
  density?: ActivityPanelDensity;
  header?: ReactNode | null;
  emptyAction?: ReactNode;
  retryActions?: () => void;
  onCancelCashout?: (operation: RecentMoneyActionOperation) => void;
  cancelBusy?: boolean;
  cancelError?: string | null;
  onDetailsChange?: (open: boolean) => void;
  onDetailsOpenChange?: (open: boolean) => void;
  canOpenAsset?: (assetKey: string) => boolean;
  onOpenAsset?: (assetKey: string) => boolean;
  restoreDetailsRequest?: number;
  suspendDetailsRequest?: number;
}) {
  const [selection, setSelection] = useState<{ key: string; last: ActivityLedgerItem } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [immediateClose, setImmediateClose] = useState(false);
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
  const openDetail = useCallback((item: ActivityLedgerItem, opener: HTMLElement) => {
    setPendingReturn(false);
    setImmediateClose(false);
    detailOpenerRef.current = opener;
    onDetailsChange?.(true);
    setSelection({ key: `${item.family}:${item.id}`, last: item });
    setDetailsOpen(true);
  }, [onDetailsChange]);
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
  const loadedThrough = activity.status === "ready" && activity.page.nextCursor !== null
    ? transfers.length > 0
      ? transfers.reduce((oldest, transfer) =>
        Date.parse(transfer.blockTimestamp) < Date.parse(oldest) ? transfer.blockTimestamp : oldest,
      transfers[0]!.blockTimestamp)
      : activity.page.window.to
    : null;
  const feed = useMemo(() => mergeActivityFeed({ transfers, operations, loadedThrough }), [transfers, operations, loadedThrough]);
  const pairs = useMemo(() => uniqueActivityLedgerItems(
    presentActivityLedgerItems(feed, { regionId }).map((item, index) => ({ item, source: feed[index]! })),
    (pair) => pair.item,
  ), [feed, regionId]);
  const items = useMemo(() => pairs.map((pair) => pair.item), [pairs]);
  const hasRows = items.length > 0;
  const selectedItem = selection
    ? items.find((item) => `${item.family}:${item.id}` === selection.key) ?? selection.last
    : null;
  if (selection && selectedItem && selectedItem !== selection.last) {
    setSelection({ key: selection.key, last: selectedItem });
  }
  const exhausted = activity.status !== "ready" || activity.page.nextCursor === null;
  const plain = density === "feed";
  const sourcesPending = activity.status === "loading" || actionsStatus === "loading";
  const retryFailedSources = () => {
    if (activity.status === "error") activity.retry();
    if (actionsStatus === "error") retryActions?.();
    if (activity.status === "ready" && activity.loadMoreError) activity.retryLoadMore();
  };
  const inlineStatus = !plain;

  const historyUnknown = activity.status === "error" || actionsStatus === "error";

  if (activity.status === "unavailable" && !hasRows && actionsStatus !== "error") {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} sectionRef={sectionRef}>
        <ActivityEmpty plain={plain} action={emptyAction} />
      </ActivitySurface>
    );
  }

  if (sourcesPending) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} busy sectionRef={sectionRef}>
        <ShimmerRows count={plain ? 3 : 4} />
        <span className="sr-only">Loading recent activity…</span>
      </ActivitySurface>
    );
  }

  if (historyUnknown && !hasRows && plain) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} sectionRef={sectionRef}>
        <ActivityUnavailable message="Activity unavailable" onReload={retryFailedSources} />
      </ActivitySurface>
    );
  }

  if (activity.status === "error" && !hasRows) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} sectionRef={sectionRef}>
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

  const footer = activity.status === "ready" ? (
    activity.page.nextCursor === null ? hasRows ? (
      <p className="text-center text-xs text-muted-foreground" role="status">End of activity</p>
    ) : null : (
      <ActivityContinuation activity={activity} inlineStatus={inlineStatus} feedStatus={plain && !historyUnknown} />
    )
  ) : null;
  return (
    <>
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} rows={hasRows} sectionRef={sectionRef}>
        {inlineStatus && activity.status === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-muted-foreground">
              Onchain transfers are unavailable. Recorded Home actions are still shown.
            </p>
            <LoadRetryButton onRetry={activity.retry}>Retry onchain transfers</LoadRetryButton>
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
        {plain && historyUnknown ? (
          <ActivityUnavailable message="Some activity is unavailable" onReload={retryFailedSources} />
        ) : null}
        {!hasRows ? (exhausted && !historyUnknown ? <ActivityEmpty plain={plain} action={emptyAction} /> : null) : (
          <div onPointerDown={() => void ActivityLedgerSheet.preload()}>
            <ActivityLedger
              items={items}
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
          if (kind !== "cancel-cash-out" || item.family !== "home-action") return;
          const source = pairs.find((pair) => `${pair.item.family}:${pair.item.id}` === `${item.family}:${item.id}`)?.source;
          if (source?.kind === "action" && source.operation.action.kind === "cash-out") onCancelCashout?.(source.operation);
        }}
        actionBusy={cancelBusy}
        actionError={cancelError}
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
  sectionRef,
  children,
}: {
  heading: ReactNode;
  labelledBy?: string;
  label?: string;
  busy?: boolean;
  plain?: boolean;
  rows?: boolean;
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
      <section ref={sectionRef} tabIndex={-1} aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined}>
        {heading ? <div className="mb-3">{heading}</div> : null}
        <div className="space-y-3">{children}</div>
      </section>
    );
  }
  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined}>
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
    const closestRoot = sentinel.closest("[data-app-main-authenticated]");
    const root = closestRoot instanceof HTMLElement ? closestRoot : null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setSentinelVisible(entry.isIntersecting);
      },
      { root, rootMargin: "0px 0px 240px 0px" },
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
    return (
      <Empty className="gap-3 p-4" data-activity-nux="">
        <EmptyHeader>
          <EmptyTitle>No activity yet</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>{action}</EmptyContent>
      </Empty>
    );
  }
  return (
    <Empty className="items-start justify-start text-left">
      <EmptyHeader className="items-start">
        <EmptyTitle>No activity yet</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function DefaultActivityHeader() {
  return <h2 id="activity-title" className="text-lg font-semibold">Activity</h2>;
}
