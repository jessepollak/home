"use client";

import { type SendAvailability } from "@/client/home/send-availability";
import { MoneyTicker } from "@/components/money-ticker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { presentPortfolioAssetMark, type AssetMarkResolution } from "@/client/asset-mark/presentation";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode, useMemo } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { AddressField } from "@/components/address";
import { FieldSeparator } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { CopyableValue } from "@/components/copyable-value";
import { PayoutMethodMarks } from "@/components/payout-method-marks";
import { atomicToDecimal } from "@/shared/formatting/atomic";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { RegionId } from "@/config/regions";
import { readProviderBindings, type FundingOfframpBinding } from "@/shared/funding/contracts/providers";
import { readCashoutOrdersResponse, type CashoutOrderSummary } from "@/shared/funding/contracts/offramp-orders";
import { canonicalizeCashPayee } from "@/shared/funding/cash-payee";
import {
  MoneyAmountDisplay,
  MoneyConfirmSummary,
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
  type MoneyAmountChangeSource,
} from "@/client/money-modal";
import {
  assertTransferRequest,
  formatSendConfirmAmount,
  getTransferAsset,
  isTransferRecipient,
  normalizeTransferRecipient,
  parseTransferAmount,
  transferRequestFromAction,
} from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError, type TransferRequest } from "@/shared/transfers/types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

