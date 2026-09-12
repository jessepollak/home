"use client";

import { Button, EmptyState, Heading, StatusMessage, Text } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import { useEffect, useRef, useState } from "react";
import { ActivityRow } from "@/components/finance-rows";
import { TransactionDetailsModal } from "@/components/transaction-details";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
} from "./activity-presenter";
import styles from "./activity.module.css";
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
        className={`${styles.panel} surface-primary`}
        aria-labelledby={labelledBy}
        aria-label={labelled}
      >
        {heading}
        {leading}
        {suppressEmpty ? null : <EmptyState className={styles.empty} title="No activity yet" />}
      </section>
    );
  }

  if (activity.status === "loading") {
    return (
      <section
        className={`${styles.panel} surface-primary`}
        aria-labelledby={labelledBy}
        aria-label={labelled}
        aria-busy="true"
      >
        {heading}
        {leading}
        <StatusMessage className={styles.loading}>
          <span className={styles.spinner} aria-hidden="true" />
          Loading recent activity…
        </StatusMessage>
      </section>
    );
  }

  if (activity.status === "error") {
    return (
      <section
        className={`${styles.panel} surface-primary`}
        aria-labelledby={labelledBy}
        aria-label={labelled}
      >
        {heading}
        {leading}
        <StatusMessage
          className={styles.error}
          tone="error"
          role="alert"
          title="Activity is temporarily unavailable."
          action={<Button variant="secondary" onClick={activity.retry}>Try again</Button>}
        >
          {activity.error.message || activity.error.code || undefined}
        </StatusMessage>
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
      className={`${styles.panel} surface-primary`}
      aria-labelledby={labelledBy}
      aria-label={labelled}
    >
      {heading}
      {leading}
      {isEmpty ? (
        suppressEmpty ? null : <EmptyState className={styles.empty} title="No activity yet" />
      ) : (
        <ol className={styles.list}>
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
      <Text textStyle="metadata" className={styles.end} role="status">
        End of activity
      </Text>
    ) : null;
  }

  return (
    <div className={styles.pagination}>
      {loading ? (
        <StatusMessage className={styles.loadingMore} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Loading more activity…
        </StatusMessage>
      ) : null}
      {failed ? (
        <Text textStyle="metadata" className={styles.loadMoreError} role="alert">
          More activity could not be loaded. Your current results are unchanged.
        </Text>
      ) : autoLoadPaused ? (
        <Text textStyle="metadata" className={styles.loadMoreNotice} role="status">
          No additional activity was found on that page. Continue to check older activity.
        </Text>
      ) : null}
      {loading ? null : (
        <Button
          className={styles.loadMoreButton}
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
        className={styles.sentinel}
        data-activity-sentinel=""
        aria-hidden="true"
      />
    </div>
  );
}

function DefaultActivityHeader() {
  return (
    <div className={styles.header}>
      <Heading id="activity-title" level={2} textStyle="metadata">Activity</Heading>
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
