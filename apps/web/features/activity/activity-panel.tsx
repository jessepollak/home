"use client";

import { useEffect, useState } from "react";
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
  const timeZone = runtimeTimeZone();
  const details = selectedTransfer
    ? presentActivityTransferDetails(
        selectedTransfer,
        assetsById.get(selectedTransfer.assetId),
        { timeZone },
      )
    : null;
  const detailsTitleId = "activity-transfer-details-title";

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
            <TransferActivityRow
              key={transfer.id}
              transfer={transfer}
              timeZone={timeZone}
              onActivate={() => setSelectedTransfer(transfer)}
            />
          ))}
        </ol>
      )}

      {density === "page" && activity.loadMoreError ? (
        <p className={styles.loadMoreError} role="alert">
          More activity could not be loaded. Your current results are unchanged.
        </p>
      ) : null}
      {density === "page" && page.nextCursor ? (
        <button
          className={styles.loadMoreButton}
          type="button"
          onClick={activity.loadMore}
          disabled={activity.loadingMore}
        >
          {activity.loadingMore ? "Loading…" : activity.loadMoreError ? "Retry more" : "Load more"}
        </button>
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

function DefaultActivityHeader() {
  return (
    <div className={styles.header}>
      <h2 id="activity-title">Activity</h2>
    </div>
  );
}

function TransferActivityRow({
  transfer,
  timeZone,
  onActivate,
}: {
  transfer: ActivityTransfer;
  timeZone: string;
  onActivate: () => void;
}) {
  const asset = assetsById.get(transfer.assetId)!;
  const model = presentActivityTransferRow(transfer, asset, { timeZone });
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
      value={model.value}
      onActivate={onActivate}
      activateLabel={`View ${model.directionLabel.toLowerCase()} ${asset.symbol} transaction details`}
    />
  );
}

function iconForDirection(direction: ActivityDirection): string {
  if (direction === "incoming") return "↓";
  if (direction === "outgoing") return "↑";
  return "↔";
}

function runtimeTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