type SendStep = "amount" | "destination" | "payout" | "handle" | "handle-confirm" | "confirm" | "pending" | "error";
type CashoutRequest = {
  operation: "deposit" | "withdraw";
  providerId: string;
  providerName: string;
  assetId: string;
  symbol: string;
  decimals: number;
  amountBaseUnits: string;
  platform: string;
  platformLabel: string;
  currency: string;
  payoutHandle: string;
  canonicalHandle: string | null;
  approximateFiatAmount: string;
  etaSeconds: number | null;
  depositId?: string;
};
export function SendDialog({
  open,
  address,
  availableAssets,
  assetMarkResolution,
  prepareMoneyAction,
  fetchAccountResource,
  resumeMoneyAction,
  executeMoneyAction,
  ownerBoundary,
  regionId = "US",
  immediate = false,
  resumeActionId = null,
  onReview,
  onInvalidResume,
  onClose,
  onClosed,
}: {
  open: boolean;
  address: `0x${string}` | null;
  availableAssets?: SendAvailability;
  assetMarkResolution?: AssetMarkResolution;
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  resumeMoneyAction: AccountWalletClient["resumeMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  ownerBoundary: string | null;
  regionId?: RegionId;
  resumeActionId?: string | null;
  immediate?: boolean;
  onReview?: (actionId: string) => void;
  onInvalidResume?: () => void;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const [assetId, setAssetId] = useState<string | null>(() => availableAssets?.[0]?.id ?? null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [amountChangeSource, setAmountChangeSource] = useState<MoneyAmountChangeSource>("programmatic");
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [cashout, setCashout] = useState<CashoutRequest | null>(null);
  const [offramps, setOfframps] = useState<ReadonlyArray<FundingOfframpBinding>>([]);
  const [providersLoadedFor, setProvidersLoadedFor] = useState<string | null>(null);
  const [activeOrders, setActiveOrders] = useState<ReadonlyArray<CashoutOrderSummary>>([]);
  const [ordersLoadedFor, setOrdersLoadedFor] = useState<string | null>(null);
  const [recoveryEligible, setRecoveryEligible] = useState(false);
  const [recoveryAttemptedFor, setRecoveryAttemptedFor] = useState<string | null>(null);
  const [selectedOfframp, setSelectedOfframp] = useState<FundingOfframpBinding | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<FundingOfframpBinding["paymentMethods"][number] | null>(null);
  const [payoutHandle, setPayoutHandle] = useState("");
  const [canonicalHandle, setCanonicalHandle] = useState("");
  const [handleConfirmation, setHandleConfirmation] = useState("");
  const [action, setAction] = useState<PreparedMoneyAction | null>(null);
  const [step, setStep] = useState<SendStep>("amount");
  const [error, setError] = useState<string | null>(null);
  const resumedActionRef = useRef<string | null>(null);
  const selectedStillAvailable = !assetId || availableAssets?.some((asset) => asset.id === assetId) !== false;
  const activeAssetId = assetId && selectedStillAvailable ? assetId : availableAssets?.[0]?.id ?? null;
  function changeAmount(value: string, source: MoneyAmountChangeSource) { setAmountChangeSource(source); setAmount(value); }

  if (assetId && !selectedStillAvailable) {
    setAssetId(activeAssetId);
    if (amount !== "") changeAmount("", "programmatic");
  }
  const selectedAsset = activeAssetId ? getTransferAsset(activeAssetId) : null;
  const pricing = useMoneyAssetPricing(selectedAsset?.symbol ?? "");
  const selectedAvailability = availableAssets?.find((asset) => asset.id === activeAssetId);
  const resourceBoundary = `${ownerBoundary ?? ""}:${regionId}`;
  const providersLoaded = providersLoadedFor === resourceBoundary;
  const ordersLoaded = ordersLoadedFor === resourceBoundary;
  const eligibleOfframps = (providersLoaded ? offramps : []).filter((binding) => selectedAsset?.symbol === "USDC" && binding.assetId === "base:usdc");
  const visibleActiveOrders = ordersLoaded ? activeOrders : [];
  const recoveryAttempted = recoveryAttemptedFor === resourceBoundary;
  const assetOptions = useMemo(() => availableAssets?.map((asset) => ({
    id: asset.id, label: asset.symbol, description: asset.name, currency: asset.cashCurrency,
    mark: presentPortfolioAssetMark({ assetKey: asset.assetKey, name: asset.name, symbol: asset.symbol, currency: asset.cashCurrency }, assetMarkResolution),
  })) ?? [], [assetMarkResolution, availableAssets]);

  useEffect(() => {
    if (!open || !ownerBoundary || !fetchAccountResource) return;
    let cancelled = false;
    const requestedBoundary = resourceBoundary;
    void fetchAccountResource(`/api/funding/providers?region=${encodeURIComponent(regionId)}&direction=offramp`)
      .then((value) => { if (!cancelled) setOfframps(readProviderBindings(value).filter((binding): binding is FundingOfframpBinding => binding.direction === "offramp")); })
      .catch(() => { if (!cancelled) setOfframps([]); })
      .finally(() => { if (!cancelled) setProvidersLoadedFor(requestedBoundary); });
    return () => { cancelled = true; };
  }, [fetchAccountResource, open, ownerBoundary, regionId, resourceBoundary]);

  useEffect(() => {
    if (!open || !ownerBoundary || !fetchAccountResource) return;
    let cancelled = false;
    const requestedBoundary = resourceBoundary;
    void fetchAccountResource(`/api/funding/offramp/orders?region=${encodeURIComponent(regionId)}&inFlight=1`)
      .then((value) => {
        if (cancelled) return;
        const response = readCashoutOrdersResponse(value);
        setActiveOrders(response.orders);
        setRecoveryEligible(response.recoveryEligible);
      })
      .catch(() => {
        if (!cancelled) {
          setActiveOrders([]);
          setRecoveryEligible(false);
        }
      })
      .finally(() => { if (!cancelled) setOrdersLoadedFor(requestedBoundary); });
    return () => { cancelled = true; };
  }, [fetchAccountResource, open, ownerBoundary, regionId, resourceBoundary]);

  useEffect(() => {
    if (!open || !ownerBoundary || !resumeActionId || resumedActionRef.current === resumeActionId) return;
    resumedActionRef.current = resumeActionId;
    let cancelled = false;
    setStep("pending"); setError(null);
    void resumeMoneyAction(resumeActionId).then((resumed) => {
      if (cancelled) return;
      if (resumed.kind === "send") {
        const nextRequest = transferRequestFromAction(resumed);
        if (!nextRequest) throw new TransferExecutionError("unavailable");
        setAssetId(nextRequest.assetId); setRecipient(nextRequest.recipient); setRequest(nextRequest); setCashout(null);
      } else if (resumed.kind === "cash-out" && resumed.metadata?.product === "cashout" && resumed.metadata.operation === "deposit") {
        const spent = resumed.amounts.find((item) => item.direction === "spend");
        if (!spent) throw new TransferExecutionError("unavailable");
        const metadata = resumed.metadata;
        setRequest(null);
        setCashout({
          operation: "deposit", providerId: metadata.providerId, providerName: metadata.providerName, assetId: spent.assetId,
          symbol: spent.symbol, decimals: spent.decimals, amountBaseUnits: spent.amountBaseUnits,
          platform: metadata.platform, platformLabel: metadata.platformLabel, currency: metadata.currency,
          payoutHandle: metadata.canonicalHandle, canonicalHandle: metadata.canonicalHandle,
          approximateFiatAmount: metadata.approximateFiatAmount, etaSeconds: metadata.etaSeconds ?? null,
        });
      } else if (resumed.kind === "cash-out-withdraw" && resumed.metadata?.product === "cashout" && resumed.metadata.operation === "withdraw") {
        const received = resumed.amounts.find((item) => item.direction === "receive");
        if (!received) throw new TransferExecutionError("unavailable");
        const metadata = resumed.metadata;
        setRequest(null);
        setCashout({
          operation: "withdraw", providerId: metadata.providerId, providerName: metadata.providerName, assetId: received.assetId,
          symbol: received.symbol, decimals: received.decimals, amountBaseUnits: received.amountBaseUnits,
          platform: metadata.platform, platformLabel: metadata.platformLabel, currency: metadata.currency,
          payoutHandle: "", canonicalHandle: null, approximateFiatAmount: "0", etaSeconds: null, depositId: metadata.depositId,
        });
      } else throw new TransferExecutionError("unavailable");
      setAction(resumed); setStep("confirm");
    }).catch(() => {
      if (cancelled) return;
      setRequest(null); setCashout(null); setAction(null); setStep("amount"); onInvalidResume?.();
    });
    return () => { cancelled = true; };
  }, [availableAssets, onInvalidResume, open, ownerBoundary, resumeActionId, resumeMoneyAction]);

  function reset() {
    setAssetId(availableAssets?.[0]?.id ?? null); setRecipient(""); changeAmount("", "programmatic");
    setRequest(null); setCashout(null); setSelectedOfframp(null); setSelectedPlatform(null); setPayoutHandle("");
    setCanonicalHandle(""); setHandleConfirmation(""); setAction(null); setStep("amount"); setError(null);
  }
  function close() { onClose(); }
  function back() {
    setError(null);
    if (step === "destination") setStep("amount");
    else if (step === "payout") setStep("destination");
    else if (step === "handle") setStep("payout");
    else if (step === "handle-confirm") setStep("handle");
    else if (step === "confirm" || step === "error") {
      setAction(null);
      setStep(cashout?.operation === "withdraw" ? "destination" : cashout ? "handle-confirm" : "destination");
    }
  }

  async function recoverCashouts() {
    if (!fetchAccountResource) return;
    setRecoveryAttemptedFor(resourceBoundary);
    setOrdersLoadedFor(null);
    try {
      const value = await fetchAccountResource(`/api/funding/offramp/orders?region=${encodeURIComponent(regionId)}&inFlight=1&recover=1`);
      const response = readCashoutOrdersResponse(value);
      setActiveOrders(response.orders);
      setRecoveryEligible(response.recoveryEligible);
    } catch {
      setActiveOrders([]);
    } finally {
      setOrdersLoadedFor(resourceBoundary);
    }
  }

  async function prepareSend() {
    try {
      if (!address || !selectedAsset || !activeAssetId) throw new TransferExecutionError("unavailable");
      const next: TransferRequest = { assetId: activeAssetId, recipient: normalizeTransferRecipient(recipient), amountBaseUnits: parseTransferAmount(amount.replace(/\.$/, ""), selectedAsset.decimals) };
      assertTransferRequest(next); setRequest(next); setCashout(null); setStep("pending"); setError(null);
      const prepared = await prepareMoneyAction("send", next);
      setAction(prepared); onReview?.(prepared.id); setStep("confirm");
    } catch {
      setError("Enter a valid Base address and positive amount, then try again."); setStep("destination");
    }
  }

  async function prepareCashout() {
    try {
      if (!selectedAsset || !selectedOfframp || !selectedPlatform || !canonicalHandle || handleConfirmation !== canonicalHandle) throw new Error("invalid");
      const amountBaseUnits = parseTransferAmount(amount.replace(/\.$/, ""), selectedAsset.decimals);
      setStep("pending"); setError(null);
      const prepared = await prepareMoneyAction("cash-out", {
        providerId: selectedOfframp.providerId, region: regionId, assetId: selectedOfframp.assetId,
        amountBaseUnits, platform: selectedPlatform.platform, currency: selectedOfframp.currency,
        payoutHandle, canonicalHandleConfirmation: handleConfirmation,
      });
      if (prepared.kind !== "cash-out" || prepared.metadata?.product !== "cashout" || prepared.metadata.operation !== "deposit") throw new Error("invalid");
      const metadata = prepared.metadata;
      const spent = prepared.amounts.find((item) => item.direction === "spend");
      if (!spent) throw new Error("invalid");
      setCashout({
        operation: "deposit", providerId: selectedOfframp.providerId, providerName: selectedOfframp.displayName, assetId: spent.assetId,
        symbol: spent.symbol, decimals: spent.decimals, amountBaseUnits: spent.amountBaseUnits,
        platform: selectedPlatform.platform, platformLabel: selectedPlatform.label, currency: selectedOfframp.currency,
        payoutHandle, canonicalHandle: metadata.canonicalHandle, approximateFiatAmount: metadata.approximateFiatAmount, etaSeconds: metadata.etaSeconds ?? null,
      });
      setRequest(null); setAction(prepared); onReview?.(prepared.id); setStep("confirm");
    } catch (caught) {
      setError(serverCashoutMessage(caught)); setStep("handle-confirm");
    }
  }

  async function prepareWithdraw(order: CashoutOrderSummary) {
    try {
      if (!order.nextActions.includes("withdraw")) throw new Error("invalid");
      setStep("pending"); setError(null);
      const prepared = await prepareMoneyAction("cash-out-withdraw", { providerId: order.providerId, region: regionId, depositId: order.depositId });
      if (prepared.kind !== "cash-out-withdraw" || prepared.metadata?.product !== "cashout" || prepared.metadata.operation !== "withdraw") throw new Error("invalid");
      const received = prepared.amounts.find((item) => item.direction === "receive");
      if (!received) throw new Error("invalid");
      setCashout({
        operation: "withdraw", providerId: order.providerId, providerName: order.providerName, assetId: received.assetId,
        symbol: received.symbol, decimals: received.decimals, amountBaseUnits: received.amountBaseUnits,
        platform: order.platform, platformLabel: order.platformLabel,
        currency: order.currency, payoutHandle: order.canonicalHandle ?? "", canonicalHandle: order.canonicalHandle,
        approximateFiatAmount: "0", etaSeconds: null, depositId: order.depositId,
      });
      setRequest(null); setAction(prepared); onReview?.(prepared.id); setStep("confirm");
    } catch (caught) {
      setError(serverCashoutMessage(caught)); setStep("destination");
    }
  }

  async function confirm() {
    if (!action || (!request && !cashout)) return;
    setStep("pending"); setError(null);
    try {
      const result = await executeMoneyAction(action);
      if (result.status === "rejected") {
        setError(cashout
          ? "The wallet request was rejected. Your reviewed cash-out is still ready to retry."
          : "The wallet request was rejected. Your reviewed send is still ready to retry.");
        setStep("error");
        return;
      }
      if (result.status === "failed") {
        setError("The wallet could not submit this action. Your review is still ready to retry.");
        setStep("error");
        return;
      }
      reset(); onClose();
    } catch (caught) {
      if (isUnavailableReview(caught)) {
        reset(); setError("This review is no longer available — start again."); onInvalidResume?.(); return;
      }
      setError(messageForError(caught, Boolean(cashout))); setStep("error");
    }
  }

  const confirmAmount = request ? formatSendConfirmAmount(request.amountBaseUnits, request.assetId)
    : cashout ? `${atomicToDecimal(cashout.amountBaseUnits, cashout.decimals)} ${cashout.symbol}` : "";
  const requestAsset = request ? getTransferAsset(request.assetId) : selectedAsset;
  const offrampName = cashout?.providerName ?? selectedOfframp?.displayName;
  const modalTitle = step === "confirm" || step === "pending" || step === "error" ? "Confirm" : cashout || ["payout", "handle", "handle-confirm"].includes(step) ? `Cash out${offrampName ? ` with ${offrampName}` : ""}` : "Send";
  return (
    <MoneyModal open={open} labelledBy="send-title" immediate={immediate} onCancel={close} onClose={() => { reset(); (onClosed ?? onClose)(); }}>
      <MoneyModalHeader title={modalTitle} titleId="send-title" onBack={step === "amount" || step === "pending" ? undefined : back} onClose={close} closeDisabled={step === "pending"} closeLabel="Close send dialog" />
      <MoneyModalBody className="gap-4 pt-4">
        {step === "amount" ? <>
          <MoneyAmountDisplay amount={amount} amountChangeSource={amountChangeSource} onAmountChange={changeAmount} availableLabel={selectedAvailability ? `${selectedAvailability.balanceLabel} available` : undefined} availableAmount={selectedAvailability ? atomicToDecimal(selectedAvailability.balanceBaseUnits, selectedAvailability.decimals) : null} availableSuffix={selectedAvailability?.balanceAgeLabel} assetId={activeAssetId ?? undefined} assetLabel={selectedAsset?.symbol} assetCurrency={selectedAsset?.cashCurrency} assetOptions={assetOptions} onAssetChange={(next) => { setAssetId(next); changeAmount("", "programmatic"); }} chipSet={pricing.status === "priced" ? "quick-local" : "none"} pricing={pricing} nativeSymbol={selectedAsset?.symbol ?? ""} />
          {selectedAsset ? <MoneyNumpad value={amount} maxDecimals={selectedAsset.decimals} onChange={changeAmount} /> : <StatusMessage>No catalog balance is available to send.</StatusMessage>}
          {!selectedAsset && visibleActiveOrders.length > 0 ? <div className="grid gap-1">{visibleActiveOrders.map((order) => <RecoveryItem key={order.depositId} order={order} onWithdraw={() => void prepareWithdraw(order)} />)}</div> : null}
          {!selectedAsset && providersLoaded && ordersLoaded && recoveryEligible && !recoveryAttempted && visibleActiveOrders.length === 0 ? <Button variant="ghost" size="sm" onClick={() => void recoverCashouts()}>Recover a Peer cash-out</Button> : null}
        </> : null}
        {step === "destination" ? <div className="grid gap-4">
          <AddressField id="send-recipient" label="To" value={recipient} onChange={setRecipient} />
          <FieldSeparator>Or</FieldSeparator>
          <div className="grid gap-1">
            {visibleActiveOrders.map((order) => <RecoveryItem key={order.depositId} order={order} onWithdraw={() => void prepareWithdraw(order)} />)}
            {eligibleOfframps.length > 0 ? <CashoutItem binding={eligibleOfframps[0]!} onSelect={() => { setSelectedOfframp(eligibleOfframps[0]!); setStep("payout"); }} /> : null}
            {providersLoaded && ordersLoaded && recoveryEligible && !recoveryAttempted && visibleActiveOrders.length === 0 ? <Button variant="ghost" size="sm" onClick={() => void recoverCashouts()}>Recover a Peer cash-out</Button> : null}
          </div>
        </div> : null}
        {step === "payout" && selectedOfframp ? <div className="grid gap-2">
          {selectedOfframp.paymentMethods.map((method) => <Button key={method.id} variant="outline" onClick={() => { setSelectedPlatform(method); setStep("handle"); }}>{method.label}</Button>)}
        </div> : null}
        {step === "handle" && selectedPlatform ? <div className="grid gap-2">
          <Label htmlFor="peer-payout-handle">{selectedPlatform.label} handle</Label>
          <Input id="peer-payout-handle" value={payoutHandle} onInput={(event) => setPayoutHandle(event.currentTarget.value)} placeholder={selectedPlatform.handleHint} />
        </div> : null}
        {step === "handle-confirm" && selectedPlatform ? <div className="grid gap-2">
          <StatusMessage>Confirm the payout handle exactly: <strong>{canonicalHandle}</strong></StatusMessage>
          <Label htmlFor="peer-payout-confirmation">Re-enter handle</Label>
          <Input id="peer-payout-confirmation" value={handleConfirmation} onInput={(event) => setHandleConfirmation(event.currentTarget.value)} />
        </div> : null}
        {(request || cashout) && (!request || requestAsset) && (step === "confirm" || step === "pending" || step === "error") ? <>
          <MoneyConfirmSummary amount={confirmAmount} lead={cashout ? (cashout.operation === "withdraw" ? `You're withdrawing from ${cashout.providerName}` : `You're cashing out with ${cashout.providerName}`) : `You're sending ${requestAsset?.symbol ?? ""}`} rows={cashout ? [
            { label: "Provider", value: cashout.providerName },
            { label: "Payout app", value: cashout.platformLabel },
            ...(cashout.canonicalHandle ? [{ label: "Payout handle", value: cashout.canonicalHandle }] : []),
            ...(cashout.operation === "deposit" ? [
              { label: "Approximate receive", value: `≈ ${cashout.approximateFiatAmount} ${cashout.currency}` },
              { label: "Estimated delivery", value: cashout.etaSeconds === null ? "Historical estimate unavailable" : `About ${formatEta(cashout.etaSeconds)}` },
            ] : []),
            { label: "Network", value: "Base" },
          ] : [
            { label: "To", value: <CopyableValue value={request!.recipient} presentation="full" valueKind="address" className="sm:justify-end" />, fullValue: true },
            { label: "Asset", value: requestAsset?.symbol ?? "" }, { label: "Network", value: "Base" },
          ]} />
          {cashout ? <StatusMessage>The fiat amount and delivery time are approximate, not guaranteed.</StatusMessage> : null}
          {step === "pending" ? <StatusMessage><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Waiting for your wallet…</span></StatusMessage> : null}
        </> : null}
        {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
      </MoneyModalBody>
      {step === "amount" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!selectedAsset || !isPositiveDecimalAmount(amount)} onPrimary={() => { setError(null); setStep("destination"); }} /> : null}
      {step === "destination" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!isTransferRecipient(recipient)} onPrimary={() => void prepareSend()} /> : null}
      {step === "handle" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!payoutHandle.trim()} onPrimary={() => { const normalized = canonicalizeCashPayee(selectedPlatform?.platform ?? "", payoutHandle); setCanonicalHandle(normalized); setHandleConfirmation(""); setStep("handle-confirm"); }} /> : null}
      {step === "handle-confirm" ? <MoneyModalFooter primaryLabel="Review" primaryDisabled={!canonicalHandle || handleConfirmation !== canonicalHandle} onPrimary={() => void prepareCashout()} /> : null}
      {step === "confirm" ? <MoneyModalFooter primaryLabel={cashout ? <>{cashout.operation === "withdraw" ? "Withdraw" : "Cash out"} <MoneyTicker value={confirmAmount} /></> : <>Send <MoneyTicker value={confirmAmount} /></>} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={back} /> : null}
      {step === "error" ? <MoneyModalFooter primaryLabel="Try again" onPrimary={() => { setError(null); setStep("confirm"); }} secondaryLabel="Back" onSecondary={back} /> : null}
    </MoneyModal>
  );
}

function CashoutItem({ binding, onSelect }: { binding: FundingOfframpBinding; onSelect: () => void }) {
  return <Item
    render={<Button variant="ghost" />}
    className="flex-nowrap items-center text-left"
    onClick={onSelect}
  >
    <ItemMedia><PayoutMethodMarks methods={binding.paymentMethods} /></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle>Send to Zelle, Venmo, Cash App and more</ItemTitle>
      <ItemDescription lines={1}>Use Peer to send via app</ItemDescription>
    </ItemContent>
    <ItemActions aria-hidden="true"><ChevronRight className="size-4 text-muted-foreground" /></ItemActions>
  </Item>;
}

function RecoveryItem({ order, onWithdraw }: { order: CashoutOrderSummary; onWithdraw: () => void }) {
  const amount = `${atomicToDecimal(order.remainingAmountAtomic, order.assetDecimals)} ${order.assetSymbol}`;
  return <Item
    render={<Button variant="ghost" />}
    className="flex-nowrap items-center text-left"
    onClick={onWithdraw}
  >
    <ItemContent className="min-w-0">
      <ItemTitle>{`Withdraw ${amount}`}</ItemTitle>
      <ItemDescription lines={1}>{`${order.providerName} cash-out · ${order.state}`}</ItemDescription>
    </ItemContent>
    <ItemActions aria-hidden="true"><ChevronRight className="size-4 text-muted-foreground" /></ItemActions>
  </Item>;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min`;
}
function StatusMessage({ children, tone = "neutral", role, ...props }: Omit<ComponentProps<typeof Alert>, "children"> & { children: ReactNode; tone?: "neutral" | "error" }) {
  return <Alert variant={tone === "error" ? "destructive" : "default"} role={role ?? (tone === "error" ? "alert" : "status")} {...props}><AlertDescription>{children}</AlertDescription></Alert>;
}
function isUnavailableReview(error: unknown): boolean {
  if (!(error instanceof TransferExecutionError) || error.reason !== "unavailable") return false;
  const status = (error as TransferExecutionError & { status?: unknown }).status;
  return status === 404 || status === 410;
}
function messageForError(error: unknown, cashout: boolean): string {
  if (error instanceof TransferExecutionError && error.reason === "stale-session") return "Your account changed before submission. Sign in and try again.";
  if (error instanceof TransferExecutionError && error.reason === "rejected") return cashout
    ? "The wallet request was rejected. Your reviewed cash-out is still ready to retry."
    : "The wallet request was rejected. Your reviewed send is still ready to retry.";
  return "The wallet result is unknown. Check Activity before trying again.";
}
function serverCashoutMessage(error: unknown): string {
  const value = error as { code?: unknown; serverMessage?: unknown };
  if (typeof value.serverMessage === "string" && typeof value.code === "string" && value.code.startsWith("CASHOUT_")) return value.serverMessage;
  return "Peer could not prepare this cash-out safely. Check the handle and try again.";
}
