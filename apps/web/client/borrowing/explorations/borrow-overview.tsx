"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { borrowRiskCopy, borrowRiskState } from "@/client/borrowing/borrow-ui";
import {
  BorrowNotice,
  collateralDisplayName,
  formatToken,
  LiquidationBufferMeter,
  presentBorrowAssetMark,
} from "@/client/borrowing/borrowing-experience";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { ShimmerRows } from "@/client/home/panel-shared";
import { AppDrawer, MoneyModalBody, MoneyModalHeader } from "@/client/money-modal";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { CurrencyMark } from "@/components/currency-mark";
import { AssetRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DrawerFooter } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import type { RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowMarketId } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "@/shared/borrowing/contract";
import { liquidationBufferBps, WAD } from "@/shared/borrowing/math";
import type { BorrowOperation } from "@/shared/borrowing/types";
import { formatHealthFactor, formatPresentationDate, formatWadPercent } from "@/shared/formatting";
import {
  borrowableAssets,
  loanActions,
  openLoans,
  summarizeBorrowOverview,
  type BorrowableAsset,
  type OpenLoan,
} from "./borrow-overview-model";

const BorrowMoneySheet = deferSheet(() => import("../borrow-money-dialog").then((module) => module.BorrowMoneyDialog));

type Props = {
  overview?: BorrowOverviewResponse | null;
  summaryDisplay?: { total: string } | null;
  variant?: "a" | "b";
  status?: "ready" | "loading" | "error";
  onRetry?: () => void;
  session: VerifiedAccountSession;
  regionId?: RegionId;
  prepareMoneyAction?: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  assetMarkResolution?: AssetMarkResolution;
  initialMarketId?: BorrowMarketId;
};

type SheetAction = {
  operation: BorrowOperation;
  enabled: boolean;
  label: string;
  variant: "default" | "secondary" | "outline";
  ariaLabel?: string;
};

function bufferCopy(hf: string | null, name: string) {
  if (hf === null) return { context: "No debt", title: "No debt" };
  if (BigInt(hf) <= WAD) return { context: "At risk", title: "Immediate liquidation risk" };
  const bps = liquidationBufferBps(BigInt(hf));
  if (bps === null) return { context: "No debt", title: "No debt" };
  const tenths = (bps + BigInt(5)) / BigInt(10);
  const percent = tenths % BigInt(10) === BigInt(0)
    ? `${tenths / BigInt(10)}`
    : `${tenths / BigInt(10)}.${tenths % BigInt(10)}`;
  return {
    context: `${(bps + BigInt(50)) / BigInt(100)}% buffer`,
    title: `${name} can fall ${percent}% before liquidation`,
  };
}

