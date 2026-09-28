"use client";

import { useEffect, useId, useRef, useState } from "react";
import { dataOwnerKey as ownerDataKey } from "@/client/account/owner-keys";
import { ChevronDown, CircleDollarSign, Coins, ShieldCheck } from "lucide-react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { borrowOperationLabels, borrowRiskCopy, borrowRiskState } from "./borrow-ui";
import { BorrowNotice, collateralDisplayName, formatCash, formatToken, LiquidationBufferMeter, presentBorrowAssetMark } from "./borrowing-experience";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { ShimmerRows } from "@/client/home/panel-shared";
import { MoneyModal, MoneyModalActions, MoneyModalBody, MoneyModalHeader, MoneyModalStep, MoneyModalStepLoading, deferStep } from "@/client/money-modal";
import { useIdlePreload } from "@/client/money-modal/deferred-sheet";
import { CurrencyMark } from "@/components/currency-mark";
import { AssetRow, type FinanceRowAction } from "@/components/finance-rows";
import { buyRouteForToken } from "@/shared/trading/assets";
import { useAssetTrade } from "@/client/trading/use-asset-trade";
import { FeatureIntro } from "@/components/ui/feature-intro";
import { MoneyTicker } from "@/components/money-ticker";
import { ManagementFacts } from "@/components/management-facts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { presentationRegions, type RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { HomeMoneySummary } from "@/shared/balances/present";
import type { BorrowAssetRef, BorrowMarketId } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "@/shared/borrowing/contract";
import type { BorrowOperation } from "@/shared/borrowing/types";
import { formatHealthFactor, formatPresentationDate, formatPresentationFiat, formatWadPercent } from "@/shared/formatting";
import { borrowableAssets, borrowDebtsMatchOverview, loanActions, openLoans, summarizeBorrowOverview, type BorrowableAsset, type OpenLoan } from "./borrow-overview-model";

const BorrowMoneyStep = deferStep(() => import("./borrow-money-dialog").then((module) => module.BorrowMoneyFlow));

type Props = {
  overview?: BorrowOverviewResponse | null;
  borrowSummary?: HomeMoneySummary["borrow"] | null;
  status?: "ready" | "loading" | "error";
  onRetry?: () => void;
  session: VerifiedAccountSession | null;
  regionId?: RegionId;
  prepareMoneyAction?: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  assetMarkResolution?: AssetMarkResolution;
  initialMarketId?: BorrowMarketId;
};

type SheetAction = { operation: BorrowOperation; enabled: boolean; label: string; variant: "default" | "secondary" | "outline"; ariaLabel?: string };

function RowMark({ asset, resolution }: { asset: BorrowAssetRef; resolution?: AssetMarkResolution }) {
  const mark = presentBorrowAssetMark(asset, resolution);
  return <CurrencyMark assetKey={mark.assetKey} currency={mark.currency} symbol={mark.symbol} src={mark.imageUrl} pending={mark.pending} size="sm" />;
}

