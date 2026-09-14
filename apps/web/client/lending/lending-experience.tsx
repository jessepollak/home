"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
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
import { browserHomeQueryClient, ownerQueryKey, ownerQueryMeta, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyMark } from "@/components/currency-mark";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import type { RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { formatExactPresentationTokenAmount, formatPresentationTokenAmount, formatWadPercent } from "@/shared/formatting";
import {
  parseLendingMarketDetailEnvelopeResponse,
  parseLendingOverviewResponse,
  type LendingMarketDetailResponse,
  type LendingMarketIdentity,
  type LendingOpportunity,
  type LendingOverview,
  type LendingPosition,
} from "@/shared/lending/contract";
import type { LendOperation } from "@/shared/lending/types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { MorphoMarketId } from "@/shared/morpho-markets/config";

const operationLabels: Record<"supply" | "withdraw", string> = { supply: "Lend", withdraw: "Withdraw" };
type FetchAccountResource = AccountWalletClient["fetchAccountResource"];
type LendDialogState = { operation: "supply" | "withdraw"; detail: LendingMarketDetailResponse } | null;

export function AuthenticatedLendTeaser({ onOpen, regionId = "GLOBAL" }: { onOpen: () => void; regionId?: RegionId }) {
  const account = useAccountWallet();
  const session = account.status === "verified" ? account.session : null;
  const overview = useLendingOverview(session, account.fetchAccountResource);
  const position = overview.data?.positions.slice().sort((a, b) => a.market.rank - b.market.rank)[0] ?? null;
  const opportunity = overview.data?.opportunities.slice().sort((a, b) => a.market.rank - b.market.rank)[0] ?? null;
  const description = position
    ? `${formatToken(position.suppliedAssetsRaw, position.market, regionId)} supplied`
    : opportunity?.availability.status === "available"
      ? `${formatWadPercent(opportunity.availability.state.supplyAprWad, regionId)} variable rate`
      : "Direct variable-rate lending on Base";
  return (
    <ItemGroup className="gap-0">
      <Item className="min-h-16 flex-nowrap cursor-pointer items-center whitespace-normal border-0 text-left hover:bg-muted" render={<Button variant="ghost" type="button" />} onClick={onOpen}>
        <LoanAssetMark decorative symbol={opportunity?.market.loanToken.symbol ?? position?.market.loanToken.symbol ?? "USDC"} />
        <ItemContent className="min-w-0"><ItemTitle>Lend</ItemTitle><ItemDescription>{overview.isPending ? "Loading lending markets…" : description}</ItemDescription></ItemContent>
        <ItemActions className="shrink-0"><ArrowRight className="size-4" aria-hidden="true" /></ItemActions>
      </Item>
    </ItemGroup>
  );
}

export function AuthenticatedLendExperience({ regionId = "GLOBAL" }: { regionId?: RegionId }) {
  const account = useAccountWallet();
  return <LendExperience session={account.status === "verified" ? account.session : null} fetchAccountResource={account.fetchAccountResource} prepareMoneyAction={account.prepareMoneyAction} executeMoneyAction={account.executeMoneyAction} regionId={regionId} />;
}

export function LendExperience({ session, fetchAccountResource, prepareMoneyAction, executeMoneyAction, regionId = "GLOBAL" }: {
  session: VerifiedAccountSession | null;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
  regionId?: RegionId;
}) {
  const sessionKey = session?.smartAccount ? ownerDataKey(session) : "signed-out";
  return <LendExperienceInner key={sessionKey} session={session} fetchAccountResource={fetchAccountResource} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} regionId={regionId} />;
}

