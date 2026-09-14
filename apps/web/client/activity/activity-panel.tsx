"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { MoneyTicker } from "@/components/money-ticker";
import { ActivityRow } from "@/components/finance-rows";
import { TransactionDetailsModal } from "@/components/transaction-details";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
} from "./activity-presenter";
import { useActivity } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import {
  ACTIVITY_TEASER_LIMIT,
  type ActivityDirection,
  type ActivityPanelProps,
  type ActivityTransfer,
} from "./types";

export function ActivityPanel({
  session,
  fetchActivity,
  regionId = "GLOBAL",
  onTransactionHashesChange,
  leading,
  suppressEmpty = false,
  density = "page",
  header,
}: ActivityPanelProps) {
  const activity = useActivity(session, fetchActivity);
  const [selectedTransfer, setSelectedTransfer] = useState<ActivityTransfer | null>(null);
  const [detailsStatus, setDetailsStatus] = useState(activity.status);
  if (detailsStatus !== activity.status) {
    setDetailsStatus(activity.status);
    if (activity.status !== "ready") setSelectedTransfer(null);
  }
  const transactionHashKey = activity.status === "ready"
    ? [...new Set(activity.page.transfers.map((transfer) => transfer.transactionHash.toLowerCase()))].join("\u0000")
    : "";

  useEffect(() => {
    onTransactionHashesChange?.(transactionHashKey ? transactionHashKey.split("\u0000") : []);
  }, [onTransactionHashesChange, transactionHashKey]);

  const heading = header === undefined ? <DefaultActivityHeader /> : header;
  const labelledBy = header === null ? undefined : "activity-title";
  const labelled = header === null ? "Activity" : undefined;
  const details = selectedTransfer
    ? presentActivityTransferDetails(selectedTransfer, { regionId })
    : null;
  const detailsTitleId = "activity-transfer-details-title";

  if (activity.status === "unavailable") {
    return (
      <ActivitySurface heading={heading} leading={leading} labelledBy={labelledBy} label={labelled}>
        {suppressEmpty ? null : <ActivityEmpty />}
      </ActivitySurface>
    );
  }

  if (activity.status === "loading") {
    return (
      <ActivitySurface heading={heading} leading={leading} labelledBy={labelledBy} label={labelled} busy>
        <ShimmerRows count={density === "teaser" ? 2 : 4} />
        <span className="sr-only">Loading recent activity…</span>
      </ActivitySurface>
    );
  }

  if (activity.status === "error") {
    return (
      <ActivitySurface heading={heading} leading={leading} labelledBy={labelledBy} label={labelled}>
        <Alert variant="destructive" role="alert">
          <AlertTitle>Activity is temporarily unavailable.</AlertTitle>
          {activity.error.message || activity.error.code ? (
            <AlertDescription>{activity.error.message || activity.error.code}</AlertDescription>
          ) : null}
          <AlertAction>
            <Button variant="secondary" onClick={activity.retry}>Try again</Button>
          </AlertAction>
        </Alert>
      </ActivitySurface>
    );
  }

  const { page } = activity;
  const visibleTransfers = density === "teaser"
    ? page.transfers.slice(0, ACTIVITY_TEASER_LIMIT)
    : page.transfers;
  const isEmpty = visibleTransfers.length === 0;
  return (
    <ActivitySurface heading={heading} leading={null} labelledBy={labelledBy} label={labelled}>
      {isEmpty && !suppressEmpty && !leading ? <ActivityEmpty /> : null}
      <ItemGroup className="gap-1">
        {leading}
        {isEmpty ? null : (
          <ol className="list-none p-0 space-y-1">
            {visibleTransfers.map((transfer) => (
              <TransferActivityRow
                key={transfer.id}
                transfer={transfer}
                regionId={regionId}
                onActivate={() => setSelectedTransfer(transfer)}
              />
            ))}
          </ol>
        )}
      </ItemGroup>

      {density === "page" ? (
        <ActivityPagination
          nextCursor={page.nextCursor}
          hasTransfers={!isEmpty}
          loading={activity.loadingMore}
          failed={activity.loadMoreError}
          autoLoadPaused={activity.autoLoadPaused}
          loadMore={activity.loadMore}
          continueManually={activity.retryLoadMore}
        />
      ) : null}

      <TransactionDetailsModal
        open={selectedTransfer !== null}
        titleId={detailsTitleId}
        details={details}
        onClose={() => setSelectedTransfer(null)}
      />
    </ActivitySurface>
  );
}

