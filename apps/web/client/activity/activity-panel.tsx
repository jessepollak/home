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
import { MoneyTicker } from "@/components/money-ticker";
import { ActivityRow } from "@/components/finance-rows";
import { TransactionDetailsModal } from "@/components/transaction-details";
import { OperationActivityRow } from "@/client/actions/operation-row";
import { presentOperationDetails } from "@/client/actions/operation-details";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
} from "./activity-presenter";
import { mergeActivityFeed } from "./activity-feed";
import { useActivity, type UseActivityResult } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import {
  ACTIVITY_TEASER_LIMIT,
  type ActivityDirection,
  type ActivityPanelDensity,
  type ActivityPanelProps,
  type ActivityTransfer,
} from "./types";

export function ActivityPanel({
  session,
  fetchActivity,
  regionId = "GLOBAL",
  density = "page",
  header,
}: ActivityPanelProps) {
  const activity = useActivity(session, fetchActivity);
  const ownerKey = session?.smartAccount
    ? `${session.accountProvider}:${session.user.subject}:${session.smartAccount.address.toLowerCase()}`
    : "signed-out";
  return (
    <ActivityPanelView
      key={ownerKey}
      activity={activity}
      regionId={regionId}
      density={density}
      header={header}
    />
  );
}

export function ActivityPanelView({
  activity,
  operations = [],
  actionsStatus = "ready",
  regionId = "GLOBAL",
  density = "page",
  header,
}: {
  activity: UseActivityResult;
  operations?: readonly RecentMoneyActionOperation[];
  actionsStatus?: "loading" | "ready" | "error";
  regionId?: ActivityPanelProps["regionId"];
  density?: ActivityPanelDensity;
  header?: ReactNode | null;
}) {
  const [selectedTransfer, setSelectedTransfer] = useState<ActivityTransfer | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<RecentMoneyActionOperation | null>(null);
  const [detailsStatus, setDetailsStatus] = useState(activity.status);
  if (detailsStatus !== activity.status) {
    setDetailsStatus(activity.status);
    if (activity.status !== "ready") {
      setSelectedTransfer(null);
      setSelectedOperation(null);
    }
  }
  const heading = header === undefined ? <DefaultActivityHeader /> : header;
  const labelledBy = header === null ? undefined : "activity-title";
  const labelled = header === null ? "Activity" : undefined;
  const transfers = activity.status === "ready" ? activity.page.transfers : [];
  const items = mergeActivityFeed({ transfers, operations });
  const visibleItems = density === "teaser" ? items.slice(0, ACTIVITY_TEASER_LIMIT) : items;
  const hasRows = visibleItems.length > 0;
  // Initial load waits for both Activity sources to settle so the panel never
  // presents whichever source resolved first as the whole feed. Load-more is
  // separate (status stays "ready" while loading more) and keeps existing rows.
  const sourcesPending = activity.status === "loading" || actionsStatus === "loading";

  if (activity.status === "unavailable" && !hasRows) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled}>
        <ActivityEmpty />
      </ActivitySurface>
    );
  }

  if (sourcesPending) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} busy>
        <ShimmerRows count={density === "teaser" ? 2 : 4} />
        <span className="sr-only">Loading recent activity…</span>
      </ActivitySurface>
    );
  }

  if (activity.status === "error" && !hasRows) {
    return (
      <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled}>
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

  const details = selectedTransfer
    ? presentActivityTransferDetails(selectedTransfer, { regionId })
    : selectedOperation
      ? presentOperationDetails(selectedOperation)
      : null;
  return (
    <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled}>
      {activity.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            Onchain transfers are unavailable. Recorded Home actions are still shown.
          </p>
          <Button variant="secondary" onClick={activity.retry}>Try again</Button>
        </div>
      ) : null}
      {actionsStatus === "error" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Recorded Home actions are unavailable.{transfers.length > 0 ? " Onchain transfers are still shown." : ""}
        </p>
      ) : null}
      {!hasRows ? <ActivityEmpty /> : (
        <ol className="list-none p-0 space-y-1">
          {visibleItems.map((item) => item.kind === "transfer" ? (
            <TransferActivityRow
              key={`transfer:${item.id}`}
              transfer={item.transfer}
              regionId={regionId}
              onActivate={() => {
                setSelectedOperation(null);
                setSelectedTransfer(item.transfer);
              }}
            />
          ) : (
            <OperationActivityRow
              key={`action:${item.id}`}
              operation={item.operation}
              onActivate={() => {
                setSelectedTransfer(null);
                setSelectedOperation(item.operation);
              }}
            />
          ))}
        </ol>
      )}

      {density === "page" && activity.status === "ready" ? (
        <ActivityPagination
          nextCursor={activity.page.nextCursor}
          hasTransfers={hasRows}
          loading={activity.loadingMore}
          failed={activity.loadMoreError}
          autoLoadPaused={activity.autoLoadPaused}
          loadMore={activity.loadMore}
          continueManually={activity.retryLoadMore}
        />
      ) : null}

      <TransactionDetailsModal
        open={selectedTransfer !== null || selectedOperation !== null}
        titleId="activity-transaction-details-title"
        details={details}
        onClose={() => {
          setSelectedTransfer(null);
          setSelectedOperation(null);
        }}
      />
    </ActivitySurface>
  );
}

function ActivitySurface({
  heading,
  labelledBy,
  label,
  busy = false,
  children,
}: {
  heading: ReactNode;
  labelledBy?: string;
  label?: string;
  busy?: boolean;
  children: ReactNode;
}) {
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