function Summary({ overview, borrowSummary, status, onRetry, regionId, summaryRef }: Pick<Props, "overview" | "borrowSummary" | "status" | "onRetry"> & { regionId: RegionId; summaryRef: React.RefObject<HTMLParagraphElement | null> }) {
  if (status === "loading") return (
    <div aria-busy="true" className="space-y-4">
      <Card variant="flush"><CardContent inset="hero"><Skeleton className="h-5 w-24" /><Skeleton className="h-10 w-48" /><Skeleton className="h-5 w-32" /></CardContent></Card>
      <section aria-label="Open loans"><Card className="gap-3"><CardHeader><Skeleton className="h-6 w-28" /></CardHeader><CardContent inset="list"><ShimmerRows count={3} /></CardContent></Card></section>
      <span className="sr-only">Loading Borrow overview</span>
    </div>
  );
  const verified = status !== "error" && overview ? summarizeBorrowOverview(overview) : null;
  const unavailable = !verified || verified.completeness === "unavailable";
  const summary = unavailable ? null : verified;
  const total = summary?.totalDebtRaw === "0" && summary.completeness === "complete"
    ? formatPresentationFiat({ atoms: "0", scale: 2 }, presentationRegions[regionId].currency.code ?? "USD", 2, regionId)
    : summary?.completeness === "complete" && borrowSummary?.kind === "position" && borrowSummary.status === "complete" && borrowSummary.value && overview && borrowDebtsMatchOverview(overview, borrowSummary.debts)
      ? borrowSummary.value
      : summary?.loanToken ? formatCash(summary.totalDebtRaw, summary.loanToken, regionId) : "—";
  return <>
    <Card variant="flush"><CardContent inset="hero">
      <p className="text-sm text-muted-foreground" ref={summaryRef} tabIndex={-1}>Borrowed</p>
      {unavailable ? <p className="text-3xl font-semibold tabular-nums sm:text-4xl"><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></p>
        : <div className={`text-3xl font-semibold tabular-nums sm:text-4xl ${summary?.completeness === "partial" ? "text-muted-foreground" : ""}`}>
          <MoneyTicker animated={false} align="start" className="max-w-full overflow-x-auto" reserveDigits={false} value={total} />
        </div>}
      {summary ? <>
        <p className="text-sm text-muted-foreground">{summary.aprWad
          ? `${formatWadPercent(summary.aprWad, regionId)} APR${summary.completeness === "partial" ? " on loans we could check" : ""}`
          : summary.completeness === "complete" ? "No open loans" : null}</p>
        {summary.completeness === "partial" ? <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">Some loans couldn&apos;t be checked</p>
          {onRetry ? <Button variant="secondary" size="sm" className="min-h-11" onClick={onRetry}>Retry</Button> : null}
        </div> : null}
      </> : null}
    </CardContent></Card>
    {unavailable ? <div className="space-y-3">
      <BorrowNotice tone="error" role="alert" title="Borrow is unavailable">Current loan values could not be verified. No zero values are shown.</BorrowNotice>
      {onRetry ? <Button variant="secondary" size="sm" className="min-h-11" onClick={onRetry}>Retry</Button> : null}
    </div> : null}
  </>;
}

function LoanRow({ row, regionId, resolution, openMarket }: { row: OpenLoan; regionId: RegionId; resolution?: AssetMarkResolution; openMarket: (id: BorrowMarketId, element: HTMLElement) => void }) {
  const rowName = collateralDisplayName(row.market.id);
  if (row.kind === "unavailable") {
    return <AssetRow icon={<RowMark asset={row.market.collateralToken} resolution={resolution} />} iconTone="mark" label={rowName} context="Couldn't load this loan" />;
  }
  const position = row.snapshot.position;
  const hasDebt = BigInt(position.debtAssetsRaw) > BigInt(0);
  const risk = borrowRiskState(position.healthFactorWad);
  const urgent = risk === "urgent" || risk === "liquidatable";
  const attention = risk === "liquidatable" ? "Needs attention now" : urgent ? "Needs attention" : undefined;
  const paused = row.snapshot.eligibility.mode === "reducing-only" || !row.snapshot.eligibility.newRisk;
  const tier = { healthy: "Healthy", "limited-buffer": "Low buffer", urgent: "Urgent", liquidatable: "At risk", "no-debt": "No debt" }[risk];
  const context = !hasDebt ? "Collateral available" : paused && !urgent ? `${tier} · Paused` : tier;
  const contextTitle = !hasDebt ? undefined : `${borrowRiskCopy(risk)}${paused ? " · New borrowing paused" : ""}`;
  return <AssetRow
    icon={<RowMark asset={row.market.collateralToken} resolution={resolution} />} iconTone="mark" label={rowName}
    context={context} contextTitle={contextTitle}
    value={hasDebt ? formatCash(position.debtAssetsRaw, row.market.loanToken, regionId) : "No debt"}
    valueTone={hasDebt ? "default" : "muted"}
    valueContext={hasDebt ? `${formatWadPercent(row.snapshot.state.borrowAprWad, regionId)} APR` : formatToken(position.collateralRaw, row.market.collateralToken, regionId)}
    attention={attention} onActivate={(element) => openMarket(row.market.id, element)} activateLabel={`Manage ${rowName} loan`}
  />;
}

