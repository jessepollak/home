"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { MoneyTicker } from "@/components/money-ticker";
import { ActivityRow } from "@/components/finance-rows";
import { TransactionDetailsModal } from "@/components/transaction-details";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
} from "./activity-presenter";
import { useActivity } from "./use-activity";
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
  const [selectedTransfer, setSelectedTransfer] =
    useState<ActivityTransfer | null>(null);
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
      <section
        className="surface-primary rounded-xl border border-border p-4 sm:p-6"
        aria-labelledby={labelledBy}
        aria-label={labelled}
      >
        {heading}
        {leading}
        {suppressEmpty ? null : <ActivityEmpty />}
      </section>
    );
  }

  if (activity.status === "loading") {
    return (
      <section
        className="surface-primary rounded-xl border border-border p-4 sm:p-6"
        aria-labelledby={labelledBy}
        aria-label={labelled}
        aria-busy="true"
      >
        {heading}
        {leading}
        <Alert role="status" className="mt-4 border-0 bg-transparent p-0 text-muted-foreground">
          <AlertDescription className="flex items-center gap-2 text-inherit">
            <ActivitySpinner />
            Loading recent activity…
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  if (activity.status === "error") {
    return (
      <section
        className="surface-primary rounded-xl border border-border p-4 sm:p-6"
        aria-labelledby={labelledBy}
        aria-label={labelled}
      >
        {heading}
        {leading}
        <Alert className="mt-4" variant="destructive" role="alert">
          <AlertTitle>Activity is temporarily unavailable.</AlertTitle>
          {activity.error.message || activity.error.code ? (
            <AlertDescription>{activity.error.message || activity.error.code}</AlertDescription>
          ) : null}
          <AlertAction>
            <Button className="w-max" variant="secondary" onClick={activity.retry}>Try again</Button>
          </AlertAction>
        </Alert>
      </section>
    );
  }

  const { page } = activity;
  const visibleTransfers =
    density === "teaser"
      ? page.transfers.slice(0, ACTIVITY_TEASER_LIMIT)
      : page.transfers;
  const isEmpty = visibleTransfers.length === 0;
  return (
    <section
      className="surface-primary rounded-xl border border-border p-4 sm:p-6"
      aria-labelledby={labelledBy}
      aria-label={labelled}
    >
      {heading}
      {leading}
      {isEmpty ? (
        suppressEmpty ? null : <ActivityEmpty />
      ) : (
        <ol className="mt-4 list-none border-t border-border p-0">
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
    if (
      !sentinel ||
      !nextCursor ||
      loading ||
      failed ||
      autoLoadPaused ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const closestRoot = sentinel.closest(".app-main-authenticated");
    const root = closestRoot instanceof HTMLElement ? closestRoot : null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { root, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoLoadPaused, failed, loadMore, loading, nextCursor]);

  if (!nextCursor) {
    return hasTransfers ? (
      <p className="text-metadata mt-4 text-center text-muted-foreground" role="status">
        End of activity
      </p>
    ) : null;
  }

  return (
    <div className="mt-3">
      {loading ? (
        <Alert role="status" aria-live="polite" className="min-h-11 justify-center border-0 bg-transparent p-0 text-muted-foreground">
          <AlertDescription className="flex items-center justify-center gap-2 text-inherit">
            <ActivitySpinner />
            Loading more activity…
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <p className="text-metadata mb-2 text-destructive" role="alert">
          More activity could not be loaded. Your current results are unchanged.
        </p>
      ) : autoLoadPaused ? (
        <p className="text-metadata mb-2 text-muted-foreground" role="status">
          No additional activity was found on that page. Continue to check older activity.
        </p>
      ) : null}
      {loading ? null : (
        <Button
          className="min-h-11 w-full"
          variant="secondary"
          onClick={failed || autoLoadPaused ? continueManually : loadMore}
        >
          {failed
            ? "Retry more activity"
            : autoLoadPaused
              ? "Continue loading activity"
              : "Load more activity"}
        </Button>
      )}
      <div
        key={nextCursor}
        ref={sentinelRef}
        className="h-px w-full"
        data-activity-sentinel=""
        aria-hidden="true"
      />
    </div>
  );
}

function ActivityEmpty() {
  return (
    <Empty className="mt-4 items-start justify-start p-0 text-left">
      <EmptyHeader className="items-start">
        <EmptyTitle className="text-row-label">No activity yet</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function ActivitySpinner() {
  return (
    <span
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}

function DefaultActivityHeader() {
  return (
    <div className="flex items-start justify-between gap-4">
      <h2 id="activity-title" className="text-metadata font-semibold tracking-widest text-muted-foreground uppercase">Activity</h2>
    </div>
  );
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
      context={
        <time dateTime={model.dateTime} aria-label={model.fullDate}>
          {model.shortDate}
        </time>
      }
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