function LendExperienceInner({ session, fetchAccountResource, prepareMoneyAction, executeMoneyAction, regionId }: {
  session: VerifiedAccountSession | null;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
  regionId: RegionId;
}) {
  const overview = useLendingOverview(session, fetchAccountResource);
  return (
    <section className="space-y-4" aria-labelledby="lend-overview-title">
      <div className="space-y-1"><h2 className="text-2xl font-semibold tracking-tight" id="lend-overview-title">Lend</h2><p className="text-sm text-muted-foreground">Earn a variable rate by lending your dollars directly on Base.</p></div>
      {!session?.smartAccount ? <LendNotice title="Sign in to view Lend" /> : null}
      {session?.smartAccount && overview.isPending ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-40 w-full" /><span className="sr-only">Loading lending markets</span></div> : null}
      {session?.smartAccount && overview.isError ? <LendNotice tone="error" role="alert" title="Lend is unavailable" action={<Button variant="secondary" onClick={() => void overview.refetch()}>Retry</Button>}>Current lending markets and positions could not be verified.</LendNotice> : null}
      {overview.data && session ? (
        overview.data.opportunities.length > 0
          ? <div className="space-y-3" role="list" aria-label="Lending markets">{overview.data.opportunities.slice().sort((a, b) => a.market.rank - b.market.rank).map((opportunity) => <LendMarketCard key={opportunity.market.id} opportunity={opportunity} position={overview.data?.positions.find((entry) => entry.market.id === opportunity.market.id) ?? null} session={session} fetchAccountResource={fetchAccountResource} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} regionId={regionId} />)}</div>
          : <LendNotice title="No lending markets available">No verified direct lending market is currently configured.</LendNotice>
      ) : null}
    </section>
  );
}

function LendMarketCard({ opportunity, position, session, fetchAccountResource, prepareMoneyAction, executeMoneyAction, regionId }: {
  opportunity: LendingOpportunity; position: LendingPosition | null; session: VerifiedAccountSession; fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: AccountWalletClient["prepareMoneyAction"]; executeMoneyAction?: AccountWalletClient["executeMoneyAction"]; regionId: RegionId;
}) {
  const detail = useLendingDetail(session, opportunity.market.id, fetchAccountResource, opportunity.availability.status === "available" || Boolean(position));
  const [dialog, setDialog] = useState<LendDialogState>(null);
  const current = detail.data;
  const suppliedRaw = current?.lending.position.suppliedAssetsRaw ?? position?.suppliedAssetsRaw ?? "0";
  const withdrawableRaw = current?.lending.position.withdrawableAssetsRaw ?? position?.withdrawableAssetsRaw ?? "0";
  const sharesRaw = current?.lending.position.supplySharesRaw ?? position?.supplySharesRaw ?? "0";
  const hasPosition = BigInt(sharesRaw) > BigInt(0);
  const canSupply = Boolean(current?.lending.canSupply && BigInt(current.wallet.loanBalanceRaw) > BigInt(0));
  return (
    <Card className="overflow-hidden" data-testid="lend-market-card" role="listitem">
      <CardContent className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3"><LoanAssetMark symbol={opportunity.market.loanToken.symbol} /><div className="min-w-0"><h3 className="truncate text-base font-semibold">{opportunity.market.loanToken.name}</h3><p className="truncate text-sm text-muted-foreground">Direct lending · Base</p></div></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Variable rate" value={opportunity.availability.status === "available" ? formatWadPercent(opportunity.availability.state.supplyAprWad, regionId) : "—"} />
          <Metric label="Wallet" value={current ? formatToken(current.wallet.loanBalanceRaw, current.market, regionId) : "—"} />
          <Metric label="Supplied" value={hasPosition ? formatToken(suppliedRaw, opportunity.market, regionId) : "—"} />
          <Metric label="Withdrawable" value={hasPosition ? formatToken(withdrawableRaw, opportunity.market, regionId) : "—"} />
        </div>
        {opportunity.availability.status === "unavailable" ? <LendNotice tone="error" role="alert" title="Market currently unavailable">{opportunity.availability.reason}</LendNotice> : null}
        {detail.isPending && detail.isFetching && !current ? <div aria-busy="true"><Skeleton className="h-10 w-full" /><span className="sr-only">Loading wallet lending balance</span></div> : null}
        {detail.isError && !current && opportunity.availability.status === "available" ? <LendNotice tone="error" role="alert" title="Wallet values unavailable" action={<Button variant="secondary" onClick={() => void detail.refetch()}>Retry</Button>}>Your wallet and current withdrawal values could not be verified.</LendNotice> : null}
        {opportunity.availability.status === "available" && hasPosition && BigInt(withdrawableRaw) === BigInt(0) ? <LendNotice title="Withdrawals are temporarily unavailable">Your position remains supplied, but this market has no liquid dollars available right now.</LendNotice> : null}
        {current && (current.lending.mode === "reducing-only" || !current.lending.canSupply) ? <p className="text-sm text-muted-foreground">{current.lending.reason ?? "New lending is paused. You can still withdraw available funds."}</p> : null}
        {current && prepareMoneyAction && executeMoneyAction ? <div className="grid grid-cols-2 gap-2" role="group" aria-label="Manage lending position">
          <Button className="min-h-11 w-full" disabled={!canSupply} onClick={() => setDialog({ operation: "supply", detail: current })}>{hasPosition ? "Lend more" : "Lend"}</Button>
          <Button className="min-h-11 w-full" variant="secondary" disabled={!hasPosition} onClick={() => setDialog({ operation: "withdraw", detail: current })}>Withdraw</Button>
        </div> : null}
      </CardContent>
      {dialog && prepareMoneyAction && executeMoneyAction ? <LendMoneyDialog key={`${dialog.detail.market.id}:${dialog.operation}`} session={session} detail={dialog.detail} operation={dialog.operation} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} regionId={regionId} onClose={() => setDialog(null)} /> : null}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="overflow-x-auto whitespace-nowrap font-semibold tabular-nums"><MoneyTicker value={value} reserveDigits={false} /></p></div>; }