function AssetRows({ assets, regionId, resolution, openMarket, buy, empty }: { assets: BorrowableAsset[]; regionId: RegionId; resolution?: AssetMarkResolution; openMarket: (id: BorrowMarketId, element: HTMLElement) => void; buy: { states: ReadonlyMap<string, "none" | "pending" | "zero" | "ready">; intent: (assetId: string) => void; open: (assetId: string, button: HTMLButtonElement) => void }; empty: boolean }) {
  return assets.map((asset) => {
    const rowName = collateralDisplayName(asset.market.id);
    const assetId = asset.kind === "not-held" ? buyRouteForToken({ chainId: asset.snapshot.chainId, address: asset.market.collateralToken.address }) : null;
    const buyState = assetId ? buy.states.get(assetId) : undefined;
    const buyAction = assetId && buyState && buyState !== "none"
      ? { label: "Buy", accessibleLabel: `Buy ${rowName}`, onIntent: () => buy.intent(assetId), onAction: (button: HTMLButtonElement) => buy.open(assetId, button),
          pending: buyState === "pending", disabled: buyState === "zero" } satisfies FinanceRowAction : undefined;
    const context = asset.kind === "unavailable" ? "Couldn't load"
      : asset.kind === "held-no-capacity" ? BigInt(asset.snapshot.state.liquidityAssetsRaw) === BigInt(0) ? `No ${asset.market.loanToken.symbol} to borrow now` : "Too little to borrow"
        : [...(asset.kind === "not-held" && buyAction?.disabled ? ["No Cash to buy"] : asset.kind === "not-held" && !empty ? ["Not in wallet"] : []), `${formatWadPercent(asset.snapshot.state.borrowAprWad, regionId)} APR`]
          .map((segment) => segment.replaceAll(" ", "\u00a0")).join(" · ");
    return <AssetRow key={asset.market.id}
      icon={<RowMark asset={asset.market.collateralToken} resolution={resolution} />}
      iconTone="mark" label={rowName} context={context} contextLines={2}
      value={asset.kind === "held" ? formatCash(asset.openingAvailableRaw, asset.market.loanToken, regionId)
        : asset.kind === "held-no-capacity" ? formatToken(asset.snapshot.wallet.collateralBalanceRaw, asset.market.collateralToken, regionId) : undefined}
      valueContext={asset.kind === "held" ? "Available" : asset.kind === "held-no-capacity" ? "In wallet" : undefined}
      {...(buyAction ? { action: buyAction } : {
        onActivate: asset.kind === "held" ? (element: HTMLElement) => openMarket(asset.market.id, element) : undefined,
        ...(asset.kind === "held" ? { activateLabel: `Borrow against ${rowName}` } : {}),
      })}
    />;
  });
}

