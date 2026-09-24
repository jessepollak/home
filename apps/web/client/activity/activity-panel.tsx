"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ActivityLoader } from "@/components/activity-loader";
import { CurrencyMark } from "@/components/currency-mark";
import { MoneyTicker } from "@/components/money-ticker";
import { ActivityRow } from "@/components/finance-rows";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { OperationActivityRow } from "@/client/actions/operation-row";
import { presentOperationDetails } from "@/client/actions/operation-details";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { RegionId } from "@/config/regions";
import { assetKeyForErc20 } from "@/config/portfolio-assets";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
} from "./activity-presenter";
import { mergeActivityFeed } from "./activity-feed";
import { type UseActivityResult } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ActivityPanelDensity, ActivityTransfer } from "./types";

const TransactionDetailsSheet = deferSheet(() => import("@/components/transaction-details").then((module) => module.TransactionDetailsModal));

export function ActivityPanelView({
  activity,
  operations = [],
  actionsStatus = "ready",
  regionId = "GLOBAL",
  density = "page",
  header,
  emptyAction,
  retryActions,
}: {
  activity: UseActivityResult;
  operations?: readonly RecentMoneyActionOperation[];
  actionsStatus?: "loading" | "ready" | "error";
  regionId?: RegionId;
  density?: ActivityPanelDensity;
  header?: ReactNode | null;
  emptyAction?: ReactNode;
  retryActions?: () => void;
}) {
  const [selectedTransfer, setSelectedTransfer] = useState<ActivityTransfer | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<RecentMoneyActionOperation | null>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const rememberDetailOpener = () => {
    const active = document.activeElement;
    detailOpenerRef.current = active instanceof HTMLElement ? active : null;
  };
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
  const hasRows = items.length > 0;
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
    <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain}>
      {inlineStatus && activity.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            Onchain transfers are unavailable. Recorded Home actions are still shown.
          </p>
          <Button variant="secondary" onClick={activity.retry}>Try again</Button>
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
        <ol className="list-none p-0" onPointerDown={() => void TransactionDetailsSheet.preload()}>
          {items.map((item) => item.kind === "transfer" ? (
            <TransferActivityRow
              key={`transfer:${item.id}`}
              transfer={item.transfer}
              regionId={regionId}
              onActivate={() => {
                rememberDetailOpener();
                setSelectedOperation(null);
                setSelectedTransfer(item.transfer);
              }}
            />
          ) : (
            <OperationActivityRow
              key={`action:${item.id}`}
              operation={item.operation}
              onActivate={() => {
                rememberDetailOpener();
                setSelectedTransfer(null);
                setSelectedOperation(item.operation);
              }}
            />
          ))}
        </ol>
      )}

      {activity.status === "ready" ? (
        activity.page.nextCursor === null ? (
          hasRows ? (
            <p className="text-center text-xs text-muted-foreground" role="status">End of activity</p>
          ) : null
        ) : (
          <ActivityContinuation
            activity={activity}
            inlineStatus={inlineStatus}
            feedStatus={plain && !historyUnknown}
          />
        )
      ) : null}

      <TransactionDetailsSheet
        open={selectedTransfer !== null || selectedOperation !== null}
        titleId="activity-transaction-details-title"
        details={details}
        onClose={() => {
          setSelectedTransfer(null);
          setSelectedOperation(null);
          const opener = detailOpenerRef.current;
          if (opener?.isConnected) opener.focus({ preventScroll: true });
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
  plain = false,
  children,
}: {
  heading: ReactNode;
  labelledBy?: string;
  label?: string;
  busy?: boolean;
  plain?: boolean;
  children: ReactNode;
}) {
  if (plain) {
    return (
      <section
        className="space-y-3"
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-busy={busy || undefined}
        data-activity-feed=""
      >
        {heading ? <div className="px-4">{heading}</div> : null}
        <div className="space-y-3 px-1">{children}</div>
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
      {activity.loadingMore ? <ActivityLoader /> : null}
      {activity.loadMoreError ? inlineStatus ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-destructive" role="alert">
            More activity could not be loaded. Your current results are unchanged.
          </p>
          <Button variant="secondary" onClick={activity.retryLoadMore}>Retry</Button>
        </div>
      ) : feedStatus ? (
        <ActivityUnavailable message="More activity unavailable" onReload={activity.retryLoadMore} />
      ) : null : null}
      <div ref={sentinelRef} className="h-px w-full" data-activity-sentinel="" aria-hidden="true" />
    </div>
  );
}

function ActivityUnavailable({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div className="flex items-center justify-center gap-1" data-activity-unavailable="">
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 md:pointer-fine:size-8"
        aria-label="Reload activity"
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

function TransferActivityRow({
  transfer,
  regionId,
  onActivate,
}: {
  transfer: ActivityTransfer;
  regionId: RegionId;
  onActivate: () => void;
}) {
  const model = presentActivityTransferRow(transfer, { regionId });
  return (
    <ActivityRow
      icon={<CurrencyMark assetKey={assetKeyForErc20(transfer.tokenAddress)} symbol={transfer.tokenSymbol ?? "?"} size="sm" />}
      iconTone="mark"
      label={model.directionLabel}
      context={<time dateTime={model.dateTime} aria-label={model.fullDate}>{model.shortDate}</time>}
      contextTitle={model.fullDate}
      value={<MoneyTicker value={model.value} />}
      valueTone={model.valueTone}
      valueContext={model.valueContext ?? undefined}
      valueContextTitle={model.valueContext ?? undefined}
      onActivate={onActivate}
      activateLabel={`View ${model.directionLabel.toLowerCase()} ${transfer.tokenSymbol ?? "unknown token"} transaction details`}
    />
  );
}