function LoanAssetMark({ decorative = false, symbol }: { decorative?: boolean; symbol: string }) { return <span className="flex size-10 shrink-0 items-center justify-center [&_[data-mark]]:size-10" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `${symbol} icon` })}><CurrencyMark currency={symbol === "USDC" ? "USD" : null} symbol={symbol} /></span>; }

function LendMoneyDialog({ session, detail, operation, prepareMoneyAction, executeMoneyAction, regionId, onClose }: {
  session: VerifiedAccountSession; detail: LendingMarketDetailResponse; operation: "supply" | "withdraw";
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"]; executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  regionId: RegionId; onClose: () => void;
}) {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const dataOwnerKey = ownerDataKey(session);
  const [amount, setAmount] = useState("");
  const [amountChangeSource, setAmountChangeSource] = useState<MoneyAmountChangeSource>("programmatic");
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [serverExpiredActionId, setServerExpiredActionId] = useState<string | null>(null);
  const [step, setStep] = useState<"amount" | "confirm" | "pending" | "error" | "failed">("amount");
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const availableRaw = operation === "supply" ? detail.wallet.loanBalanceRaw : detail.lending.position.withdrawableAssetsRaw;
  const dustCleanup = operation === "withdraw" && BigInt(detail.lending.position.supplySharesRaw) > BigInt(0) && BigInt(detail.lending.position.suppliedAssetsRaw) === BigInt(0);
  const availableAmount = decimalFromBaseUnits(availableRaw, detail.market.loanToken.decimals);
  const pricing = useMoneyAssetPricing(detail.market.loanToken.symbol);
  const expiresAt = preparedAction ? Date.parse(preparedAction.expiresAt) : Number.POSITIVE_INFINITY;
  const expired = Boolean(preparedAction && (serverExpiredActionId === preparedAction.id || !Number.isFinite(expiresAt) || expiresAt <= now));
  useEffect(() => { if (!preparedAction || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return; const delay = expiresAt - Date.now() + 1; if (delay > 2_147_000_000) return; const timer = window.setTimeout(() => setNow(Date.now()), delay); return () => window.clearTimeout(timer); }, [expiresAt, preparedAction]);
  function changeAmount(value: string, source: MoneyAmountChangeSource) { setAmount(value); setAmountChangeSource(source); setError(null); }
  function goBack() { setPreparedAction(null); setServerExpiredActionId(null); setAttempted(false); setError(null); setStep("amount"); }
  function closeIfAllowed() { if (step === "pending") return false; onClose(); return true; }
  async function prepare() {
    try {
      const amountBaseUnits = dustCleanup ? null : parseTokenAmount(amount, detail.market.loanToken.decimals);
      const fullLiquidPosition = BigInt(detail.lending.position.suppliedAssetsRaw) <= BigInt(detail.lending.position.withdrawableAssetsRaw);
      const useWithdrawAll = operation === "withdraw" && (dustCleanup || (amountChangeSource === "programmatic" && fullLiquidPosition && amountBaseUnits === detail.lending.position.withdrawableAssetsRaw));
      const lendOperation: LendOperation = operation === "supply" ? "supply" : useWithdrawAll ? "withdraw-all" : "withdraw";
      setStep("pending"); setError(null);
      const action = await prepareMoneyAction(operation === "supply" ? "lend-supply" : "lend-withdraw", { marketId: detail.market.id, operation: lendOperation, ...(lendOperation === "withdraw-all" ? {} : { amountBaseUnits: amountBaseUnits! }) });
      if (!preparedActionMatches(action, session, detail.market.id, lendOperation)) throw new LendClientError("The prepared action did not match this verified account and lending market.");
      setPreparedAction(action); setServerExpiredActionId(null); setAttempted(false); setNow(Date.now()); setStep("confirm");
    } catch (caught) { setPreparedAction(null); setError(readableLendError(caught)); setStep("amount"); }
  }
  async function confirm() {
    if (!preparedAction || step === "pending") return;
    setError(null); setStep("pending");
    try {
      const result = await executeMoneyAction(preparedAction); setAttempted(true);
      if (result.status === "rejected" || result.status === "failed") { setError(result.status === "rejected" ? "The wallet request was rejected." : "The verified onchain receipt reported failure."); setStep(result.status === "failed" ? "failed" : "error"); return; }
      onClose(); void Promise.all([
        queryClient.invalidateQueries({ queryKey: ownerQueryKey(dataOwnerKey, "lend") }),
        queryClient.invalidateQueries({ queryKey: ownerQueryKey(dataOwnerKey, "borrow") }),
      ]);
    } catch (caught) {
      if (errorCode(caught) === "ACTION_EXPIRED") {
        setAttempted(false); setServerExpiredActionId(preparedAction.id);
        setError("This lending review expired. Go back and prepare it again.");
      } else {
        setAttempted(true);
        setError("The dispatch outcome is unresolved. Retry recording this same action; a new dispatch will not be created.");
      }
      setStep("confirm");
    }
  }
  return <MoneyModal open labelledBy="lend-action-title" describedBy={step === "pending" ? "lend-action-pending" : undefined} onCancel={closeIfAllowed} onClose={onClose}>
    <MoneyModalHeader title={step === "amount" ? operationLabels[operation] : "Confirm"} titleId="lend-action-title" onBack={step === "amount" || step === "pending" ? undefined : goBack} onClose={closeIfAllowed} closeDisabled={step === "pending"} closeLabel="Close Lend action" />
    <MoneyModalBody className="gap-4 pt-4">
      {step === "amount" ? dustCleanup ? <><MoneyConfirmSummary amount="Less than one base unit" lead="Withdraw remaining lending shares" rows={[{ label: "Network", value: "Base" }]} /><LendNotice title="Dust cleanup">The server will prepare a full share-based withdrawal. The received amount may round to zero.</LendNotice></> : <><MoneyAmountDisplay amount={amount} amountChangeSource={amountChangeSource} onAmountChange={changeAmount} availableLabel={`${formatToken(availableRaw, detail.market, regionId)} ${operation === "supply" ? "in wallet" : "available to withdraw"}`} availableAmount={availableAmount} assetId={detail.market.loanToken.id} assetLabel={detail.market.loanToken.symbol} assetCurrency={detail.market.loanToken.symbol === "USDC" ? "USD" : null} assetLocked chipSet="max" pricing={pricing} nativeSymbol={detail.market.loanToken.symbol} /><MoneyNumpad value={amount} maxDecimals={detail.market.loanToken.decimals} onChange={changeAmount} />{operation === "withdraw" && BigInt(availableRaw) === BigInt(0) ? <LendNotice tone="error" role="alert" title="No liquidity available">Your position is still yours. Try again when the market has liquid funds.</LendNotice> : null}</> : null}
      {preparedAction && step !== "amount" ? <LendPreparedReview action={preparedAction} detail={detail} regionId={regionId} /> : null}
      {step === "pending" ? <LendNotice id="lend-action-pending" title={<span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Waiting for your wallet…</span>} /> : null}
      {error ? <LendNotice tone="error" role="alert" title="Lend action unavailable">{error}</LendNotice> : null}
      {expired && !attempted && step === "confirm" && !error ? <LendNotice tone="error" role="alert" title="Lending review expired">Go back and prepare this action again.</LendNotice> : null}
    </MoneyModalBody>
    {step === "amount" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!dustCleanup && (!isPositiveDecimalAmount(amount) || BigInt(availableRaw) === BigInt(0))} onPrimary={() => void prepare()} /> : null}
    {step === "confirm" ? <MoneyModalFooter primaryLabel={attempted ? "Retry" : "Confirm action"} primaryDisabled={expired && !attempted} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={goBack} /> : null}
    {step === "error" || step === "failed" ? <MoneyModalFooter primaryLabel="Back" onPrimary={goBack} secondaryLabel="Close" onSecondary={closeIfAllowed} /> : null}
  </MoneyModal>;
}

