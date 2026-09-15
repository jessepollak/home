"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Bitcoin, LoaderCircle } from "lucide-react";
import { useAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey as ownerDataKey } from "@/client/account/owner-keys";
import {
  MoneyAmountDisplay,
  MoneyConfirmSummary,
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  decimalFromBaseUnits,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
  type MoneyAmountChangeSource,
} from "@/client/money-modal";
import {
  browserHomeQueryClient,
  ownerQueryKey,
  ownerQueryMeta,
  useHomeQuery,
  useHomeQueryClient,
} from "@/client/query/query-client";
import { HomeProductTile } from "@/client/home/product-tile";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  formatExactPresentationTokenAmount,
  formatHealthFactor,
  formatOracleUsd,
  formatPresentationDate,
  formatPresentationTokenAmount,
  formatWadPercent,
} from "@/shared/formatting";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  borrowRiskState,
  buildBorrowPreparedIntent,
} from "./borrow-ui";

type FetchAccountResource = AccountWalletClient["fetchAccountResource"];
type PrepareMoneyAction = AccountWalletClient["prepareMoneyAction"];
type ExecuteMoneyAction = AccountWalletClient["executeMoneyAction"];

type BorrowExperienceProps = {
  session: VerifiedAccountSession | null;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: PrepareMoneyAction;
  executeMoneyAction?: ExecuteMoneyAction;
  selectedMarketId?: BorrowMarketId | null;
  onSelectMarket?: (marketId: BorrowMarketId | null) => void;
  regionId?: RegionId;
};

type BorrowDialogState = {
  operation: BorrowOperation;
  snapshot: BorrowMarketSnapshot;
} | null;

const operationLabels: Record<BorrowOperation, string> = {
  "supply-collateral": "Add collateral",
  borrow: "Borrow",
  "supply-and-borrow": "Borrow",
  repay: "Repay",
  "repay-all": "Repay all",
  "withdraw-collateral": "Withdraw collateral",
  "close-position": "Close position",
};

export function AuthenticatedBorrowExperience({
  selectedMarketId = null,
  onSelectMarket,
  regionId = "GLOBAL",
}: {
  selectedMarketId?: BorrowMarketId | null;
  onSelectMarket?: (marketId: BorrowMarketId | null) => void;
  regionId?: RegionId;
}) {
  const account = useAccountWallet();
  return (
    <BorrowExperience
      session={account.status === "verified" ? account.session : null}
      fetchAccountResource={account.fetchAccountResource}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
      selectedMarketId={selectedMarketId}
      onSelectMarket={onSelectMarket}
      regionId={regionId}
    />
  );
}

export function AuthenticatedBorrowTeaser({
  headingId = "borrow-heading",
  onOpen,
  regionId = "GLOBAL",
}: {
  headingId?: string;
  onOpen: () => void;
  regionId?: RegionId;
}) {
  const account = useAccountWallet();
  const session = account.status === "verified" ? account.session : null;
  const overview = useBorrowOverview(session, account.fetchAccountResource);
  const active = selectUrgentBorrowPosition(overview.data?.positions ?? []);
  const leading = overview.data?.opportunities
    .slice()
    .sort((a, b) => a.market.rank - b.market.rank)[0] ?? null;
  const hasDebt = Boolean(active && BigInt(active.debtAssetsRaw) > BigInt(0));
  const detail = useBorrowDetail(
    session,
    active?.market.id ?? null,
    account.fetchAccountResource,
    hasDebt,
  );
  const unavailable = leading?.availability.status === "unavailable";
  const primary = hasDebt && active
    ? <MoneyTicker
        value={formatToken(active.debtAssetsRaw, active.market.loanToken, regionId)}
        align="start"
        reserveDigits={false}
      />
    : "Borrow";
  const secondary = hasDebt
    ? detail.data
      ? `${formatWadPercent(detail.data.state.borrowAprWad, regionId)} variable APR`
      : detail.isError
        ? "Borrow cost unavailable"
        : "Loading borrow cost…"
    : unavailable
      ? "Bitcoin borrowing unavailable"
      : "Against Bitcoin";

  return (
    <HomeProductTile
      actionLabel={hasDebt ? "Manage" : "Borrow"}
      busy={overview.isPending || (hasDebt && detail.isPending)}
      headingId={headingId}
      icon={<Bitcoin className="size-4" aria-hidden="true" />}
      onOpen={onOpen}
      primary={primary}
      secondary={overview.isPending ? "Loading borrowing market…" : secondary}
      title="Borrow"
    />
  );
}