function ActivitySurface({
  heading,
  leading,
  labelledBy,
  label,
  busy = false,
  children,
}: {
  heading: ReactNode;
  leading: ReactNode;
  labelledBy?: string;
  label?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined}>
      <Card>
        {heading ? <CardHeader>{heading}</CardHeader> : null}
        <CardContent className="space-y-3 px-2">
          {leading}
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

function ActivityPagination({
  nextCursor,
  hasTransfers,
  loading,
  failed,
  autoLoadPaused,
  loadMore,
  continueManually,
}: {
  nextCursor: string | null;
  hasTransfers: boolean;
  loading: boolean;
  failed: boolean;
  autoLoadPaused: boolean;
  loadMore: () => void;
  continueManually: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || loading || failed || autoLoadPaused || typeof IntersectionObserver === "undefined") return;
    const closestRoot = sentinel.closest(".app-main-authenticated");
    const root = closestRoot instanceof HTMLElement ? closestRoot : null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoLoadPaused, failed, loadMore, loading, nextCursor]);

  if (!nextCursor) {
    return hasTransfers ? (
      <p className="text-center text-xs text-muted-foreground" role="status">End of activity</p>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {loading ? (
        <div role="status" aria-live="polite">
          <ShimmerRows count={1} />
          <span className="sr-only">Loading more activity…</span>
        </div>
      ) : null}
      {failed ? (
        <p className="text-xs text-destructive" role="alert">
          More activity could not be loaded. Your current results are unchanged.
        </p>
      ) : autoLoadPaused ? (
        <p className="text-xs text-muted-foreground" role="status">
          No additional activity was found on that page. Continue to check older activity.
        </p>
      ) : null}
      {loading ? null : (
        <Button
          className="h-11 w-full"
          variant="secondary"
          onClick={failed || autoLoadPaused ? continueManually : loadMore}
        >
          {failed ? "Retry more activity" : autoLoadPaused ? "Continue loading activity" : "Load more activity"}
        </Button>
      )}
      <div key={nextCursor} ref={sentinelRef} className="h-px w-full" data-activity-sentinel="" aria-hidden="true" />
    </div>
  );
}

function ActivityEmpty() {
  return (
    <Empty className="items-start justify-start p-0 text-left">
      <EmptyHeader className="items-start">
        <EmptyTitle>No activity yet</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function DefaultActivityHeader() {
  return <h2 id="activity-title" className="text-lg font-semibold">Activity</h2>;
}

function TransferActivityRow({
  transfer,
  regionId,
  onActivate,
}: {
  transfer: ActivityTransfer;
  regionId: NonNullable<ActivityPanelProps["regionId"]>;
  onActivate: () => void;
}) {
  const model = presentActivityTransferRow(transfer, { regionId });
  return (
    <ActivityRow
      icon={iconForDirection(transfer.direction)}
      iconTone={model.iconTone}
      label={model.directionLabel}
      context={<time dateTime={model.dateTime} aria-label={model.fullDate}>{model.shortDate}</time>}
      contextTitle={model.fullDate}
      value={<MoneyTicker value={model.value} />}
      onActivate={onActivate}
      activateLabel={`View ${model.directionLabel.toLowerCase()} ${transfer.tokenSymbol ?? "unknown token"} transaction details`}
    />
  );
}

function iconForDirection(direction: ActivityDirection): string {
  if (direction === "incoming") return "↓";
  if (direction === "outgoing") return "↑";
  return "↔";
}
