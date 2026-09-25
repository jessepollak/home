"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { CurrencyMark } from "@/components/currency-mark";
import {
  presentPortfolioAssetMark,
  type AssetMarkPresentation,
  type AssetMarkResolution,
} from "@/client/asset-mark/presentation";
import { canonicalUsdcAsset } from "@/config/portfolio-assets";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import {
  isServerVerified,
  isSessionSettling,
  useAccountWallet,
  type AccountWalletClient,
} from "@/client/account/cdp-client";
import { dataOwnerKey as ownerDataKey } from "@/client/account/owner-keys";
import {
  browserHomeQueryClient,
  ownerQueryKey,
  ownerQueryMeta,
  useHomeQuery,
  useHomeQueryClient,
} from "@/client/query/query-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadErrorCard } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import type { RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  BORROW_HEALTH_BUFFER_WAD,
  BORROW_HEALTH_FLOOR_WAD,
  getBorrowMarketRef,
  type BorrowAssetRef,
  type BorrowMarketId,
} from "@/shared/borrowing/config";
import {
  parseBorrowOverview,
  parseSnapshot,
  type BorrowMarketIdentity,
  type BorrowMarketSnapshot,
  type BorrowOverviewOpportunity,
  type BorrowOverviewPosition,
  type BorrowOverviewResponse,
} from "@/shared/borrowing/contract";
import {
  WAD,
  availableBorrowAssets,
  borrowCapacityAssets,
  liquidationBufferBps,
  minimumCollateralForHealthFactor,
  mulDivUp,
  policyMaximumDebtAssets,
  taylorCompounded,
  toAssetsUp,
  toSharesUp,
} from "@/shared/borrowing/math";
import type { BorrowOperation } from "@/shared/borrowing/types";
import { leadingBorrowOffer } from "@/shared/borrowing/offer";
import {
  formatHealthFactor,
  formatOracleUsd,
  formatPresentationDate,
  formatPresentationTokenAmount,
  formatWadPercent,
} from "@/shared/formatting";
import { borrowRiskState } from "./borrow-ui";

type FetchAccountResource = AccountWalletClient["fetchAccountResource"];
type PrepareMoneyAction = AccountWalletClient["prepareMoneyAction"];
type ExecuteMoneyAction = AccountWalletClient["executeMoneyAction"];

type BorrowExperienceProps = {
  session: VerifiedAccountSession | null;
  sessionSettling?: boolean;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: PrepareMoneyAction;
  executeMoneyAction?: ExecuteMoneyAction;
  selectedMarketId?: BorrowMarketId | null;
  onSelectMarket?: (marketId: BorrowMarketId | null) => void;
  regionId?: RegionId;
  assetMarkResolution?: AssetMarkResolution;
};

type BorrowDialogState = {
  operation: BorrowOperation;
  snapshot: BorrowMarketSnapshot;
} | null;

const BorrowMoneySheet = deferSheet(() => import("./borrow-money-dialog").then((module) => module.BorrowMoneyDialog));

export function AuthenticatedBorrowExperience({
  selectedMarketId = null,
  onSelectMarket,
  regionId = "GLOBAL",
  assetMarkResolution,
}: {
  selectedMarketId?: BorrowMarketId | null;
  onSelectMarket?: (marketId: BorrowMarketId | null) => void;
  regionId?: RegionId;
  assetMarkResolution?: AssetMarkResolution;
}) {
  const account = useAccountWallet();
  return (
    <BorrowExperience
      session={isServerVerified(account) ? account.session : null}
      sessionSettling={isSessionSettling(account)}
      fetchAccountResource={account.fetchAccountResource}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
      selectedMarketId={selectedMarketId}
      onSelectMarket={onSelectMarket}
      regionId={regionId}
      assetMarkResolution={assetMarkResolution}
    />
  );
}