export function BorrowExperience(props: BorrowExperienceProps) {
  const sessionKey = props.session?.smartAccount ? ownerDataKey(props.session) : "signed-out";
  return <BorrowExperienceInner key={sessionKey} {...props} />;
}

function BorrowExperienceInner({
  session,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  selectedMarketId = null,
  onSelectMarket,
  regionId = "GLOBAL",
}: BorrowExperienceProps) {
  const overview = useBorrowOverview(session, fetchAccountResource);
  const configuredSelection = selectedMarketId && getBorrowMarketRef(selectedMarketId) ? selectedMarketId : null;

  if (configuredSelection) {
    return (
      <BorrowDirectMarket
        key={configuredSelection}
        session={session}
        fetchAccountResource={fetchAccountResource}
        prepareMoneyAction={prepareMoneyAction}
        executeMoneyAction={executeMoneyAction}
        marketId={configuredSelection}
        onClose={() => onSelectMarket?.(null)}
        regionId={regionId}
      />
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="borrow-overview-title">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight" id="borrow-overview-title">Borrow</h2>
        <p className="text-sm text-muted-foreground">Borrow USDC using your Bitcoin on Base.</p>
      </div>

      {!session?.smartAccount ? <BorrowNotice title="Sign in to view Borrow" /> : null}
      {session?.smartAccount && overview.isPending ? <BorrowOverviewLoading /> : null}
      {session?.smartAccount && overview.isError ? (
        <BorrowNotice
          tone="error"
          role="alert"
          title={overview.data ? "Borrow data could not be refreshed" : "Borrow is unavailable"}
          action={<Button variant="secondary" onClick={() => void overview.refetch()}>Retry</Button>}
        >
          {overview.data
            ? `Showing values last verified ${formatPresentationDate(overview.data.discovery.fetchedAt, { regionId, style: "date-time-zone" })}; current values could not be verified.`
            : "Current market and position values could not be verified. No zero values are shown."}
        </BorrowNotice>
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
                  position={overview.data?.positions.find((entry) => entry.market.id === opportunity.market.id) ?? null}
                  session={session}
                  fetchAccountResource={fetchAccountResource}
                  prepareMoneyAction={prepareMoneyAction}
                  executeMoneyAction={executeMoneyAction}
                  regionId={regionId}
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
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  marketId,
  onClose,
  regionId,
}: {
  session: VerifiedAccountSession | null;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: PrepareMoneyAction;
  executeMoneyAction?: ExecuteMoneyAction;
  marketId: BorrowMarketId;
  onClose: () => void;
  regionId: RegionId;
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
        <p className="text-sm text-muted-foreground">Borrow USDC using your Bitcoin on Base.</p>
      </div>
      {!session?.smartAccount ? <BorrowNotice title="Sign in to view Borrow" /> : null}
      {session?.smartAccount && detail.isPending ? <BorrowOverviewLoading /> : null}
      {session?.smartAccount && detail.isError ? (
        <BorrowNotice tone="error" role="alert" title="Borrow is unavailable" action={<Button variant="secondary" onClick={() => void detail.refetch()}>Retry</Button>}>
          Current wallet, market, and position values could not be verified.
        </BorrowNotice>
      ) : null}
      {snapshot && !canOpen && !dialogSnapshot ? (
        <Card className="overflow-hidden">
          <CardContent>
            <div className="space-y-4 sm:px-1">
              <BorrowMarketHeading market={snapshot.market} />
              <p className="text-sm text-muted-foreground">
                {BigInt(snapshot.wallet.collateralBalanceRaw) === BigInt(0) && !hasCollateral
                  ? "You need cbBTC in this wallet before you can borrow."
                  : snapshot.eligibility.reason ?? "New borrowing is not currently available for this market."}
              </p>
              <Button variant="secondary" onClick={onClose}>Back to Borrow</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {dialogSnapshot && session?.smartAccount && prepareMoneyAction && executeMoneyAction ? (
        <BorrowMoneyDialog
          session={session}
          snapshot={dialogSnapshot}
          operation={BigInt(dialogSnapshot.position.collateralRaw) > BigInt(0) ? "borrow" : "supply-and-borrow"}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          regionId={regionId}
          onClose={onClose}
        />
      ) : null}
    </section>
  );
}

function BorrowMarketCard({
  opportunity,
  position,
  session,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  regionId,
}: {
  opportunity: BorrowOverviewOpportunity;
  position: BorrowOverviewPosition | null;
  session: VerifiedAccountSession;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: PrepareMoneyAction;
  executeMoneyAction?: ExecuteMoneyAction;
  regionId: RegionId;
}) {
  const detail = useBorrowDetail(session, opportunity.market.id, fetchAccountResource, opportunity.availability.status === "available");
  const [dialog, setDialog] = useState<BorrowDialogState>(null);
  const snapshot = detail.data ?? null;
  const hasDebt = snapshot ? BigInt(snapshot.position.debtAssetsRaw) > BigInt(0) : Boolean(position && BigInt(position.debtAssetsRaw) > BigInt(0));

  return (
    <Card className="overflow-hidden" data-testid="borrow-market-card" role="listitem">
      <CardContent>
        <div className="space-y-4 sm:px-1">
          <BorrowMarketHeading market={opportunity.market} />
          {opportunity.availability.status === "unavailable" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{opportunity.availability.reason}</p>
              <Button disabled className="w-full sm:w-auto">Borrow</Button>
            </div>
          ) : detail.isPending && !snapshot ? (
            <div className="space-y-3" aria-busy="true"><Skeleton className="h-5 w-40" /><Skeleton className="h-12 w-full" /><span className="sr-only">Loading Bitcoin market</span></div>
          ) : detail.isError && !snapshot ? (
            <BorrowNotice tone="error" role="alert" title="Market values are unavailable" action={<Button variant="secondary" onClick={() => void detail.refetch()}>Retry</Button>}>
              Wallet balances and borrowing limits could not be verified.
            </BorrowNotice>
          ) : snapshot ? (
            <>
              {detail.isError ? <BorrowNotice tone="error" role="alert" title="Market values could not be refreshed">Showing the last verified values.</BorrowNotice> : null}
              {hasDebt ? (
                <BorrowPositionSummary snapshot={snapshot} regionId={regionId} />
              ) : (
                <BorrowOpenSummary snapshot={snapshot} regionId={regionId} />
              )}
              <BorrowCardActions snapshot={snapshot} onOpen={(operation) => setDialog({ operation, snapshot })} />
            </>
          ) : null}
        </div>
      </CardContent>
      {dialog && prepareMoneyAction && executeMoneyAction ? (
        <BorrowMoneyDialog
          key={`${dialog.snapshot.market.id}:${dialog.operation}`}
          session={session}
          snapshot={dialog.snapshot}
          operation={dialog.operation}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          regionId={regionId}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Card>
  );
}

function BorrowMarketHeading({ market }: { market: BorrowMarketIdentity }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BitcoinMark />
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold">Bitcoin</h3>
        <p className="truncate text-sm text-muted-foreground">Borrow {market.loanToken.symbol} with {market.collateralToken.symbol}</p>
      </div>
    </div>
  );
}

function BitcoinMark() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground shadow-sm" aria-hidden="true" data-testid="bitcoin-mark">
      ₿
    </span>
  );
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
      : "You need cbBTC in this wallet before you can borrow.";
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
          <p className="text-xs text-muted-foreground">Bitcoin locked</p>
          <p className="font-semibold tabular-nums"><MoneyTicker className="overflow-x-auto" value={formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)} /></p>
        </div>
      </div>
      <LiquidationBufferMeter
        healthFactorWad={snapshot.position.healthFactorWad}
        liquidationPriceRaw={snapshot.position.liquidationPriceRaw}
        collateralSymbol={snapshot.market.collateralToken.symbol}
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
    <div className="space-y-3">
      <div className={`grid grid-cols-1 gap-2 ${primaryActions.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {primaryActions.map((action, index) => (
          <Button key={action.operation} className="min-h-11 h-auto whitespace-normal" variant={index === 0 ? "default" : "secondary"} disabled={action.disabled} onClick={() => onOpen(action.operation)}>
            <span className="py-2">{action.label}</span>
          </Button>
        ))}
      </div>
      {hasDebt || hasCollateral ? (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Manage Bitcoin position">
          <Button className="min-h-11 h-auto w-full whitespace-normal" size="sm" variant="outline" disabled={!hasWalletCollateral} onClick={() => onOpen("supply-collateral")}>
            <span className="py-2">Add collateral</span>
          </Button>
          <Button aria-label="Withdraw collateral from Bitcoin position" className="min-h-11 h-auto w-full whitespace-normal" size="sm" variant="outline" disabled={!hasCollateral || (hasDebt && !canNewRisk) || BigInt(snapshot.position.withdrawableCollateralRaw) === BigInt(0)} onClick={() => onOpen("withdraw-collateral")}>
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

function BorrowMoneyDialog({
  session,
  snapshot,
  operation,
  prepareMoneyAction,
  executeMoneyAction,
  regionId,
  onClose,
}: {
  session: VerifiedAccountSession;
  snapshot: BorrowMarketSnapshot;
  operation: BorrowOperation;
  prepareMoneyAction: PrepareMoneyAction;
  executeMoneyAction: ExecuteMoneyAction;
  regionId: RegionId;
  onClose: () => void;
}) {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const dataOwnerKey = ownerDataKey(session);
  const closesWithoutDebt = operation === "close-position" && BigInt(snapshot.position.debtAssetsRaw) === BigInt(0);
  const fixedMaximumOperation = operation === "repay-all" || (operation === "close-position" && !closesWithoutDebt);
  const repayOperation = operation === "repay" || fixedMaximumOperation;
  const primaryAsset = operation === "supply-collateral" || operation === "withdraw-collateral" || closesWithoutDebt
    ? snapshot.market.collateralToken
    : snapshot.market.loanToken;
  const maximumRepayBaseUnits = repayOperation
    ? recommendedRepayMaximumBaseUnits(snapshot.position.debtAssetsRaw, snapshot.wallet.loanBalanceRaw, snapshot.state.borrowRatePerSecondWad)
    : null;
  const initialAmount = fixedMaximumOperation && maximumRepayBaseUnits
    ? decimalFromBaseUnits(maximumRepayBaseUnits, snapshot.market.loanToken.decimals) ?? ""
    : "";
  const primaryPricing = useMoneyAssetPricing(primaryAsset.symbol);
  const [amount, setAmount] = useState(initialAmount);
  const [amountChangeSource, setAmountChangeSource] = useState<MoneyAmountChangeSource>("programmatic");
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverExpiredActionId, setServerExpiredActionId] = useState<string | null>(null);
  const [step, setStep] = useState<"amount" | "confirm" | "pending" | "error" | "failed">("amount");
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const title = step === "amount" ? operationLabels[operation] : "Confirm";
  const requiresPrimaryAmount = !closesWithoutDebt;
  const openingCollateralBaseUnits = operation === "supply-and-borrow" && isPositiveDecimalAmount(amount)
    ? openingCollateralForDecimalAmount(snapshot, amount)
    : null;
  const preparedExpiresAt = preparedAction ? Date.parse(preparedAction.expiresAt) : Number.POSITIVE_INFINITY;
  const preparedExpired = Boolean(preparedAction && (
    serverExpiredActionId === preparedAction.id ||
    !Number.isFinite(preparedExpiresAt) ||
    preparedExpiresAt <= clockNow
  ));

  useEffect(() => {
    if (!preparedAction || !Number.isFinite(preparedExpiresAt) || preparedExpiresAt <= Date.now()) return;
    const delay = preparedExpiresAt - Date.now() + 1;
    if (delay > 2_147_000_000) return;
    const timer = window.setTimeout(() => setClockNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [preparedAction, preparedExpiresAt]);

  function closeIfAllowed() {
    if (step === "pending") return false;
    onClose();
    return true;
  }

  function goBack() {
    setPreparedAction(null);
    setServerExpiredActionId(null);
    setAttempted(false);
    setError(null);
    setStep("amount");
  }

  async function prepare() {
    try {
      const amountBaseUnits = requiresPrimaryAmount ? parseClientTokenAmount(amount, primaryAsset.decimals) : undefined;
      const collateralAmountBaseUnits = operation === "supply-and-borrow"
        ? recommendedOpeningCollateralBaseUnits(snapshot, amountBaseUnits ?? "0")
        : undefined;
      if (operation === "supply-and-borrow" && collateralAmountBaseUnits === null) {
        throw new BorrowActionClientError("That amount needs more cbBTC than is currently available in this wallet.");
      }
      const intent = buildBorrowPreparedIntent({
        snapshot,
        operation,
        amountBaseUnits,
        collateralAmountBaseUnits: collateralAmountBaseUnits ?? undefined,
        maximumRepayBaseUnits: maximumRepayBaseUnits ?? undefined,
      });
      setError(null);
      setStep("pending");
      const action = await prepareMoneyAction(intent.kind, intent.params);
      if (!preparedActionMatches(action, session, snapshot.market.id, intent.kind, intent.operation)) {
        throw new BorrowActionClientError("The prepared action did not match this verified account and Borrow market.");
      }
      setPreparedAction(action);
      setClockNow(() => Date.now());
      setServerExpiredActionId(null);
      setAttempted(false);
      setStep("confirm");
    } catch (caught) {
      setPreparedAction(null);
      setError(readableResourceError(caught));
      setStep("amount");
    }
  }

  async function confirm() {
    if (!preparedAction || step === "pending") return;
    setError(null);
    setStep("pending");
    try {
      const result = await executeMoneyAction(preparedAction);
      setAttempted(true);
      if (result.status === "rejected" || result.status === "failed") {
        setError(result.status === "rejected" ? "The wallet request was rejected." : "The verified onchain receipt reported failure.");
        setStep(result.status === "failed" ? "failed" : "error");
        return;
      }
      onClose();
      void queryClient.invalidateQueries({ queryKey: ownerQueryKey(dataOwnerKey, "borrow") });
    } catch (caught) {
      if (errorCode(caught) === "ACTION_EXPIRED") {
        setAttempted(false);
        setServerExpiredActionId(preparedAction.id);
        setError("This Borrow review expired. Go back and prepare it again.");
      } else {
        setAttempted(true);
        setError("The dispatch outcome is unresolved. Retry recording this same action; a new dispatch will not be created.");
      }
      setStep("confirm");
    }
  }

  const availableBaseUnits = operation === "supply-and-borrow"
    ? openingBorrowAvailableBaseUnits(snapshot)
    : operation === "supply-collateral"
      ? snapshot.wallet.collateralBalanceRaw
      : operation === "withdraw-collateral"
        ? snapshot.position.withdrawableCollateralRaw
        : repayOperation
          ? maximumRepayBaseUnits
          : snapshot.position.borrowCapacityAssetsRaw;
  const availableAmount = availableBaseUnits === null ? null : decimalFromBaseUnits(availableBaseUnits, primaryAsset.decimals);
  const availableLabel = availableBaseUnits === null ? undefined : `${formatToken(availableBaseUnits, primaryAsset, regionId)} available`;

  return (
    <MoneyModal open labelledBy="borrow-action-title" describedBy={step === "pending" ? "borrow-action-pending" : undefined} onCancel={closeIfAllowed} onClose={onClose}>
      <MoneyModalHeader title={title} titleId="borrow-action-title" onBack={step === "amount" || step === "pending" ? undefined : goBack} onClose={closeIfAllowed} closeDisabled={step === "pending"} closeLabel="Close Borrow action" />
      <MoneyModalBody className="gap-4 pt-4">
        {step === "amount" ? (
          <>
            {closesWithoutDebt ? (
              <MoneyConfirmSummary amount={formatToken(snapshot.position.collateralRaw, snapshot.market.collateralToken, regionId)} lead="Withdraw all collateral" rows={[{ label: "Debt", value: "No debt" }]} />
            ) : (
              <>
                <MoneyAmountDisplay
                  amount={amount}
                  amountChangeSource={amountChangeSource}
                  onAmountChange={(value, source) => { setAmount(value); setAmountChangeSource(source); }}
                  availableLabel={availableLabel}
                  availableAmount={availableAmount}
                  assetId={primaryAsset.id}
                  assetLabel={primaryAsset.symbol}
                  assetCurrency={primaryAsset.symbol === "USDC" ? "USD" : null}
                  assetLocked
                  chipSet={availableBaseUnits === null ? "none" : "max"}
                  pricing={primaryPricing}
                  nativeSymbol={primaryAsset.symbol}
                />
                <MoneyNumpad value={amount} maxDecimals={primaryAsset.decimals} onChange={(value, source) => { setAmount(value); setAmountChangeSource(source); }} />
                {operation === "supply-and-borrow" ? (
                  <div className="min-h-[4.5rem] rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid="borrow-collateral-preview">
                    <p className="font-medium">Bitcoin collateral</p>
                    <p className="text-muted-foreground">
                      {openingCollateralBaseUnits
                        ? `This borrow will lock ${formatToken(openingCollateralBaseUnits, snapshot.market.collateralToken, regionId)} as collateral.`
                        : isPositiveDecimalAmount(amount)
                          ? "That amount needs more cbBTC than is available in this wallet."
                          : "Enter an amount to preview the cbBTC that will be locked."}
                    </p>
                  </div>
                ) : null}
                {fixedMaximumOperation || isFullRepayAmount(amount, snapshot.position.debtAssetsRaw, maximumRepayBaseUnits, snapshot.market.loanToken.decimals) ? (
                  <BorrowNotice title="Maximum repayment">
                    Current debt is {formatToken(snapshot.position.debtAssetsRaw, snapshot.market.loanToken, regionId)}. The actual repayment is determined by current borrow shares and cannot exceed the amount you review.
                  </BorrowNotice>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {preparedAction && step !== "amount" ? <BorrowPreparedReview action={preparedAction} snapshot={snapshot} regionId={regionId} /> : null}
        {step === "pending" ? <BorrowNotice id="borrow-action-pending" title={<span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Waiting for your wallet…</span>} /> : null}
        {error ? <BorrowNotice tone="error" role="alert" title="Borrow action unavailable">{error}</BorrowNotice> : null}
        {preparedExpired && !attempted && step === "confirm" && !error ? (
          <BorrowNotice tone="error" role="alert" title="Borrow review expired">Go back and prepare this action again.</BorrowNotice>
        ) : null}
      </MoneyModalBody>
      {step === "amount" ? (
        <MoneyModalFooter
          primaryLabel="Continue"
          primaryDisabled={(requiresPrimaryAmount && !isPositiveDecimalAmount(amount)) || (operation === "supply-and-borrow" && isPositiveDecimalAmount(amount) && !openingCollateralBaseUnits)}
          onPrimary={() => void prepare()}
        />
      ) : null}
      {step === "confirm" ? <MoneyModalFooter primaryLabel={attempted ? "Retry" : "Confirm action"} primaryDisabled={preparedExpired && !attempted} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={goBack} /> : null}
      {step === "error" || step === "failed" ? <MoneyModalFooter primaryLabel="Back" onPrimary={goBack} secondaryLabel="Close" onSecondary={closeIfAllowed} /> : null}
    </MoneyModal>
  );
}

function BorrowPreparedReview({ action, snapshot, regionId }: { action: PreparedMoneyAction; snapshot: BorrowMarketSnapshot; regionId: RegionId }) {
  const metadata = action.metadata?.product === "borrow" ? action.metadata : null;
  const primary = action.amounts.find((entry) => entry.assetId === snapshot.market.loanToken.id && entry.direction === "receive") ??
    action.amounts.find((entry) => !entry.maximum) ?? action.amounts[0];
  const amount = primary
    ? `${primary.maximum ? "Up to " : ""}${formatExactPresentationTokenAmount(primary.amountBaseUnits, primary.decimals, primary.symbol)}`
    : action.title;
  const movementRows = action.amounts.map((entry) => {
    const suppliedCollateral = entry.direction === "spend" && entry.assetId === metadata?.collateralAsset.id &&
      (metadata.operation === "supply-collateral" || metadata.operation === "supply-and-borrow");
    return {
      label: `${entry.maximum ? "Maximum repayment" : suppliedCollateral ? "Locked as collateral" : entry.direction === "spend" ? "You spend" : "You receive"} (${entry.symbol})`,
      value: `${entry.estimated ? "Estimated " : ""}${formatExactPresentationTokenAmount(entry.amountBaseUnits, entry.decimals, entry.symbol)}`,
    };
  });
  return (
    <div className="space-y-3">
      <div className="min-w-0 [&_[data-slot=money-ticker]]:overflow-x-auto [&_dd]:wrap-anywhere">
        <MoneyConfirmSummary
          amount={amount}
          lead={action.title}
          rows={[
            ...movementRows,
            { label: "Variable rate", value: formatWadPercent(metadata?.borrowAprWad ?? snapshot.state.borrowAprWad, regionId) },
            { label: "Network", value: "Base" },
          ]}
        />
      </div>
      {metadata?.projectedHealthFactorWad ? (
        <LiquidationBufferMeter
          healthFactorWad={metadata.projectedHealthFactorWad}
          liquidationPriceRaw={metadata.projectedLiquidationPriceRaw}
          collateralSymbol={snapshot.market.collateralToken.symbol}
          regionId={regionId}
        />
      ) : null}
      {action.warnings.length > 0 ? (
        <BorrowNotice title="Review warnings">
          <ul className="list-disc space-y-1 pl-4">
            {action.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}
          </ul>
        </BorrowNotice>
      ) : null}
    </div>
  );
}

function LiquidationBufferMeter({
  healthFactorWad,
  liquidationPriceRaw,
  collateralSymbol,
  regionId,
  showHealth = false,
}: {
  healthFactorWad: string | null;
  liquidationPriceRaw: string | null;
  collateralSymbol: string;
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
    : `Bitcoin can fall ${formatBufferPercent(bps)} before liquidation`;
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
      {liquidationPriceRaw ? <p className="text-xs text-muted-foreground">Liquidation around {formatOracleUsd(liquidationPriceRaw, regionId)} per {collateralSymbol}</p> : null}
    </div>
  );
}

function BorrowOverviewLoading() {
  return <Card aria-busy="true"><CardContent><div className="space-y-3 py-5"><Skeleton className="h-5 w-36" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><span className="sr-only">Loading Borrow overview</span></div></CardContent></Card>;
}

function BorrowNotice({ action, children, role = "status", title, tone = "neutral", ...props }: Omit<ComponentProps<typeof Alert>, "children" | "title"> & { action?: ReactNode; children?: ReactNode; role?: "status" | "alert"; title?: ReactNode; tone?: "neutral" | "error" }) {
  return (
    <Alert role={role} variant={tone === "error" ? "destructive" : "default"} {...props}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}

function useBorrowOverview(session: VerifiedAccountSession | null, fetchAccountResource?: FetchAccountResource) {
  const owner = session?.smartAccount?.address ?? null;
  const key = session?.smartAccount ? ownerDataKey(session) : null;
  return useHomeQuery({
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
      if (!parsed) throw new Error("Borrow overview response is invalid.");
      return parsed;
    },
  });
}

function useBorrowDetail(session: VerifiedAccountSession | null, marketId: BorrowMarketId | null, fetchAccountResource: FetchAccountResource | undefined, enabled: boolean) {
  const owner = session?.smartAccount?.address ?? null;
  const key = session?.smartAccount ? ownerDataKey(session) : null;
  return useHomeQuery({
    queryKey: key && marketId ? ownerQueryKey(key, "borrow", "detail", marketId) : ["unauthenticated", "borrow-detail-disabled"],
    enabled: Boolean(enabled && marketId && key && owner && fetchAccountResource),
    staleTime: 15_000,
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
      const parsed = parseSnapshot(value, owner);
      if (!parsed) throw new Error("Borrow market response is invalid.");
      return parsed;
    },
  });
}

function formatToken(raw: string, asset: BorrowMarketIdentity["loanToken"], regionId: RegionId): string {
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

function openingCollateralForDecimalAmount(snapshot: BorrowMarketSnapshot, amount: string): string | null {
  try {
    return recommendedOpeningCollateralBaseUnits(snapshot, parseClientTokenAmount(amount, snapshot.market.loanToken.decimals));
  } catch {
    return null;
  }
}

function formatBufferPercent(bps: bigint): string {
  const tenths = (bps + BigInt(5)) / BigInt(10);
  const whole = tenths / BigInt(10);
  const fraction = tenths % BigInt(10);
  return fraction === BigInt(0) ? `${whole}%` : `${whole}.${fraction}%`;
}

function bufferCopy(healthFactorWad: string | null): string {
  const healthFactor = healthFactorWad === null ? null : BigInt(healthFactorWad);
  const bps = liquidationBufferBps(healthFactor);
  if (bps === null || healthFactor === null) return "No debt";
  return healthFactor <= WAD ? "Immediate liquidation risk" : `Bitcoin can fall ${formatBufferPercent(bps)}`;
}

export function borrowTeaserPositionDescription(position: BorrowOverviewPosition, regionId: RegionId): string {
  return BigInt(position.debtAssetsRaw) === BigInt(0)
    ? `No debt · ${formatToken(position.collateralRaw, position.market.collateralToken, regionId)} locked`
    : `${formatToken(position.debtAssetsRaw, position.market.loanToken, regionId)} borrowed · ${bufferCopy(position.healthFactorWad)}`;
}

export function parseClientTokenAmount(value: string, decimals: number): string {
  const normalized = value.trim().replace(/\.$/, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new BorrowActionClientError("Enter a positive decimal amount.");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new BorrowActionClientError(`This asset supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (amount <= BigInt(0)) throw new BorrowActionClientError("Amount must be greater than zero.");
  return amount.toString(10);
}

function preparedActionMatches(action: PreparedMoneyAction, session: VerifiedAccountSession, marketId: BorrowMarketId, kind: PreparedMoneyAction["kind"], operation: BorrowOperation): boolean {
  return Boolean(session.smartAccount && action.kind === kind && action.owner.subject === session.user.subject &&
    action.owner.accountProvider === session.accountProvider &&
    action.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    action.metadata?.product === "borrow" && action.metadata.operation === operation &&
    action.metadata.marketId.toLowerCase() === marketId.toLowerCase());
}

function readableResourceError(error: unknown): string {
  if (error instanceof BorrowActionClientError) return error.message;
  const code = errorCode(error);
  const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
  const serverMessage = isRecord(error) && typeof error.serverMessage === "string" ? error.serverMessage : null;
  const policyStatus: Record<string, number> = { LIMIT_EXCEEDED: 409, INVALID_INPUT: 400, UNSUPPORTED_MARKET: 400, SIMULATION_FAILED: 400 };
  if (code && policyStatus[code] === status) {
    if (serverMessage && isSafePrepareMessage(serverMessage)) return `${serverMessage} No transaction was submitted.`;
    if (code === "INVALID_INPUT") return "Enter valid positive amounts for this Borrow action. No transaction was submitted.";
    if (code === "LIMIT_EXCEEDED") return "That amount exceeds the current verified wallet, position, liquidity, or Home policy limit. No transaction was submitted.";
    if (code === "UNSUPPORTED_MARKET") return "This Borrow market no longer has a verified supported action route. No transaction was submitted.";
    return "The Base simulation could not verify this Borrow action. No transaction was submitted.";
  }
  return "Borrow action preparation is temporarily unavailable. No transaction was submitted.";
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

function isFullRepayAmount(amount: string, debtBaseUnits: string, maximumRepayBaseUnits: string | null, decimals: number): boolean {
  if (!maximumRepayBaseUnits || BigInt(maximumRepayBaseUnits) < BigInt(debtBaseUnits)) return false;
  try {
    return BigInt(parseClientTokenAmount(amount, decimals)) >= BigInt(debtBaseUnits);
  } catch {
    return false;
  }
}

export function selectUrgentBorrowPosition(positions: BorrowOverviewPosition[]): BorrowOverviewPosition | null {
  const urgency: Record<ReturnType<typeof borrowRiskState>, number> = {
    liquidatable: 0,
    urgent: 1,
    "limited-buffer": 2,
    healthy: 3,
    "no-debt": 4,
  };
  return positions.slice().sort((a, b) => urgency[borrowRiskState(a.healthFactorWad)] - urgency[borrowRiskState(b.healthFactorWad)] || a.market.rank - b.market.rank)[0] ?? null;
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === "string" ? error.code : null;
}

function isSafePrepareMessage(message: string): boolean {
  return message.length > 0 && message.length <= 240 && !/[<>]/.test(message) && !/https?:\/\//i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class BorrowActionClientError extends Error {}
