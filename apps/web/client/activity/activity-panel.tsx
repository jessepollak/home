"use client";

import { useEffect, useRef } from "react";
import { ActivityRow } from "@/components/finance-rows";
import { formatPresentationTokenAmount } from "@/shared/formatting";
import styles from "./activity.module.css";
import { useActivity } from "./use-activity";
import {
  ACTIVITY_TEASER_LIMIT,
  activityAssets,
  type ActivityDirection,
  type ActivityPanelProps,
  type ActivityTransfer,
} from "./types";

const assetsById = new Map(activityAssets.map((asset) => [asset.id, asset]));

export function ActivityPanel({
  session,
  fetchActivity,
  refreshTrigger,
  onTransactionHashesChange,
  leading,
  suppressEmpty = false,
  density = "page",
  header,
}: ActivityPanelProps) {
  const activity = useActivity(session, fetchActivity, refreshTrigger);
  const transactionHashKey = activity.status === "ready"
    ? [...new Set(activity.page.transfers.map((transfer) => transfer.transactionHash.toLowerCase()))].join("\u0000")
    : "";

  useEffect(() => {
    onTransactionHashesChange?.(transactionHashKey ? transactionHashKey.split("\u0000") : []);
  }, [onTransactionHashesChange, transactionHashKey]);

  const heading = header === undefined ? <DefaultActivityHeader /> : header;
  const labelledBy = header === null ? undefined : "activity-title";
  const labelled = header === null ? "Activity" : undefined;

  if (activity.status === "unavailable") {
    return (
      <section
        className={styles.panel}
        aria-labelledby={labelledBy}
        aria-label={labelled}
      >
        {heading}
        {leading}
        {suppressEmpty ? null : <p className={styles.empty}>No activity yet</p>}
      </section>
    );
  }

  if (activity.status === "loading") {
    return (
      <section
        className={styles.panel}
        aria-labelledby={labelledBy}
        aria-label={labelled}
        aria-busy="true"
      >
        {heading}
        {leading}
        <div className={styles.loading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          Loading recent activity…
        </div>
      </section>
    );
  }

  if (activity.status === "error") {
    return (
      <section
        className={styles.panel}
        aria-labelledby={labelledBy}
        aria-label={labelled}
      >
        {heading}
        {leading}
        <div className={styles.error} role="alert">
          <strong>Activity is temporarily unavailable.</strong>
          {activity.error.message ? (
            <span>{activity.error.message}</span>
          ) : activity.error.code ? (
            <span>{activity.error.code}</span>
          ) : null}
          <button type="button" onClick={activity.retry}>
            Try again
          </button>
        </div>
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
      className={styles.panel}
      aria-labelledby={labelledBy}
      aria-label={labelled}
    >
      {heading}
      {leading}
      {isEmpty ? (
        suppressEmpty ? null : <p className={styles.empty}>No activity yet</p>
      ) : (
        <ol className={styles.list}>
          {visibleTransfers.map((transfer) => (
            <TransferActivityRow key={transfer.id} transfer={transfer} />
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
      <p className={styles.end} role="status">
        End of activity
      </p>
    ) : null;
  }

  return (
    <div className={styles.pagination}>
      {loading ? (
        <div className={styles.loadingMore} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Loading more activity…
        </div>
      ) : null}
      {failed ? (
        <p className={styles.loadMoreError} role="alert">
          More activity could not be loaded. Your current results are unchanged.
        </p>
      ) : autoLoadPaused ? (
        <p className={styles.loadMoreNotice} role="status">
          No additional activity was found on that page. Continue to check older activity.
        </p>
      ) : null}
      <button
        className={styles.loadMoreButton}
        type="button"
        onClick={failed || autoLoadPaused ? continueManually : loadMore}
        disabled={loading}
      >
        {loading
          ? "Loading…"
          : failed
            ? "Retry more activity"
            : autoLoadPaused
              ? "Continue loading activity"
              : "Load more activity"}
      </button>
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
      <h2 id="activity-title">Activity</h2>
    </div>
  );
}

function TransferActivityRow({ transfer }: { transfer: ActivityTransfer }) {
  const asset = assetsById.get(transfer.assetId)!;
  const directionLabel = labelForDirection(transfer.direction);
  const sign =
    transfer.direction === "incoming"
      ? "+"
      : transfer.direction === "outgoing"
        ? "−"
        : "";
  const fullDate = formatActivityDate(transfer.blockTimestamp);

  return (
    <ActivityRow
      icon={
        transfer.direction === "incoming"
          ? "↓"
          : transfer.direction === "outgoing"
            ? "↑"
            : "↔"
      }
      iconTone={transfer.direction}
      label={directionLabel}
      context={
        <time dateTime={transfer.blockTimestamp} aria-label={fullDate}>
          {formatActivityDateShort(transfer.blockTimestamp)}
        </time>
      }
      contextTitle={fullDate}
      value={`${sign}${formatPresentationTokenAmount(
        transfer.amountBaseUnits,
        asset.decimals,
        asset.symbol,
        { cashCurrency: asset.symbol === "USDC" ? "USD" : null },
      )}`}
      explorer={{
        href: `https://basescan.org/tx/${transfer.transactionHash}`,
        label: `View ${directionLabel.toLowerCase()} ${asset.symbol} transfer on BaseScan`,
        title: "View on BaseScan",
      }}
    />
  );
}

function labelForDirection(direction: ActivityDirection): string {
  if (direction === "incoming") return "Received";
  if (direction === "outgoing") return "Sent";
  return "Self transfer";
}

function formatActivityDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatActivityDateShort(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