function SheetFooter({ snapshot, name, debt, pledged, canDispatch, begin, focusOperation, actionFocusRef }: {
  snapshot: BorrowMarketSnapshot; name: string; debt: boolean; pledged: boolean; canDispatch: boolean;
  begin: (operation: BorrowOperation) => void; focusOperation: BorrowOperation | null; actionFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const actions = loanActions(snapshot);
  const risk = borrowRiskState(snapshot.position.healthFactorWad);
  const reason = actions.reason ? <p className={`text-sm ${risk === "urgent" || risk === "liquidatable" ? "text-destructive" : "text-muted-foreground"}`}>{actions.reason}</p> : null;
  function action({ operation, enabled, label, variant, ariaLabel }: SheetAction) {
    return <Button key={operation} ref={focusOperation === operation ? actionFocusRef : undefined}
      className="h-auto min-h-11 w-full whitespace-normal" variant={variant} disabled={!enabled || !canDispatch} aria-label={ariaLabel}
      onPointerDown={() => void BorrowMoneyStep.preload()} onClick={() => begin(operation)}>{label}</Button>;
  }
  return <>
    {reason}
    {debt ? <div className="grid grid-cols-2 gap-2">
      {action({ label: "Repay", operation: "repay", enabled: actions.repay, variant: "default" })}
      {action({ label: "Borrow more", operation: "borrow", enabled: actions.borrowMore, variant: "secondary" })}
    </div> : pledged ? <div className="grid grid-cols-2 gap-2">
      {action({ label: "Withdraw", operation: "withdraw-collateral", enabled: actions.withdraw, variant: "default", ariaLabel: `Withdraw collateral from ${name} position` })}
      {action({ label: "Borrow", operation: "borrow", enabled: actions.borrowOpen, variant: "secondary" })}
    </div> : action({ label: "Borrow", operation: "supply-and-borrow", enabled: actions.borrowOpen, variant: "default" })}
    {pledged ? <div role="group" aria-label={`Manage ${name} collateral`} className={debt ? "grid grid-cols-2 gap-2" : "space-y-2"}>
      {action({ label: "Add collateral", operation: "supply-collateral", enabled: actions.addCollateral, variant: "outline" })}
      {debt ? action({ label: "Withdraw", operation: "withdraw-collateral", enabled: actions.withdraw, variant: "outline", ariaLabel: `Withdraw collateral from ${name} position` }) : null}
    </div> : null}
  </>;
}

function ManagementSheet({ snapshot, name, regionId, openingAvailableRaw, titleId, detailsId, detailsOpen, setDetailsOpen, canDispatch, onBack, begin, focusOperation, actionFocusRef, heroFocusRef }: {
  snapshot: BorrowMarketSnapshot; name: string; regionId: RegionId; openingAvailableRaw: string; titleId: string; detailsId: string; canDispatch: boolean;
  detailsOpen: boolean; setDetailsOpen: (open: boolean) => void;
  onBack?: () => void; begin: (operation: BorrowOperation) => void; focusOperation: BorrowOperation | null;
  actionFocusRef: React.RefObject<HTMLButtonElement | null>; heroFocusRef: React.RefObject<HTMLParagraphElement | null>;
}) {
  const debt = BigInt(snapshot.position.debtAssetsRaw) > BigInt(0);
  const pledged = BigInt(snapshot.position.collateralRaw) > BigInt(0);
  const details: Array<[string, string]> = [
    ["Health factor", formatHealthFactor(snapshot.position.healthFactorWad, regionId)],
    ["Max LTV", formatWadPercent(snapshot.market.lltvWad, regionId)],
    ["Available to borrow", formatCash(snapshot.position.borrowCapacityAssetsRaw, snapshot.market.loanToken, regionId)],
    ["Withdrawable collateral", formatToken(snapshot.position.withdrawableCollateralRaw, snapshot.market.collateralToken, regionId)],
    ["Checked", formatPresentationDate(snapshot.source.fetchedAt, { regionId, style: "date-time-zone" })],
  ];
  const primary: Array<[string, string]> = [
    ...(pledged && debt ? [["Collateral", formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)] as [string, string]] : []),
    ...(BigInt(snapshot.wallet.collateralBalanceRaw) > BigInt(0) ? [["In wallet", formatToken(snapshot.wallet.collateralBalanceRaw, snapshot.market.collateralToken, regionId)] as [string, string]] : []),
  ];
  return <>
    {onBack ? <MoneyModalHeader title={name} titleId={titleId} closeLabel={`Close ${name} details`} onBack={onBack} />
      : <MoneyModalHeader title={name} titleId={titleId} closeLabel={`Close ${name} details`} />}
    <MoneyModalBody hasFooter className="gap-4 pt-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{debt ? "Borrowed" : pledged ? "Collateral" : "Borrow up to"}</p>
        <p ref={heroFocusRef} tabIndex={-1} className="text-3xl font-semibold tabular-nums"><MoneyTicker animated={false} align="start" className="max-w-full overflow-x-auto" reserveDigits={false}
          value={debt ? formatCash(snapshot.position.debtAssetsRaw, snapshot.market.loanToken, regionId) : pledged
            ? formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId) : formatCash(openingAvailableRaw, snapshot.market.loanToken, regionId)} /></p>
        <p className="text-sm text-muted-foreground">{pledged && !debt ? "No debt" : `${formatWadPercent(snapshot.state.borrowAprWad, regionId)} APR · variable`}</p>
      </div>
      {debt ? <LiquidationBufferMeter healthFactorWad={snapshot.position.healthFactorWad} liquidationPriceRaw={snapshot.position.liquidationPriceRaw} market={snapshot.market} regionId={regionId} /> : null}
      <ManagementFacts rows={primary} />
      {debt ? <div><Button variant="ghost" className="min-h-11 justify-start ps-0" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(!detailsOpen)}>
        Details<ChevronDown className={`size-4 transition-transform duration-150 motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} />
      </Button><div id={detailsId} hidden={!detailsOpen}><ManagementFacts rows={details} /></div></div> : null}
    </MoneyModalBody>
    <MoneyModalActions><SheetFooter snapshot={snapshot} name={name} debt={debt} pledged={pledged} canDispatch={canDispatch} begin={begin} focusOperation={focusOperation} actionFocusRef={actionFocusRef} /></MoneyModalActions>
  </>;
}

export function BorrowOverview({ overview = null, borrowSummary, status = "ready", onRetry, session, regionId = "US", prepareMoneyAction, executeMoneyAction, fetchAccountResource, assetMarkResolution, initialMarketId }: Props) {
  const titleId = useId();
  const detailsId = useId();
  const loansHeadingId = useId();
  const assetsHeadingId = useId();
  const pickerTitleId = useId();
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const introActionRef = useRef<HTMLButtonElement>(null);
  const pendingBuy = useRef<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const leavingForActivity = useRef(false);
  const closeFocus = useRef<"row" | "summary" | "none">("row");
  const actionFocusRef = useRef<HTMLButtonElement>(null);
  const heroFocusRef = useRef<HTMLParagraphElement>(null);
  const [focusOperation, setFocusOperation] = useState<BorrowOperation | null>(null);
  const [marketId, setMarketId] = useState<BorrowMarketId | null>(initialMarketId ?? null);
  const [journeyOpen, setJourneyOpen] = useState(Boolean(initialMarketId && overview?.opportunities.some((entry) => entry.market.id === initialMarketId && entry.availability.status === "available")));
  const [operation, setOperation] = useState<BorrowOperation | null>(null);
  const [moneySnapshot, setMoneySnapshot] = useState<BorrowMarketSnapshot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fromPicker, setFromPicker] = useState(false);
  const ownerKey = session?.smartAccount ? ownerDataKey(session) : null;
  const [journeyOwner, setJourneyOwner] = useState(ownerKey);
  const opportunities = overview?.opportunities ?? [];
  const selected = opportunities.find((entry) => entry.market.id === marketId);
  const snapshot = selected?.availability.status === "available" ? selected.availability.snapshot : null;
  const loans = overview ? openLoans(overview) : [];
  const assets = overview ? borrowableAssets(overview) : [];
  const tradeCandidates = assets.flatMap((asset) => {
    const assetId = asset.kind === "not-held" ? buyRouteForToken({ chainId: asset.snapshot.chainId, address: asset.market.collateralToken.address }) : null;
    return assetId ? [{ assetId, assetName: collateralDisplayName(asset.market.id) }] : [];
  });
  const trade = useAssetTrade(tradeCandidates, { session: tradeCandidates.length ? session : null, regionId, onFallbackFocus: focusOverview });
  const buy = { states: trade.states, intent: (assetId: string) => trade.intent(assetId, "buy"), open: (assetId: string, button: HTMLButtonElement) => trade.open(assetId, "buy", button) };
  const ready = status === "ready" && overview !== null;
  const complete = ready && summarizeBorrowOverview(overview).completeness === "complete";
  const showIntro = complete && loans.length === 0;
  const hasBorrowableAsset = assets.some((asset) => asset.kind === "held");
  const empty = !loans.length && !assets.some((asset) => asset.kind === "held" || asset.kind === "held-no-capacity");
  const held = assets.find((asset): asset is Extract<BorrowableAsset, { kind: "held" }> => asset.kind === "held" && asset.market.id === marketId);
  function focusOverview() {
    (summaryRef.current ?? introActionRef.current)?.focus({ preventScroll: true });
  }
  function startJourney(element: HTMLElement, picker: boolean) {
    opener.current = element;
    setJourneyOwner(ownerKey);
    closeFocus.current = "row";
    leavingForActivity.current = false;
    pendingBuy.current = null;
    setFromPicker(picker);
    setDetailsOpen(false);
    setOperation(null);
    setMoneySnapshot(null);
    setFocusOperation(null);
    setJourneyOpen(true);
  }
  function openMarket(id: BorrowMarketId, element: HTMLElement) {
    startJourney(element, false);
    setMarketId(id);
  }
  function openPicker(element: HTMLElement) {
    startJourney(element, true);
    setMarketId(null);
  }
  function pickMarket(id: BorrowMarketId) {
    setDetailsOpen(false);
    setFocusOperation(null);
    setMarketId(id);
  }
  function backToPicker() {
    setFocusOperation(null);
    setMarketId(null);
  }
  function pickBuy(assetId: string) {
    pendingBuy.current = assetId;
    exitJourney("none");
  }
  function exitJourney(focus: "row" | "summary" | "none" = "row") {
    closeFocus.current = focus;
    setJourneyOpen(false);
  }
  function onJourneyClosed() {
    setJourneyOpen(false);
    setFromPicker(false);
    setMarketId(null);
    setOperation(null);
    setMoneySnapshot(null);
    setFocusOperation(null);
    const buyNext = journeyOwner === ownerKey ? pendingBuy.current : null;
    pendingBuy.current = null;
    if (journeyOwner !== ownerKey) closeFocus.current = "none";
    if (buyNext && introActionRef.current?.isConnected) trade.open(buyNext, "buy", introActionRef.current);
    else if (closeFocus.current === "summary") focusOverview();
    else if (closeFocus.current === "row") {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      else focusOverview();
    }
    closeFocus.current = "row";
  }
  function begin(nextOperation: BorrowOperation) {
    void BorrowMoneyStep.preload();
    leavingForActivity.current = false;
    setMoneySnapshot(snapshot);
    setFocusOperation(nextOperation);
    setOperation(nextOperation);
  }
  function backToManagement() {
    setOperation(null);
    setMoneySnapshot(null);
  }
  function done() {
    if (snapshot && (BigInt(snapshot.position.debtAssetsRaw) > BigInt(0) || BigInt(snapshot.position.collateralRaw) > BigInt(0) || operation === "supply-and-borrow")) backToManagement();
    else exitJourney("summary");
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
  const managementDepth = fromPicker ? 1 : 0;
  useIdlePreload(BorrowMoneyStep.preload, journeyOpen && operation === null);
  useEffect(() => {
    if (!journeyOpen || !marketId || snapshot) return;
    const frame = requestAnimationFrame(() => exitJourney("summary"));
    return () => cancelAnimationFrame(frame);
  }, [journeyOpen, marketId, snapshot]);
  return <section className="space-y-4" aria-labelledby="borrow-overview-title">
    <h2 className="sr-only" id="borrow-overview-title">Borrow</h2>
    {showIntro ? null : <Summary overview={overview} borrowSummary={borrowSummary} status={status} onRetry={onRetry} regionId={regionId} summaryRef={summaryRef} />}
    {ready ? <>
      {showIntro ? <FeatureIntro
        size="compact"
        illustration="borrow"
        headline="Borrow against your crypto"
        description="Use a supported asset as collateral to borrow USDC."
        benefits={[
          { icon: Coins, text: "Borrow without selling" },
          { icon: ShieldCheck, text: "See the variable rate and liquidation risk" },
          { icon: CircleDollarSign, text: "Repay when you're ready" },
        ]}
        primary={{
          label: hasBorrowableAsset ? "Choose an asset" : "See supported assets",
          onClick: () => { if (introActionRef.current) openPicker(introActionRef.current); },
          ref: introActionRef,
        }}
      /> : null}
      {loans.length ? <section aria-labelledby={loansHeadingId}><Card className="gap-3"><CardHeader><HomeSectionHeading id={loansHeadingId}>Open loans</HomeSectionHeading></CardHeader><CardContent inset="list"><ul className="list-none p-0">
        {loans.map((row) => <LoanRow key={row.market.id} row={row} regionId={regionId} resolution={assetMarkResolution} openMarket={openMarket} />)}
      </ul></CardContent></Card></section> : null}
      {!showIntro && summarizeBorrowOverview(overview).completeness !== "unavailable" ? <section aria-labelledby={assetsHeadingId}><Card className="gap-3"><CardHeader><HomeSectionHeading id={assetsHeadingId}>Assets you can borrow against</HomeSectionHeading></CardHeader>
        {empty ? <p className="px-4 text-sm text-muted-foreground">Add a supported asset to your wallet to borrow USDC.</p> : null}
        <CardContent inset="list"><ul className="list-none p-0"><AssetRows assets={assets} regionId={regionId} resolution={assetMarkResolution} openMarket={openMarket} buy={buy} empty={empty} /></ul></CardContent>
      </Card></section> : null}
    </> : null}
    {trade.sheet}
    {ready ? <MoneyModal open={journeyOpen && (snapshot !== null || (fromPicker && marketId === null)) && journeyOwner === ownerKey}
      labelledBy={operation ? "borrow-action-title" : marketId ? titleId : pickerTitleId}
      onCancel={() => exitJourney(leavingForActivity.current ? "none" : "row")} onClose={onJourneyClosed}>
      {operation && moneySnapshot && session && prepareMoneyAction && executeMoneyAction ? <BorrowMoneyStep key={`${ownerKey}:${marketId}:${operation}`}
        depth={managementDepth + 1} session={session} snapshot={moneySnapshot} operation={operation} regionId={regionId}
        prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} fetchAccountResource={fetchAccountResource}
        assetMarkResolution={assetMarkResolution} onBack={backToManagement} onDone={done}
        onLeave={() => { leavingForActivity.current = true; closeFocus.current = "none"; }}
        fallback={({ failed, retry }) => <MoneyModalStepLoading step="amount" depth={managementDepth + 1} title={borrowOperationLabels[operation]} titleId="borrow-action-title"
          onBack={backToManagement} closeLabel="Close Borrow action" failed={failed} onRetry={retry} />} />
        : snapshot ? <MoneyModalStep step="management" depth={managementDepth} initialFocusRef={focusOperation ? actionEnabled ? actionFocusRef : heroFocusRef : undefined}>
          <ManagementSheet snapshot={snapshot} name={collateralDisplayName(snapshot.market.id)} regionId={regionId}
            openingAvailableRaw={held?.openingAvailableRaw ?? "0"} titleId={titleId} detailsId={detailsId}
            detailsOpen={detailsOpen} setDetailsOpen={setDetailsOpen} onBack={fromPicker ? backToPicker : undefined}
            canDispatch={Boolean(prepareMoneyAction && executeMoneyAction)} begin={begin}
            focusOperation={focusOperation} actionFocusRef={actionFocusRef} heroFocusRef={heroFocusRef} />
        </MoneyModalStep>
        : fromPicker ? <MoneyModalStep step="picker" depth={0}>
          <MoneyModalHeader title={hasBorrowableAsset ? "Choose an asset" : "Supported assets"} titleId={pickerTitleId} closeLabel="Close asset list" />
          <MoneyModalBody className="gap-3 pt-4">
            {empty ? <p className="text-sm text-muted-foreground">Add a supported asset to your wallet to borrow USDC.</p> : null}
            <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0"><AssetRows assets={assets} regionId={regionId} resolution={assetMarkResolution} openMarket={pickMarket} buy={{ ...buy, open: pickBuy }} empty={empty} /></ul></CardContent></Card>
          </MoneyModalBody>
        </MoneyModalStep> : null}
    </MoneyModal> : null}
  </section>;
}