function LendPreparedReview({ action, detail, regionId }: { action: PreparedMoneyAction; detail: LendingMarketDetailResponse; regionId: RegionId }) {
  const metadata = action.metadata?.product === "lend" ? action.metadata : null;
  const amountEntry = action.amounts[0];
  const amount = amountEntry ? `${amountEntry.estimated ? "Estimated " : ""}${formatExactPresentationTokenAmount(amountEntry.amountBaseUnits, amountEntry.decimals, amountEntry.symbol)}` : action.title;
  const full = metadata?.operation === "withdraw-all";
  return <div className="space-y-3"><MoneyConfirmSummary amount={amount} lead={full ? "Withdraw full lending position" : metadata?.operation === "withdraw" ? "Withdraw exact amount" : "Lend to this market"} rows={[{ label: amountEntry?.direction === "spend" ? "You lend" : full ? "Estimated receive" : "You receive", value: amount }, { label: "Variable rate", value: formatWadPercent(metadata?.supplyAprWad ?? detail.lending.state.supplyAprWad, regionId) }, { label: "Network", value: "Base" }]} />{action.warnings.length ? <LendNotice title="Rate and liquidity can change"><ul className="list-disc space-y-1 pl-4">{action.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul></LendNotice> : null}</div>;
}

function useLendingOverview(session: VerifiedAccountSession | null, fetchAccountResource?: FetchAccountResource) {
  const owner = session?.smartAccount?.address ?? null; const key = session?.smartAccount ? ownerDataKey(session) : null;
  return useHomeQuery({ queryKey: key ? ownerQueryKey(key, "lend", "overview") : ["unauthenticated", "lend-overview-disabled"], enabled: Boolean(key && owner && fetchAccountResource), staleTime: 15_000, retry: false, refetchOnWindowFocus: true, meta: key ? ownerQueryMeta(key, "owner") : undefined, queryFn: ({ signal }) => { if (!fetchAccountResource) throw new Error("Lend is unavailable."); return fetchAccountResource("/api/borrow", { signal }); }, select: (value): LendingOverview => { if (!owner) throw new Error("Lend is unavailable."); const parsed = parseLendingOverviewResponse(value, owner); if (!parsed) throw new Error("Lending overview response is invalid."); return parsed; } });
}
function useLendingDetail(session: VerifiedAccountSession, marketId: MorphoMarketId, fetchAccountResource: FetchAccountResource | undefined, enabled: boolean) {
  const owner = session.smartAccount?.address ?? null; const key = session.smartAccount ? ownerDataKey(session) : null;
  return useHomeQuery({ queryKey: key ? ownerQueryKey(key, "lend", "detail", marketId) : ["unauthenticated", "lend-detail-disabled", marketId], enabled: Boolean(enabled && key && owner && fetchAccountResource), staleTime: 15_000, retry: false, refetchOnWindowFocus: true, meta: key ? ownerQueryMeta(key, "owner") : undefined, queryFn: ({ signal }) => { if (!fetchAccountResource) throw new Error("Lend is unavailable."); return fetchAccountResource(`/api/borrow/markets/${marketId}`, { signal }); }, select: (value): LendingMarketDetailResponse => { if (!owner) throw new Error("Lend is unavailable."); const parsed = parseLendingMarketDetailEnvelopeResponse(value, owner); if (!parsed) throw new Error("Lending market response is invalid."); return parsed; } });
}
function formatToken(raw: string, market: LendingMarketIdentity, regionId: RegionId) { return formatPresentationTokenAmount(raw, market.loanToken.decimals, market.loanToken.symbol, { ...(market.loanToken.symbol === "USDC" ? { cashCurrency: "USD" as const } : {}), regionId, useNoBreakSpace: true }); }
function parseTokenAmount(value: string, decimals: number): string { const normalized = value.trim().replace(/\.$/, ""); if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new LendClientError("Enter a positive decimal amount."); const [whole, fraction = ""] = normalized.split("."); if (fraction.length > decimals) throw new LendClientError(`This asset supports at most ${decimals} decimal places.`); const amount = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0"); if (amount <= BigInt(0)) throw new LendClientError("Amount must be greater than zero."); return amount.toString(); }
function preparedActionMatches(action: PreparedMoneyAction, session: VerifiedAccountSession, marketId: MorphoMarketId, operation: LendOperation) { return Boolean(session.smartAccount && action.kind === (operation === "supply" ? "lend-supply" : "lend-withdraw") && action.owner.subject === session.user.subject && action.owner.accountProvider === session.accountProvider && action.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() && action.metadata?.product === "lend" && action.metadata.operation === operation && action.metadata.marketId.toLowerCase() === marketId.toLowerCase()); }
function readableLendError(error: unknown) { if (error instanceof LendClientError) return error.message; const code = errorCode(error); const serverMessage = isRecord(error) && typeof error.serverMessage === "string" ? error.serverMessage : null; if (serverMessage && serverMessage.length <= 240 && !/[<>]/.test(serverMessage)) return `${serverMessage} No transaction was submitted.`; if (code === "LEND_LIMIT_EXCEEDED") return "That amount exceeds the current wallet, supplied balance, or available market liquidity. Enter an available amount and try again. No transaction was submitted."; if (code === "LEND_UNSUPPORTED_MARKET") return "This market is not currently available for that lending action. No transaction was submitted."; if (code === "LEND_SIMULATION_FAILED") return "The Base simulation could not verify this lending action. No transaction was submitted."; if (code === "UNAUTHENTICATED") return "Your verified account changed. Sign in again before preparing this action."; return "Lending action preparation is temporarily unavailable. No transaction was submitted."; }
function errorCode(error: unknown) { return isRecord(error) && typeof error.code === "string" ? error.code : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
class LendClientError extends Error {}
function LendNotice({ action, children, role = "status", title, tone = "neutral", ...props }: Omit<ComponentProps<typeof Alert>, "children" | "title"> & { action?: ReactNode; children?: ReactNode; role?: "status" | "alert"; title?: ReactNode; tone?: "neutral" | "error" }) { return <Alert role={role} variant={tone === "error" ? "destructive" : "default"} {...props}>{title ? <AlertTitle>{title}</AlertTitle> : null}{children ? <AlertDescription>{children}</AlertDescription> : null}{action ? <AlertAction>{action}</AlertAction> : null}</Alert>; }
