"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadErrorCard, LoadRetryButton } from "@/components/load-error";
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
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
} from "./activity-presenter";
import { presentCashout, presentCashoutDetails, cashoutMoney } from "./cash-out-presenter";
import { mergeActivityFeed } from "./activity-feed";
import { type UseActivityResult } from "./use-activity";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ActivityPanelDensity, ActivityTransfer } from "./types";

const TransactionDetailsSheet = deferSheet(() => import("@/components/transaction-details").then((module) => module.TransactionDetailsModal));
const EMPTY_TRANSFERS: readonly ActivityTransfer[] = [];

type Selection = { operation: RecentMoneyActionOperation; withdraw?: RecentMoneyActionOperation } | null;
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
  const [selectedTransfer, setSelectedTransfer] = useState<ActivityTransfer | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const rememberDetailOpener = () => {
    const active = document.activeElement;
    detailOpenerRef.current = active instanceof HTMLElement ? active : null;
  };
  const [detailsStatus, setDetailsStatus] = useState(activity.status);
  if (detailsStatus !== activity.status) {
    setDetailsStatus(activity.status);
    if (activity.status !== "ready") {
      setDetailsOpen(false);
      setSelectedTransfer(null);
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
  const items = useMemo(() => mergeActivityFeed({ transfers, operations, loadedThrough }), [transfers, operations, loadedThrough]);
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

  const selected = selection && items.find((item) => item.kind === "action" && item.id === selection.operation.action.id);
  const operation = selected?.kind === "action" ? selected.operation : selection?.operation;
  const withdraw = selected?.kind === "action" ? selected.withdraw : selection?.withdraw;
  const cashout = operation?.action.kind === "cash-out" ? presentCashout(operation, withdraw, { regionId }) : null;
  const details = selectedTransfer
    ? presentActivityTransferDetails(selectedTransfer, { regionId })
    : operation
      ? cashout ? presentCashoutDetails(operation, withdraw, { regionId }) : presentOperationDetails(operation, { regionId })
      : null;
  return (
    <ActivitySurface heading={heading} labelledBy={labelledBy} label={labelled} plain={plain}>
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
        <ol className="list-none p-0" onPointerDown={() => void TransactionDetailsSheet.preload()}>
          {items.map((item) => item.kind === "transfer" ? (
            <TransferActivityRow
              key={`transfer:${item.id}`}
              transfer={item.transfer}
              regionId={regionId}
              onActivate={() => {
                rememberDetailOpener();
                onDetailsChange?.();
                setSelection(null);
                setSelectedTransfer(item.transfer);
                setDetailsOpen(true);
              }}
            />
          ) : (
            <OperationActivityRow
              key={`action:${item.id}`}
              operation={item.operation}
              regionId={regionId}
              withdraw={item.withdraw}
              onActivate={() => {
                rememberDetailOpener();
                onDetailsChange?.();
                setSelectedTransfer(null);
                setSelection({ operation: item.operation, withdraw: item.withdraw });
                setDetailsOpen(true);
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
        open={detailsOpen}
        titleId="activity-transaction-details-title"
        details={details}
        footerAction={cashout?.cancellable && operation && onCancelCashout ? {
          label: <>Cancel cash-out <MoneyTicker value={cashoutMoney(cashout.remaining, cashout.decimals, regionId)} /></>,
          onClick: () => onCancelCashout(operation),
          busy: cancelBusy,
          error: cancelError,
        } : undefined}
        onClose={() => { setDetailsOpen(false); onDetailsChange?.(); }}
        onClosed={() => {
          setSelectedTransfer(null);
          setSelection(null);
          const opener = detailOpenerRef.current;
          if (opener?.isConnected) opener.focus({ preventScroll: true });
        }}
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

/** @public Reused by the Activity ledger exploration stories for per-source reload. */
export function ActivityUnavailable({
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
  const mark = presentPortfolioAssetMark({
    assetKey: assetKeyForErc20(transfer.tokenAddress),
    name: transfer.tokenSymbol ?? "Unknown token",
    symbol: transfer.tokenSymbol ?? "?",
    imageUrl: transfer.tokenImageUrl,
  });
  return (
    <ActivityRow
      icon={<CurrencyMark assetKey={mark.assetKey} src={mark.imageUrl} symbol={mark.symbol} size="sm" />}
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