function Mark({ snapshot, resolution }: { snapshot: BorrowMarketSnapshot; resolution?: AssetMarkResolution }) {
  const mark = presentBorrowAssetMark(snapshot.market.collateralToken, resolution);
  return (
    <CurrencyMark
      assetKey={mark.assetKey}
      currency={mark.currency}
      symbol={mark.symbol}
      src={mark.imageUrl}
      pending={mark.pending}
    />
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl>
      {rows.map(([label, value]) => (
        <div key={label} className="grid min-h-11 grid-cols-[auto_1fr] items-center gap-3 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-end tabular-nums wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Summary({
  overview,
  summaryDisplay,
  status,
  onRetry,
  regionId,
  summaryRef,
}: Pick<Props, "overview" | "summaryDisplay" | "status" | "onRetry"> & {
  regionId: RegionId;
  summaryRef: React.RefObject<HTMLParagraphElement | null>;
}) {
  if (status === "loading") {
    return (
      <div aria-busy="true" className="space-y-4">
        <Card variant="flush">
          <CardContent inset="hero">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-5 w-32" />
          </CardContent>
        </Card>
        <section aria-label="Open loans">
          <Card className="gap-3">
            <CardHeader><Skeleton className="h-6 w-28" /></CardHeader>
            <CardContent inset="list"><ShimmerRows count={3} /></CardContent>
          </Card>
        </section>
        <span className="sr-only">Loading Borrow overview</span>
      </div>
    );
  }

  const verified = status !== "error" && overview ? summarizeBorrowOverview(overview) : null;
  const unavailable = !verified || verified.completeness === "unavailable";
  const summary = unavailable ? null : verified;
  return (
    <>
      <Card variant="flush">
        <CardContent inset="hero">
          <p className="text-sm text-muted-foreground" ref={summaryRef} tabIndex={-1}>Borrowed</p>
          {unavailable ? (
            <p className="text-3xl font-semibold tabular-nums sm:text-4xl">
              <span aria-hidden="true">—</span><span className="sr-only">Unavailable</span>
            </p>
          ) : summary ? (
            <div className={`text-3xl font-semibold tabular-nums sm:text-4xl ${summary.completeness === "partial" ? "text-muted-foreground" : ""}`}>
              <MoneyTicker
                animated={false}
                align="start"
                className="max-w-full overflow-x-auto"
                reserveDigits={false}
                value={summaryDisplay?.total ?? (summary.loanToken ? formatToken(summary.totalDebtRaw, summary.loanToken, regionId) : "$0.00")}
              />
            </div>
          ) : null}
          {summary ? (
            <>
              <p className="text-sm text-muted-foreground">
                {summary.aprWad
                  ? `${formatWadPercent(summary.aprWad, regionId)} APR${summary.completeness === "partial" ? " on loans we could check" : ""}`
                  : summary.completeness === "complete" ? "No open loans" : null}
              </p>
              {summary.completeness === "partial" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">Some loans couldn&apos;t be checked</p>
                  {onRetry ? <Button variant="secondary" size="sm" className="min-h-11" onClick={onRetry}>Retry</Button> : null}
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
      {unavailable ? (
        <div className="space-y-3">
          <BorrowNotice tone="error" role="alert" title="Borrow is unavailable">
            Current loan values could not be verified. No zero values are shown.
          </BorrowNotice>
          {onRetry ? <Button variant="secondary" size="sm" className="min-h-11" onClick={onRetry}>Retry</Button> : null}
        </div>
      ) : null}
    </>
  );
}

function LoanRow({
  row,
  variant,
  regionId,
  resolution,
  openMarket,
}: {
  row: OpenLoan;
  variant: "a" | "b";
  regionId: RegionId;
  resolution?: AssetMarkResolution;
  openMarket: (id: BorrowMarketId, element: HTMLElement) => void;
}) {
  const rowName = collateralDisplayName(row.market.id);
  if (row.kind === "unavailable") {
    const mark = presentBorrowAssetMark(row.market.collateralToken, resolution);
    return (
      <AssetRow
        icon={<CurrencyMark assetKey={mark.assetKey} currency={mark.currency} symbol={mark.symbol} src={mark.imageUrl} pending={mark.pending} />}
        iconTone="mark"
        label={rowName}
        context="Couldn't load this loan"
      />
    );
  }
  const position = row.snapshot.position;
  const hasDebt = BigInt(position.debtAssetsRaw) > BigInt(0);
  const risk = borrowRiskState(position.healthFactorWad);
  const urgent = risk === "urgent" || risk === "liquidatable";
  const attention = risk === "liquidatable" ? "Needs attention now" : urgent ? "Needs attention" : undefined;
  const paused = row.snapshot.eligibility.mode === "reducing-only" || !row.snapshot.eligibility.newRisk;
  const tier = { healthy: "Healthy", "limited-buffer": "Low buffer", urgent: "Urgent", liquidatable: "At risk", "no-debt": "No debt" }[risk];
  const buffer = bufferCopy(position.healthFactorWad, rowName);
  const context = !hasDebt ? "Collateral available"
    : paused ? urgent ? tier : `${tier} · Paused`
      : variant === "b" ? urgent && risk === "urgent" ? `Urgent · ${buffer.context.replace(" buffer", "")}` : buffer.context
        : tier;
  const contextTitle = !hasDebt ? undefined : `${variant === "b" && !paused ? buffer.title : borrowRiskCopy(risk)}${paused ? " · New borrowing paused" : ""}`;
  return (
    <AssetRow
      icon={<Mark snapshot={row.snapshot} resolution={resolution} />}
      iconTone="mark"
      label={rowName}
      context={context}
      contextTitle={contextTitle}
      value={hasDebt ? formatToken(position.debtAssetsRaw, row.market.loanToken, regionId) : "No debt"}
      valueTone={hasDebt ? "default" : "muted"}
      valueContext={hasDebt
        ? `${formatWadPercent(row.snapshot.state.borrowAprWad, regionId)} APR`
        : formatToken(position.collateralRaw, row.market.collateralToken, regionId)}
      attention={attention}
      onActivate={(element) => openMarket(row.market.id, element)}
      activateLabel={`Manage ${rowName} loan`}
    />
  );
}

function AssetRows({
  assets,
  regionId,
  resolution,
  openMarket,
  empty,
}: {
  assets: BorrowableAsset[];
  regionId: RegionId;
  resolution?: AssetMarkResolution;
  openMarket: (id: BorrowMarketId, element: HTMLElement) => void;
  empty: boolean;
}) {
  return assets.map((asset) => {
    const rowName = collateralDisplayName(asset.market.id);
    const mark = presentBorrowAssetMark(asset.market.collateralToken, resolution);
    const context = asset.kind === "unavailable" ? "Couldn't load"
      : asset.kind === "held-no-capacity" ? BigInt(asset.snapshot.state.liquidityAssetsRaw) === BigInt(0) ? `No ${asset.market.loanToken.symbol} to borrow now` : "Too little to borrow"
        : [
          ...(asset.kind === "held" ? ["In wallet"] : []),
          ...(asset.kind === "not-held" && !empty ? ["Not in wallet"] : []),
          `${formatWadPercent(asset.snapshot.state.borrowAprWad, regionId)} APR`,
        ].join(" · ");
    return (
      <AssetRow
        key={asset.market.id}
        icon={<CurrencyMark assetKey={mark.assetKey} currency={mark.currency} symbol={mark.symbol} src={mark.imageUrl} pending={mark.pending} />}
        iconTone="mark"
        label={rowName}
        context={context}
        value={asset.kind === "held"
          ? formatToken(asset.openingAvailableRaw, asset.market.loanToken, regionId)
          : asset.kind === "held-no-capacity"
            ? formatToken(asset.snapshot.wallet.collateralBalanceRaw, asset.market.collateralToken, regionId)
            : undefined}
        valueContext={asset.kind === "held" ? "Available" : asset.kind === "held-no-capacity" ? "In wallet" : undefined}
        onActivate={asset.kind === "held" ? (element) => openMarket(asset.market.id, element) : undefined}
        activateLabel={`Borrow against ${rowName}`}
      />
    );
  });
}

function SheetFooter({
  snapshot,
  name,
  debt,
  pledged,
  variant,
  canDispatch,
  begin,
  focusOperation,
  actionFocusRef,
}: {
  snapshot: BorrowMarketSnapshot;
  name: string;
  debt: boolean;
  pledged: boolean;
  variant: "a" | "b";
  canDispatch: boolean;
  begin: (operation: BorrowOperation) => void;
  focusOperation: BorrowOperation | null;
  actionFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const actions = loanActions(snapshot);
  const risk = borrowRiskState(snapshot.position.healthFactorWad);
  const reason = actions.reason ? (
    <p className={`text-sm ${risk === "urgent" || risk === "liquidatable" ? "text-destructive" : "text-muted-foreground"}`}>
      {actions.reason}
    </p>
  ) : null;
  function action({ operation, enabled, label, variant: buttonVariant, ariaLabel }: SheetAction) {
    return (
      <Button
        key={operation}
        ref={focusOperation === operation ? actionFocusRef : undefined}
        className="h-auto min-h-11 w-full whitespace-normal"
        variant={buttonVariant}
        disabled={!enabled || !canDispatch}
        aria-label={ariaLabel}
        onPointerDown={() => void BorrowMoneySheet.preload()}
        onClick={() => begin(operation)}
      >
        {label}
      </Button>
    );
  }
  const debtButtons = (
    <div className="grid grid-cols-2 gap-2">
      {action({ label: "Repay", operation: "repay", enabled: actions.repay, variant: "default" })}
      {action({ label: "Borrow more", operation: "borrow", enabled: actions.borrowMore, variant: "secondary" })}
    </div>
  );
  const collateralButtons = pledged ? (
    <div role="group" aria-label={`Manage ${name} collateral`} className={debt ? "grid grid-cols-2 gap-2" : "space-y-2"}>
      {debt ? action({ label: "Add collateral", operation: "supply-collateral", enabled: actions.addCollateral, variant: "outline" }) : null}
      {action({
        label: "Withdraw",
        operation: "withdraw-collateral",
        enabled: actions.withdraw,
        variant: debt ? "outline" : "default",
        ariaLabel: `Withdraw collateral from ${name} position`,
      })}
      {!debt ? action({ label: "Add collateral", operation: "supply-collateral", enabled: actions.addCollateral, variant: "outline" }) : null}
    </div>
  ) : null;
  if (variant === "b" && debt) {
    return { bodyActions: debtButtons, footer: <>{reason}{collateralButtons}</> };
  }
  return {
    bodyActions: null,
    footer: (
      <>
        {reason}
        {debt ? debtButtons : pledged ? (
          <div className="grid grid-cols-2 gap-2">
            {action({ label: "Withdraw", operation: "withdraw-collateral", enabled: actions.withdraw, variant: "default", ariaLabel: `Withdraw collateral from ${name} position` })}
            {action({ label: "Borrow", operation: "borrow", enabled: actions.borrowOpen, variant: "secondary" })}
          </div>
        ) : action({ label: "Borrow", operation: "supply-and-borrow", enabled: actions.borrowOpen, variant: "default" })}
        {debt ? collateralButtons : pledged ? (
          <div role="group" aria-label={`Manage ${name} collateral`}>
            {action({ label: "Add collateral", operation: "supply-collateral", enabled: actions.addCollateral, variant: "outline" })}
          </div>
        ) : null}
      </>
    ),
  };
}

function ManagementSheet({
  snapshot,
  name,
  variant,
  regionId,
  openingAvailableRaw,
  titleId,
  detailsId,
  canDispatch,
  dismiss,
  begin,
  focusOperation,
  actionFocusRef,
  heroFocusRef,
}: {
  snapshot: BorrowMarketSnapshot;
  name: string;
  variant: "a" | "b";
  regionId: RegionId;
  openingAvailableRaw: string;
  titleId: string;
  detailsId: string;
  canDispatch: boolean;
  dismiss: () => void;
  begin: (operation: BorrowOperation) => void;
  focusOperation: BorrowOperation | null;
  actionFocusRef: React.RefObject<HTMLButtonElement | null>;
  heroFocusRef: React.RefObject<HTMLParagraphElement | null>;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const debt = BigInt(snapshot.position.debtAssetsRaw) > BigInt(0);
  const pledged = BigInt(snapshot.position.collateralRaw) > BigInt(0);
  const sheetActions = SheetFooter({ snapshot, name, debt, pledged, variant, canDispatch, begin, focusOperation, actionFocusRef });
  const detailRows: Array<[string, string]> = [
    ["Health factor", formatHealthFactor(snapshot.position.healthFactorWad, regionId)],
    ["Max LTV", formatWadPercent(snapshot.market.lltvWad, regionId)],
    ["Available to borrow", formatToken(snapshot.position.borrowCapacityAssetsRaw, snapshot.market.loanToken, regionId)],
    ["Withdrawable collateral", formatToken(snapshot.position.withdrawableCollateralRaw, snapshot.market.collateralToken, regionId)],
    ["Checked", formatPresentationDate(snapshot.source.fetchedAt, { regionId, style: "date-time-zone" })],
  ];
  const primaryRows: Array<[string, string]> = [
    ...(pledged && debt ? [["Collateral", formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)] as [string, string]] : []),
    ...(BigInt(snapshot.wallet.collateralBalanceRaw) > BigInt(0)
      ? [["In wallet", formatToken(snapshot.wallet.collateralBalanceRaw, snapshot.market.collateralToken, regionId)] as [string, string]] : []),
    ...(variant === "b" && debt ? detailRows : []),
  ];
  return (
    <>
      <MoneyModalHeader title={name} titleId={titleId} closeLabel={`Close ${name} details`} onClose={dismiss} />
      <MoneyModalBody hasFooter={variant === "a" || !debt} className="gap-4 pt-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{debt ? "Borrowed" : pledged ? "Collateral" : "Borrow up to"}</p>
          <p ref={heroFocusRef} tabIndex={-1} className="text-3xl font-semibold tabular-nums">
            <MoneyTicker
              animated={false}
              align="start"
              className="max-w-full overflow-x-auto"
              reserveDigits={false}
              value={debt
                ? formatToken(snapshot.position.debtAssetsRaw, snapshot.market.loanToken, regionId)
                : pledged
                  ? formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)
                  : formatToken(openingAvailableRaw, snapshot.market.loanToken, regionId)}
            />
          </p>
          <p className="text-sm text-muted-foreground">
            {pledged && !debt ? "No debt" : `${formatWadPercent(snapshot.state.borrowAprWad, regionId)} APR · variable`}
          </p>
        </div>
        {debt ? (
          <LiquidationBufferMeter
            healthFactorWad={snapshot.position.healthFactorWad}
            liquidationPriceRaw={snapshot.position.liquidationPriceRaw}
            market={snapshot.market}
            regionId={regionId}
          />
        ) : null}
        {sheetActions.bodyActions}
        <Facts rows={primaryRows} />
        {variant === "a" && debt ? (
          <div>
            <Button
              variant="ghost"
              className="min-h-11 justify-start ps-0"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              Details
              <ChevronDown className={`size-4 transition-transform duration-150 motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} />
            </Button>
            <div id={detailsId} hidden={!detailsOpen}><Facts rows={detailRows} /></div>
          </div>
        ) : null}
        {variant === "b" && debt ? sheetActions.footer : null}
      </MoneyModalBody>
      {variant === "a" || !debt ? <DrawerFooter>{sheetActions.footer}</DrawerFooter> : null}
    </>
  );
}

export function BorrowOverviewProposal({
  overview = null,
  summaryDisplay,
  variant = "a",
  status = "ready",
  onRetry,
  session,
  regionId = "US",
  prepareMoneyAction,
  executeMoneyAction,
  fetchAccountResource,
  assetMarkResolution,
  initialMarketId,
}: Props) {
  const titleId = useId();
  const detailsId = useId();
  const loansHeadingId = useId();
  const assetsHeadingId = useId();
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const actionFocusRef = useRef<HTMLButtonElement>(null);
  const heroFocusRef = useRef<HTMLParagraphElement>(null);
  const focusedAfterMoney = useRef(false);
  const [focusOperation, setFocusOperation] = useState<BorrowOperation | null>(null);
  const [lastSelected, setLastSelected] = useState<{ id: BorrowMarketId; snapshot: BorrowMarketSnapshot } | null>(() => {
    const entry = overview?.opportunities.find((item) => item.market.id === initialMarketId);
    return entry?.availability.status === "available" ? { id: entry.market.id, snapshot: entry.availability.snapshot } : null;
  });
  const [marketId, setMarketId] = useState<BorrowMarketId | null>(initialMarketId ?? null);
  const [managementOpen, setManagementOpen] = useState(Boolean(initialMarketId && overview?.opportunities.some((entry) =>
    entry.market.id === initialMarketId && entry.availability.status === "available")));
  const [pendingOperation, setPendingOperation] = useState<BorrowOperation | null>(null);
  const [moneyOperation, setMoneyOperation] = useState<BorrowOperation | null>(null);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const opportunities = overview?.opportunities ?? [];
  const selected = opportunities.find((entry) => entry.market.id === marketId);
  const currentSnapshot = selected?.availability.status === "available" ? selected.availability.snapshot : null;
  const snapshot = currentSnapshot ?? (lastSelected?.id === marketId ? lastSelected.snapshot : null);
  const loans = overview ? openLoans(overview) : [];
  const assets = overview ? borrowableAssets(overview) : [];
  const ready = status === "ready" && overview !== null;
  const empty = !loans.length && !assets.some((asset) => asset.kind === "held" || asset.kind === "held-no-capacity");
  const held = assets.find((asset): asset is Extract<BorrowableAsset, { kind: "held" }> =>
    asset.kind === "held" && asset.market.id === marketId);

  function openMarket(id: BorrowMarketId, element: HTMLElement) {
    opener.current = element;
    focusedAfterMoney.current = false;
    setFocusOperation(null);
    const entry = opportunities.find((item) => item.market.id === id);
    if (entry?.availability.status === "available") setLastSelected({ id, snapshot: entry.availability.snapshot });
    setMarketId(id);
    setManagementOpen(true);
  }

  function onManagementClosed() {
    if (pendingOperation) {
      setPendingOperation(null);
      requestAnimationFrame(() => setMoneyOpen(true));
    } else {
      setLastSelected(null);
      setMarketId(null);
      setFocusOperation(null);
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }

  function begin(operation: BorrowOperation) {
    void BorrowMoneySheet.preload();
    setMoneyOperation(operation);
    setPendingOperation(operation);
    setManagementOpen(false);
  }

  function onMoneyClose() {
    if (moneyOpen) {
      setMoneyOpen(false);
      return;
    }
    setMoneyOperation(null);
    if (overview?.opportunities.some((entry) => entry.market.id === marketId && entry.availability.status === "available" && (
      BigInt(entry.availability.snapshot.position.debtAssetsRaw) > BigInt(0) ||
      BigInt(entry.availability.snapshot.position.collateralRaw) > BigInt(0) ||
      moneyOperation === "supply-and-borrow"
    ))) {
      focusedAfterMoney.current = false;
      setFocusOperation(moneyOperation);
      setManagementOpen(true);
    } else {
      setLastSelected(null);
      setMarketId(null);
      setFocusOperation(null);
      summaryRef.current?.focus({ preventScroll: true });
    }
  }

  const actions = snapshot ? loanActions(snapshot) : null;
  const debt = snapshot ? BigInt(snapshot.position.debtAssetsRaw) > BigInt(0) : false;
  const pledged = snapshot ? BigInt(snapshot.position.collateralRaw) > BigInt(0) : false;
  const actionEnabled = Boolean(prepareMoneyAction && executeMoneyAction && actions && (
    focusOperation === "repay" ? debt && actions.repay
      : focusOperation === "borrow" ? (debt ? actions.borrowMore : pledged && actions.borrowOpen)
        : focusOperation === "supply-and-borrow" ? !pledged && actions.borrowOpen
          : focusOperation === "supply-collateral" ? pledged && actions.addCollateral
            : focusOperation === "withdraw-collateral" ? pledged && actions.withdraw : false
  ));

  useEffect(() => {
    if (!managementOpen || !focusOperation || focusedAfterMoney.current) return;
    const frame = requestAnimationFrame(() => {
      (actionEnabled ? actionFocusRef.current : heroFocusRef.current)?.focus({ preventScroll: true });
      focusedAfterMoney.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [managementOpen, focusOperation, actionEnabled]);

  return (
    <main className={`${shellContentFrameClassName} space-y-4 py-4`}>
      <h2 className="sr-only">Borrow</h2>
      <Summary overview={overview} summaryDisplay={summaryDisplay} status={status} onRetry={onRetry} regionId={regionId} summaryRef={summaryRef} />
      {ready ? (
        <>
          {loans.length > 0 ? (
            <section aria-labelledby={loansHeadingId}>
              <Card className="gap-3">
                <CardHeader><HomeSectionHeading id={loansHeadingId}>Open loans</HomeSectionHeading></CardHeader>
                <CardContent inset="list">
                  <ul className="list-none p-0">
                    {loans.map((row) => (
                      <LoanRow
                        key={row.market.id}
                        row={row}
                        variant={variant}
                        regionId={regionId}
                        resolution={assetMarkResolution}
                        openMarket={openMarket}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ) : null}
          {summarizeBorrowOverview(overview).completeness !== "unavailable" ? (
            <section aria-labelledby={assetsHeadingId}>
              <Card className="gap-3">
                <CardHeader><HomeSectionHeading id={assetsHeadingId}>Assets you can borrow against</HomeSectionHeading></CardHeader>
                {empty ? (
                  <p className="px-4 text-sm text-muted-foreground">Add a supported asset to your wallet to borrow USDC.</p>
                ) : null}
                <CardContent inset="list">
                  <ul className="list-none p-0">
                    <AssetRows assets={assets} regionId={regionId} resolution={assetMarkResolution} openMarket={openMarket} empty={empty} />
                  </ul>
                </CardContent>
              </Card>
            </section>
          ) : null}
        </>
      ) : null}
      {ready ? (
        <AppDrawer
          open={managementOpen}
          labelledBy={titleId}
          initialFocusRef={focusOperation ? actionEnabled ? actionFocusRef : heroFocusRef : undefined}
          onCancel={() => setManagementOpen(false)}
          onClose={onManagementClosed}
        >
          {snapshot ? (
            <ManagementSheet
              key={marketId}
              snapshot={snapshot}
              name={collateralDisplayName(snapshot.market.id)}
              variant={variant}
              regionId={regionId}
              openingAvailableRaw={held?.openingAvailableRaw ?? "0"}
              titleId={titleId}
              detailsId={detailsId}
              canDispatch={Boolean(prepareMoneyAction && executeMoneyAction)}
              dismiss={() => setManagementOpen(false)}
              begin={begin}
              focusOperation={focusOperation}
              actionFocusRef={actionFocusRef}
              heroFocusRef={heroFocusRef}
            />
          ) : null}
        </AppDrawer>
      ) : null}
      {snapshot && moneyOperation && prepareMoneyAction && executeMoneyAction ? (
        <BorrowMoneySheet
          key={`${marketId}:${moneyOperation}`}
          open={moneyOpen}
          session={session}
          snapshot={snapshot}
          operation={moneyOperation}
          regionId={regionId}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          fetchAccountResource={fetchAccountResource}
          assetMarkResolution={assetMarkResolution}
          onClose={onMoneyClose}
        />
      ) : null}
    </main>
  );
}