export function useBorrowOfferRate({
  enabled,
  regionId = "GLOBAL",
}: {
  enabled: boolean;
  regionId?: RegionId;
}): string | null {
  const account = useAccountWallet();
  const session = account.status === "verified" ? account.session : null;
  const overview = useBorrowOverview(enabled ? session : null, account.fetchAccountResource);
  const leading = overview.data ? leadingBorrowOffer(overview.data.opportunities) : null;
  const snapshot = leading?.availability.status === "available" ? leading.availability.snapshot : null;
  if (!enabled || !snapshot) return null;
  return `${formatWadPercent(snapshot.state.borrowAprWad, regionId)} APR`;
}

export function BorrowExperience(props: BorrowExperienceProps) {
  const sessionKey = props.session?.smartAccount ? ownerDataKey(props.session) : "signed-out";
  return <BorrowExperienceInner key={sessionKey} {...props} />;
}

function BorrowExperienceInner({
  session,
  sessionSettling = false,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  selectedMarketId = null,
  onSelectMarket,
  regionId = "GLOBAL",
  assetMarkResolution,
}: BorrowExperienceProps) {
  const configuredSelection = selectedMarketId && getBorrowMarketRef(selectedMarketId) ? selectedMarketId : null;
  const overview = useBorrowOverview(configuredSelection ? null : session, fetchAccountResource);

  if (configuredSelection) {
    return (
      <BorrowDirectMarket
        key={configuredSelection}
        session={session}
        sessionSettling={sessionSettling}
        fetchAccountResource={fetchAccountResource}
        prepareMoneyAction={prepareMoneyAction}
        executeMoneyAction={executeMoneyAction}
        marketId={configuredSelection}
        onClose={() => onSelectMarket?.(null)}
        regionId={regionId}
        assetMarkResolution={assetMarkResolution}
      />
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="borrow-overview-title">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight" id="borrow-overview-title">Borrow</h2>
        <p className="text-sm text-muted-foreground">Borrow USDC against your crypto on Base.</p>
      </div>

      {!session?.smartAccount && !sessionSettling ? <BorrowNotice title="Sign in to view Borrow" /> : null}
      {(!session?.smartAccount && sessionSettling) || (session?.smartAccount && overview.isPending) ? <BorrowOverviewLoading /> : null}
      {session?.smartAccount && overview.isError ? (
        <LoadErrorCard
          tone="destructive"
          role="alert"
          title={overview.data ? "Borrow data could not be refreshed" : "Borrow is unavailable"}
          description={overview.data
            ? `Showing values last verified ${formatPresentationDate(overview.data.discovery.fetchedAt, { regionId, style: "date-time-zone" })}; current values could not be verified.`
            : "Current market and position values could not be verified. No zero values are shown."}
          onRetry={() => void overview.refetch()}
        />
      ) : null}

      {overview.data && session ? (
        <>
          {overview.data.discovery.status === "partial" ? (
            <BorrowNotice tone="error" role="alert" title="Some Borrow data is unavailable">
              {overview.data.discovery.reason ?? "Position discovery may be incomplete. Missing values are not zero."}
            </BorrowNotice>
          ) : null}
          <div className="space-y-3" aria-label="Borrow markets" role="list">
            {overview.data.opportunities
              .slice()
              .sort((a, b) => a.market.rank - b.market.rank)
              .map((opportunity) => (
                <BorrowMarketCard
                  key={opportunity.market.id}
                  opportunity={opportunity}
                  session={session}
                  fetchAccountResource={fetchAccountResource}
                  prepareMoneyAction={prepareMoneyAction}
                  executeMoneyAction={executeMoneyAction}
                  regionId={regionId}
                  assetMarkResolution={assetMarkResolution}
                />
              ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function BorrowDirectMarket({
  session,
  sessionSettling,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  marketId,
  onClose,
  regionId,
  assetMarkResolution,
}: {
  session: VerifiedAccountSession | null;
  sessionSettling: boolean;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: PrepareMoneyAction;
  executeMoneyAction?: ExecuteMoneyAction;
  marketId: BorrowMarketId;
  onClose: () => void;
  regionId: RegionId;
  assetMarkResolution?: AssetMarkResolution;
}) {
  const detail = useBorrowDetail(session, marketId, fetchAccountResource, true);
  const snapshot = detail.data ?? null;
  const hasCollateral = snapshot ? BigInt(snapshot.position.collateralRaw) > BigInt(0) : false;
  const risk = borrowRiskState(snapshot?.position.healthFactorWad ?? null);
  const canOpen = Boolean(snapshot && snapshot.eligibility.newRisk && snapshot.eligibility.mode === "enabled" &&
    risk !== "urgent" && risk !== "liquidatable" && BigInt(snapshot.state.liquidityAssetsRaw) > BigInt(0) &&
    (hasCollateral ? BigInt(snapshot.position.borrowCapacityAssetsRaw) > BigInt(0) : BigInt(openingBorrowAvailableBaseUnits(snapshot)) > BigInt(0)));
  const [dialogSnapshot, setDialogSnapshot] = useState<BorrowMarketSnapshot | null>(null);
  if (!dialogSnapshot && snapshot && canOpen) setDialogSnapshot(snapshot);

  return (
    <section className="space-y-4" aria-labelledby="borrow-direct-title">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight" id="borrow-direct-title">Borrow</h2>
        <p className="text-sm text-muted-foreground">Borrow USDC against your crypto on Base.</p>
      </div>
      {!session?.smartAccount && !sessionSettling ? <BorrowNotice title="Sign in to view Borrow" /> : null}
      {(!session?.smartAccount && sessionSettling) || (session?.smartAccount && detail.isPending) ? <BorrowOverviewLoading /> : null}
      {session?.smartAccount && detail.isError ? (
        <LoadErrorCard tone="destructive" role="alert" title="Borrow is unavailable" description="Current wallet, market, and position values could not be verified." onRetry={() => void detail.refetch()} />
      ) : null}
      {snapshot && !canOpen && !dialogSnapshot ? (
        <Card className="overflow-hidden">
          <CardContent>
            <div className="space-y-4 sm:px-1">
              <BorrowMarketHeading market={snapshot.market} assetMarkResolution={assetMarkResolution} />
              <p className="text-sm text-muted-foreground">
                {BigInt(snapshot.wallet.collateralBalanceRaw) === BigInt(0) && !hasCollateral
                  ? `You need ${snapshot.market.collateralToken.symbol} in this wallet before you can borrow.`
                  : snapshot.eligibility.reason ?? "New borrowing is not currently available for this market."}
              </p>
              <Button variant="secondary" onClick={onClose}>Back to Borrow</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {dialogSnapshot && session?.smartAccount && prepareMoneyAction && executeMoneyAction ? (
        <BorrowMoneySheet
          session={session}
          snapshot={dialogSnapshot}
          operation={BigInt(dialogSnapshot.position.collateralRaw) > BigInt(0) ? "borrow" : "supply-and-borrow"}
          fetchAccountResource={fetchAccountResource}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          regionId={regionId}
          onClose={onClose}
          assetMarkResolution={assetMarkResolution}
        />
      ) : null}
    </section>
  );
}

function BorrowMarketCard({
  opportunity,
  fetchAccountResource,
  session,
  prepareMoneyAction,
  executeMoneyAction,
  regionId,
  assetMarkResolution,
}: {
  opportunity: BorrowOverviewOpportunity;
  fetchAccountResource?: FetchAccountResource;
  session: VerifiedAccountSession;
  prepareMoneyAction?: PrepareMoneyAction;
  executeMoneyAction?: ExecuteMoneyAction;
  regionId: RegionId;
  assetMarkResolution?: AssetMarkResolution;
}) {
  const [dialog, setDialog] = useState<BorrowDialogState>(null);
  const snapshot = opportunity.availability.status === "available" ? opportunity.availability.snapshot : null;
  const hasDebt = snapshot ? BigInt(snapshot.position.debtAssetsRaw) > BigInt(0) : false;

  return (
    <Card className="overflow-hidden" data-testid="borrow-market-card" role="listitem">
      <CardContent>
        <div className="space-y-4 sm:px-1">
          <BorrowMarketHeading market={opportunity.market} assetMarkResolution={assetMarkResolution} />
          {opportunity.availability.status === "unavailable" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{opportunity.availability.reason}</p>
              <Button disabled className="w-full sm:w-auto">Borrow</Button>
            </div>
          ) : snapshot ? (
            <>
              {hasDebt ? (
                <BorrowPositionSummary snapshot={snapshot} regionId={regionId} />
              ) : (
                <BorrowOpenSummary snapshot={snapshot} regionId={regionId} />
              )}
              <BorrowCardActions snapshot={snapshot} onOpen={(operation) => { void BorrowMoneySheet.preload(); setDialog({ operation, snapshot }); }} />
            </>
          ) : null}
        </div>
      </CardContent>
      {dialog && prepareMoneyAction && executeMoneyAction ? (
        <BorrowMoneySheet
          key={`${dialog.snapshot.market.id}:${dialog.operation}`}
          session={session}
          snapshot={dialog.snapshot}
          operation={dialog.operation}
          fetchAccountResource={fetchAccountResource}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          regionId={regionId}
          onClose={() => setDialog(null)}
          assetMarkResolution={assetMarkResolution}
        />
      ) : null}
    </Card>
  );
}

export function collateralDisplayName(marketId: BorrowMarketId): string {
  const market = getBorrowMarketRef(marketId);
  if (!market) throw new Error("Borrow market is not configured.");
  return market.collateralDisplay.name;
}

function parseTrustedSnapshot(value: unknown, owner: `0x${string}`): BorrowMarketSnapshot | null {
  const snapshot = parseSnapshot(value, owner);
  const market = snapshot ? getBorrowMarketRef(snapshot.market.id) : null;
  if (!snapshot || !market || snapshot.market.rank !== market.rank) return null;
  for (const [actual, trusted] of [
    [snapshot.market.loanToken, market.loanToken],
    [snapshot.market.collateralToken, market.collateralToken],
  ] as const) {
    if (actual.address.toLowerCase() !== trusted.address.toLowerCase() ||
      actual.symbol !== trusted.symbol || actual.decimals !== trusted.decimals || actual.name !== trusted.name) return null;
  }
  return snapshot;
}

function BorrowMarketHeading({
  market,
  assetMarkResolution,
}: {
  market: BorrowMarketIdentity;
  assetMarkResolution?: AssetMarkResolution;
}) {
  const mark = presentBorrowAssetMark(market.collateralToken, assetMarkResolution);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <CurrencyMark
        assetKey={mark.assetKey}
        currency={mark.currency}
        symbol={mark.symbol}
        src={mark.imageUrl}
        pending={mark.pending}
      />
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold">{collateralDisplayName(market.id)}</h3>
        <p className="truncate text-sm text-muted-foreground">Borrow {market.loanToken.symbol} with {market.collateralToken.symbol}</p>
      </div>
    </div>
  );
}

export function presentBorrowAssetMark(
  asset: BorrowAssetRef,
  resolution: AssetMarkResolution = {},
): AssetMarkPresentation {
  return presentPortfolioAssetMark({
    assetKey: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    currency: asset.id === canonicalUsdcAsset.assetKey ? canonicalUsdcAsset.cashCurrency : null,
  }, resolution);
}

function BorrowOpenSummary({ snapshot, regionId }: { snapshot: BorrowMarketSnapshot; regionId: RegionId }) {
  const hasSuppliedCollateral = BigInt(snapshot.position.collateralRaw) > BigInt(0);
  const hasWalletCollateral = BigInt(snapshot.wallet.collateralBalanceRaw) > BigInt(0);
  const available = hasSuppliedCollateral
    ? snapshot.position.borrowCapacityAssetsRaw
    : openingBorrowAvailableBaseUnits(snapshot);
  const collateralCopy = hasSuppliedCollateral
    ? `${formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)} locked as collateral`
    : hasWalletCollateral
      ? `Backed by ${formatToken(snapshot.wallet.collateralBalanceRaw, snapshot.market.collateralToken, regionId)} in your wallet`
      : `You need ${snapshot.market.collateralToken.symbol} in this wallet before you can borrow.`;
  return (
    <div className="space-y-1">
      <p className="text-xl font-semibold tabular-nums"><MoneyTicker className="overflow-x-auto" reserveDigits={false} value={formatToken(available, snapshot.market.loanToken, regionId)} /> available</p>
      <p className="text-sm text-muted-foreground">
        {collateralCopy}{hasSuppliedCollateral || hasWalletCollateral ? ` · ${formatWadPercent(snapshot.state.borrowAprWad, regionId)} variable rate` : ""}
      </p>
    </div>
  );
}

function BorrowPositionSummary({ snapshot, regionId }: { snapshot: BorrowMarketSnapshot; regionId: RegionId }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Borrowed</p>
          <p className="font-semibold tabular-nums"><MoneyTicker className="overflow-x-auto" value={formatToken(snapshot.position.debtAssetsRaw, snapshot.market.loanToken, regionId)} /></p>
        </div>
        <div className="min-w-0 rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">{collateralDisplayName(snapshot.market.id)} locked</p>
          <p className="font-semibold tabular-nums"><MoneyTicker className="overflow-x-auto" value={formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)} /></p>
        </div>
      </div>
      <LiquidationBufferMeter
        healthFactorWad={snapshot.position.healthFactorWad}
        liquidationPriceRaw={snapshot.position.liquidationPriceRaw}
        market={snapshot.market}
        regionId={regionId}
        showHealth
      />
    </div>
  );
}

function BorrowCardActions({ snapshot, onOpen }: { snapshot: BorrowMarketSnapshot; onOpen: (operation: BorrowOperation) => void }) {
  const hasDebt = BigInt(snapshot.position.debtAssetsRaw) > BigInt(0);
  const hasCollateral = BigInt(snapshot.position.collateralRaw) > BigInt(0);
  const hasWalletCollateral = BigInt(snapshot.wallet.collateralBalanceRaw) > BigInt(0);
  const hasWalletLoan = BigInt(snapshot.wallet.loanBalanceRaw) > BigInt(0);
  const risk = borrowRiskState(snapshot.position.healthFactorWad);
  const canNewRisk = snapshot.eligibility.newRisk && snapshot.eligibility.mode === "enabled" && risk !== "urgent" && risk !== "liquidatable";
  const canBorrow = canNewRisk && BigInt(snapshot.state.liquidityAssetsRaw) > BigInt(0) &&
    (hasCollateral ? BigInt(snapshot.position.borrowCapacityAssetsRaw) > BigInt(0) : hasWalletCollateral && BigInt(openingBorrowAvailableBaseUnits(snapshot)) > BigInt(0));
  const primaryActions = hasDebt
    ? [
        { label: "Borrow more", operation: "borrow" as const, disabled: !canBorrow },
        { label: "Repay", operation: "repay" as const, disabled: !hasWalletLoan },
      ]
    : [
        { label: "Borrow", operation: hasCollateral ? "borrow" as const : "supply-and-borrow" as const, disabled: !canBorrow },
      ];
  return (
    <div className="space-y-3" onPointerDown={() => void BorrowMoneySheet.preload()}>
      <div className={`grid grid-cols-1 gap-2 ${primaryActions.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {primaryActions.map((action, index) => (
          <Button key={action.operation} className="min-h-11 h-auto whitespace-normal" variant={index === 0 ? "default" : "secondary"} disabled={action.disabled} onClick={() => onOpen(action.operation)}>
            <span className="py-2">{action.label}</span>
          </Button>
        ))}
      </div>
      {hasDebt || hasCollateral ? (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Manage ${collateralDisplayName(snapshot.market.id)} position`}>
          <Button className="min-h-11 h-auto w-full whitespace-normal" size="sm" variant="outline" disabled={!hasWalletCollateral} onClick={() => onOpen("supply-collateral")}>
            <span className="py-2">Add collateral</span>
          </Button>
          <Button aria-label={`Withdraw collateral from ${collateralDisplayName(snapshot.market.id)} position`} className="min-h-11 h-auto w-full whitespace-normal" size="sm" variant="outline" disabled={!hasCollateral || (hasDebt && !canNewRisk) || BigInt(snapshot.position.withdrawableCollateralRaw) === BigInt(0)} onClick={() => onOpen("withdraw-collateral")}>
            <span className="py-2">Withdraw</span>
          </Button>
        </div>
      ) : null}
      {snapshot.eligibility.mode === "reducing-only" || !snapshot.eligibility.newRisk ? (
        <p className="text-sm text-destructive">{snapshot.eligibility.reason ?? "New borrowing is paused. You can still repay or add collateral."}</p>
      ) : null}
    </div>
  );
}

export function LiquidationBufferMeter({
  healthFactorWad,
  liquidationPriceRaw,
  market,
  regionId,
  showHealth = false,
}: {
  healthFactorWad: string | null;
  liquidationPriceRaw: string | null;
  market: BorrowMarketIdentity;
  regionId: RegionId;
  showHealth?: boolean;
}) {
  const healthFactor = healthFactorWad === null ? null : BigInt(healthFactorWad);
  const bps = liquidationBufferBps(healthFactor);
  if (bps === null || healthFactor === null) return null;
  const visualBps = bps > BigInt(5000) ? BigInt(5000) : bps;
  const belowFloor = healthFactor < BORROW_HEALTH_FLOOR_WAD;
  const copy = healthFactor <= WAD
    ? "Immediate liquidation risk"
    : `${collateralDisplayName(market.id)} can fall ${formatBufferPercent(bps)} before liquidation`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={`text-sm font-medium ${belowFloor ? "text-destructive" : ""}`}>{copy}</p>
        {showHealth ? <span className="text-xs text-muted-foreground">HF {formatHealthFactor(healthFactorWad, regionId)}</span> : null}
      </div>
      <div
        className="relative h-2 overflow-visible rounded-full bg-muted"
        role="meter"
        aria-label="Liquidation buffer"
        aria-valuemin={0}
        aria-valuemax={50}
        aria-valuenow={Number(visualBps) / 100}
        aria-valuetext={copy}
      >
        <div className={`h-full rounded-full ${belowFloor ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Number(visualBps) / 50}%` }} />
        <span className="absolute -top-0.5 h-3 w-0.5 bg-muted-foreground/60" style={{ left: "40%" }} aria-hidden="true" />
        <span className="absolute -top-0.5 h-3 w-0.5 bg-muted-foreground/60" style={{ left: "66%" }} aria-hidden="true" />
      </div>
      {liquidationPriceRaw ? <p className="text-xs text-muted-foreground">Liquidation around {formatOracleUsd(liquidationPriceRaw, { loanDecimals: market.loanToken.decimals, collateralDecimals: market.collateralToken.decimals }, regionId)} per {market.collateralToken.symbol}</p> : null}
    </div>
  );
}

function BorrowOverviewLoading() {
  return <Card aria-busy="true"><CardContent><div className="space-y-3 py-5"><Skeleton className="h-5 w-36" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><span className="sr-only">Loading Borrow overview</span></div></CardContent></Card>;
}

export function BorrowNotice({ children, role = "status", title, tone = "neutral", ...props }: Omit<ComponentProps<typeof Alert>, "children" | "title"> & { children?: ReactNode; role?: "status" | "alert"; title?: ReactNode; tone?: "neutral" | "error" }) {
  return (
    <Alert role={role} variant={tone === "error" ? "destructive" : "default"} {...props}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children ? <AlertDescription>{children}</AlertDescription> : null}
    </Alert>
  );
}

function useBorrowOverview(session: VerifiedAccountSession | null, fetchAccountResource?: FetchAccountResource) {
  const owner = session?.smartAccount?.address ?? null;
  const key = session?.smartAccount ? ownerDataKey(session) : null;
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const overview = useHomeQuery({
    queryKey: key ? ownerQueryKey(key, "borrow", "overview") : ["unauthenticated", "borrow-overview-disabled"],
    enabled: Boolean(key && owner && fetchAccountResource),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: true,
    meta: key ? ownerQueryMeta(key, "owner") : undefined,
    queryFn: ({ signal }) => {
      if (!fetchAccountResource) throw new Error("Borrow is unavailable.");
      return fetchAccountResource("/api/borrow", { signal });
    },
    select: (value): BorrowOverviewResponse => {
      if (!owner) throw new Error("Borrow is unavailable.");
      const parsed = parseBorrowOverview(value, owner);
      if (!parsed || parsed.opportunities.some((entry) => entry.availability.status === "available" && (
        !parseTrustedSnapshot(entry.availability.snapshot, owner) ||
        entry.availability.snapshot.market.id !== entry.market.id ||
        !parsed.discovery.sourceBlock ||
        entry.availability.snapshot.source.blockHash !== parsed.discovery.sourceBlock.blockHash
      ))) throw new Error("Borrow overview response is invalid.");
      return parsed;
    },
  });
  useEffect(() => {
    if (!key || !overview.data) return;
    for (const opportunity of overview.data.opportunities) {
      if (opportunity.availability.status !== "available") continue;
      const detailKey = ownerQueryKey(key, "borrow", "detail", opportunity.market.id);
      if ((queryClient.getQueryState(detailKey)?.dataUpdatedAt ?? 0) > overview.dataUpdatedAt) continue;
      queryClient.setQueryData(detailKey, opportunity.availability.snapshot);
    }
  }, [key, overview.data, overview.dataUpdatedAt, queryClient]);
  return overview;
}

function useBorrowDetail(session: VerifiedAccountSession | null, marketId: BorrowMarketId | null, fetchAccountResource: FetchAccountResource | undefined, enabled: boolean) {
  const owner = session?.smartAccount?.address ?? null;
  const key = session?.smartAccount ? ownerDataKey(session) : null;
  return useHomeQuery({
    queryKey: key && marketId ? ownerQueryKey(key, "borrow", "detail", marketId) : ["unauthenticated", "borrow-detail-disabled"],
    enabled: Boolean(enabled && marketId && key && owner && fetchAccountResource),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    meta: key ? ownerQueryMeta(key, "owner") : undefined,
    queryFn: ({ signal }) => {
      if (!marketId) throw new Error("Borrow market is unavailable.");
      if (!fetchAccountResource) throw new Error("Borrow is unavailable.");
      return fetchAccountResource(`/api/borrow/markets/${marketId}`, { signal });
    },
    select: (value): BorrowMarketSnapshot => {
      if (!owner) throw new Error("Borrow is unavailable.");
      const parsed = parseTrustedSnapshot(value, owner);
      if (!parsed) throw new Error("Borrow market response is invalid.");
      return parsed;
    },
  });
}

export function formatToken(raw: string, asset: BorrowMarketIdentity["loanToken"], regionId: RegionId): string {
  return formatPresentationTokenAmount(raw, asset.decimals, asset.symbol, {
    ...(asset.symbol === "USDC" ? { cashCurrency: "USD" as const } : {}),
    regionId,
    useNoBreakSpace: true,
  });
}

export function openingBorrowAvailableBaseUnits(snapshot: BorrowMarketSnapshot): string {
  const rawMaximumDebt = borrowCapacityAssets(
    BigInt(snapshot.wallet.collateralBalanceRaw),
    BigInt(snapshot.state.oraclePriceRaw),
    BigInt(snapshot.market.lltvWad),
  );
  const policyMaximumDebt = policyMaximumDebtAssets(rawMaximumDebt, BORROW_HEALTH_FLOOR_WAD);
  return availableBorrowAssets({
    positionBorrowShares: BigInt(snapshot.position.borrowSharesRaw),
    totalBorrowAssets: BigInt(snapshot.state.totalBorrowAssetsRaw),
    totalBorrowShares: BigInt(snapshot.state.totalBorrowSharesRaw),
    maxDebtAssets: policyMaximumDebt,
    liquidityAssets: BigInt(snapshot.state.liquidityAssetsRaw),
  }).toString(10);
}

export function recommendedOpeningCollateralBaseUnits(snapshot: BorrowMarketSnapshot, amountBaseUnits: string): string | null {
  const borrowed = BigInt(amountBaseUnits);
  if (borrowed <= BigInt(0)) return null;
  const totalBorrowAssets = BigInt(snapshot.state.totalBorrowAssetsRaw);
  const totalBorrowShares = BigInt(snapshot.state.totalBorrowSharesRaw);
  const mintedShares = toSharesUp(borrowed, totalBorrowAssets, totalBorrowShares);
  const postDebt = toAssetsUp(
    BigInt(snapshot.position.borrowSharesRaw) + mintedShares,
    totalBorrowAssets + borrowed,
    totalBorrowShares + mintedShares,
  );
  const oraclePrice = BigInt(snapshot.state.oraclePriceRaw);
  const lltvWad = BigInt(snapshot.market.lltvWad);
  const walletCollateral = BigInt(snapshot.wallet.collateralBalanceRaw);
  const targetCollateral = minimumCollateralForHealthFactor(postDebt, oraclePrice, lltvWad, BORROW_HEALTH_BUFFER_WAD);
  if (targetCollateral <= walletCollateral) return targetCollateral.toString(10);
  const floorCollateral = minimumCollateralForHealthFactor(postDebt, oraclePrice, lltvWad, BORROW_HEALTH_FLOOR_WAD);
  return floorCollateral <= walletCollateral ? walletCollateral.toString(10) : null;
}

function formatBufferPercent(bps: bigint): string {
  const tenths = (bps + BigInt(5)) / BigInt(10);
  const whole = tenths / BigInt(10);
  const fraction = tenths % BigInt(10);
  return fraction === BigInt(0) ? `${whole}%` : `${whole}.${fraction}%`;
}

function bufferCopy(healthFactorWad: string | null, marketId: BorrowMarketId): string {
  const healthFactor = healthFactorWad === null ? null : BigInt(healthFactorWad);
  const bps = liquidationBufferBps(healthFactor);
  if (bps === null || healthFactor === null) return "No debt";
  return healthFactor <= WAD ? "Immediate liquidation risk" : `${collateralDisplayName(marketId)} can fall ${formatBufferPercent(bps)}`;
}

/** @public exercised by client/borrowing/borrowing-experience.test.tsx */
export function borrowTeaserPositionDescription(position: BorrowOverviewPosition, regionId: RegionId): string {
  return BigInt(position.debtAssetsRaw) === BigInt(0)
    ? `No debt · ${formatToken(position.collateralRaw, position.market.collateralToken, regionId)} locked`
    : `${formatToken(position.debtAssetsRaw, position.market.loanToken, regionId)} borrowed · ${bufferCopy(position.healthFactorWad, position.market.id)}`;
}

export function recommendedRepayMaximumBaseUnits(debtBaseUnits: string, walletBaseUnits: string, ratePerSecondWad: string): string {
  const debt = BigInt(debtBaseUnits);
  const wallet = BigInt(walletBaseUnits);
  if (debt <= BigInt(0) || wallet <= BigInt(0)) return "0";
  const oneHourGrowthWad = taylorCompounded(BigInt(ratePerSecondWad), BigInt(3600));
  const accruedBuffer = mulDivUp(debt, oneHourGrowthWad, WAD);
  const recommended = debt + accruedBuffer + BigInt(1);
  return (recommended < wallet ? recommended : wallet).toString(10);
}
