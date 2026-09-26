"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadErrorCard, LoadRetryButton } from "@/components/load-error";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ActivityLoader } from "@/components/activity-loader";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { ActivityLedger, type ActivityLedgerItem } from "./activity-ledger";
import { presentActivityLedgerItems } from "./activity-ledger-items";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { RegionId } from "@/config/regions";
import { mergeActivityFeed } from "./activity-feed";
import { type UseActivityResult } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ActivityPanelDensity, ActivityTransfer } from "./types";

const ActivityLedgerSheet = deferSheet(() => import("./activity-ledger-sheet").then((module) => module.ActivityLedgerDetailSheet));
const EMPTY_TRANSFERS: readonly ActivityTransfer[] = [];

export function ActivityPanelView({
  activity,
  operations = [],
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
  onDetailsChange?: () => void;
}) {
  const [selection, setSelection] = useState<{ key: string; last: ActivityLedgerItem } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const [detailsStatus, setDetailsStatus] = useState(activity.status);
  if (detailsStatus !== activity.status) {
    setDetailsStatus(activity.status);
    if (activity.status !== "ready") {
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
  const items = useMemo(() => presentActivityLedgerItems(feed, { regionId }), [feed, regionId]);
  const hasRows = items.length > 0;
  const selectedItem = selection
    ? items.find((item) => `${item.family}:${item.id}` === selection.key) ?? selection.last
    : null;
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
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain}>
        <ActivityEmpty plain={plain} action={emptyAction} />
      </ActivitySurface>
    );
  }

  if (sourcesPending) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} busy>
        <ShimmerRows count={plain ? 3 : 4} />
        <span className="sr-only">Loading recent activity…</span>
      </ActivitySurface>
    );
  }

  if (historyUnknown && !hasRows && plain) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain}>
        <ActivityUnavailable message="Activity unavailable" onReload={retryFailedSources} />
      </ActivitySurface>
    );
  }

  if (activity.status === "error" && !hasRows) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain}>
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
    <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain} rows={hasRows}>
      {inlineStatus && activity.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            Onchain transfers are unavailable. Recorded Home actions are still shown.
          </p>
          <LoadRetryButton onRetry={activity.retry} />
        </div>
      ) : null}
      {inlineStatus && actionsStatus === "error" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Recorded Home actions are unavailable.{transfers.length > 0 ? " Onchain transfers are still shown." : ""}
        </p>
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
            onOpen={(item, opener) => {
              detailOpenerRef.current = opener;
              onDetailsChange?.();
              setSelection({ key: `${item.family}:${item.id}`, last: item });
              setDetailsOpen(true);
            }}
          />
        </div>
      )}
      {!hasRows ? footer : null}
      <ActivityLedgerSheet
        open={detailsOpen}
        item={selectedItem}
        onDismiss={() => { setDetailsOpen(false); onDetailsChange?.(); }}
        onClosed={() => {
          setSelection(null);
          const opener = detailOpenerRef.current;
          if (opener?.isConnected) opener.focus({ preventScroll: true });
        }}
        onAction={(item, kind) => {
          if (kind !== "cancel-cash-out" || item.family !== "home-action") return;
          const match = feed.find((entry) => entry.kind === "action" && entry.id === item.id);
          if (match?.kind === "action" && match.operation.action.kind === "cash-out") onCancelCashout?.(match.operation);
        }}
        actionBusy={cancelBusy}
        actionError={cancelError}
      />
    </ActivitySurface>
  );
}

export function ActivitySurface({
  heading,
  labelledBy,
  label,
  busy = false,
  plain = false,
  rows = false,
  children,
}: {
  heading: ReactNode;
  labelledBy?: string;
  label?: string;
  busy?: boolean;
  plain?: boolean;
  rows?: boolean;
  children: ReactNode;
}) {
  if (plain) {
    return (
      <section
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
      <section aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined}>
        {heading ? <div className="mb-3">{heading}</div> : null}
        <div className="space-y-3">{children}</div>
      </section>
    );
  }
  return (
    <section aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined}>
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
