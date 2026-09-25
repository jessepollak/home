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
import { formatAddress, formatUsdStablecoinAmount } from "@/shared/formatting";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { presentationRegions, type RegionId } from "@/config/regions";
import { readProviderBindings, type FundingOfframpBinding } from "@/shared/funding/contracts/providers";
import { readCashoutOrdersResponse, type CashoutOrderSummary } from "@/shared/funding/contracts/offramp-orders";
import { canonicalizeCashPayee } from "@/shared/funding/cash-payee";
import {
  readRecentTransferRecipientsResponse,
  readTransferRecipientNameResponse,
  type RecentTransferRecipient,
} from "@/shared/transfers/contracts/recipients";
import { normalizeTransferRecipientName } from "@/shared/transfers/recipient-name";
import {
  MoneyAmountDisplay,
  MoneyAssetPicker,
  MoneyConfirmSummary,
  moneyConfirmFromRow,
  MoneyConfirmFooter,
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
  amountExceedsCeiling,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
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
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import { maxAmountAfterNetworkFee, useNetworkFeeReserve } from "@/client/money-modal/network-fee-policy";

type SendStep = "amount" | "destination" | "payout" | "handle" | "handle-confirm" | "preparing" | "confirm" | "pending" | "error";
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
  const [resolution, setResolution] = useState<{ name: string; address: `0x${string}` | null } | null>(null);
  const [recentRecipientState, setRecentRecipientState] = useState<{
    ownerBoundary: string;
    recipients: ReadonlyArray<RecentTransferRecipient>;
  } | null>(null);
  const [amount, setAmount] = useState("");
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [cashout, setCashout] = useState<CashoutRequest | null>(null);
  const [offramps, setOfframps] = useState<ReadonlyArray<FundingOfframpBinding> | null>([]);
  const [providersLoadedFor, setProvidersLoadedFor] = useState<string | null>(null);
  const [providerRetry, setProviderRetry] = useState(0);
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
  function changeAmount(value: string) {
    setAmount(value);
  }
  function changeRecipient(value: string) {
    setRecipient(value);
  }

  if (assetId && !selectedStillAvailable) {
    setAssetId(activeAssetId);
    if (amount !== "") changeAmount("");
  }
  const trimmedRecipient = recipient.trim();
  const typedAddress = isTransferRecipient(trimmedRecipient) ? normalizeTransferRecipient(trimmedRecipient) : null;
  const typedName = typedAddress === null ? normalizeTransferRecipientName(trimmedRecipient) : null;
  const settledResolution = typedName !== null && resolution?.name === typedName ? resolution : null;
  const resolvedRecipient = settledResolution?.address ?? null;
  const resolving = typedName !== null && settledResolution === null;
  const unresolved = settledResolution !== null && settledResolution.address === null;
  const recipientName = typedName !== null && resolvedRecipient !== null ? typedName : undefined;
  const effectiveRecipient = typedAddress ?? resolvedRecipient;
  const recipientHint = typedAddress !== null || typedName !== null || trimmedRecipient.length === 0
    ? null
    : "Enter a 0x address or a name like example.base.eth.";
  const selectedAsset = activeAssetId ? getTransferAsset(activeAssetId) : null;
  const pricing = useMoneyAssetPricing(selectedAsset?.symbol ?? "");
  const { reserve, failed: reserveFailed, retry: retryReserve } = useNetworkFeeReserve(ownerBoundary, fetchAccountResource, open);
  const selectedAvailability = availableAssets?.find((asset) => asset.id === activeAssetId);
  const sendCeiling = selectedAvailability ? atomicToDecimal(maxAmountAfterNetworkFee(selectedAvailability.balanceBaseUnits, selectedAsset?.symbol ?? "", reserve) ?? "0", selectedAvailability.decimals) : null;
  const ceilingSettled = selectedAsset?.symbol.toUpperCase() !== "USDC" || reserve !== undefined;
  const overAvailable = ceilingSettled && amountExceedsCeiling(amount, sendCeiling);
  const canContinueAmount = Boolean(selectedAsset) && ceilingSettled && isPositiveDecimalAmount(amount) && !overAvailable;
  const continueFromAmount = () => { setError(null); setStep("destination"); };
  const resourceBoundary = `${ownerBoundary ?? ""}:${regionId}`;
  const recentRecipients = ownerBoundary && recentRecipientState?.ownerBoundary === ownerBoundary
    ? recentRecipientState.recipients
    : [];
  const providersLoaded = providersLoadedFor === resourceBoundary;
  const ordersLoaded = ordersLoadedFor === resourceBoundary;
  const eligibleOfframps = (providersLoaded ? offramps ?? [] : []).filter((binding) => selectedAsset?.symbol === "USDC" && binding.assetId === "base:usdc");
  const visibleActiveOrders = ordersLoaded ? activeOrders : [];
  const recoveryAttempted = recoveryAttemptedFor === resourceBoundary;
  const assetOptions = useMemo(() => availableAssets?.map((asset) => ({
    id: asset.id, label: asset.symbol, description: asset.name, currency: asset.cashCurrency,
    mark: presentPortfolioAssetMark({ assetKey: asset.assetKey, name: asset.name, symbol: asset.symbol, currency: asset.cashCurrency }, assetMarkResolution),
  })) ?? [], [assetMarkResolution, availableAssets]);

  useEffect(() => {
    if (!open || step !== "destination" || !fetchAccountResource || typedName === null) return;
    const requestedName = typedName;
    let cancelled = false;
    void fetchAccountResource(`/api/transfers/recipient-name?name=${encodeURIComponent(requestedName)}`)
      .then((value) => {
        if (cancelled) return;
        const resolved = readTransferRecipientNameResponse(value);
        setResolution({
          name: requestedName,
          address: resolved && resolved.name === requestedName ? resolved.address : null,
        });
      })
      .catch(() => {
        if (!cancelled) setResolution({ name: requestedName, address: null });
      });
    return () => { cancelled = true; };
  }, [fetchAccountResource, open, step, typedName]);

  useEffect(() => {
    if (!open || !ownerBoundary || !fetchAccountResource) return;
    if (recentRecipientState?.ownerBoundary === ownerBoundary) return;
    const requestedOwnerBoundary = ownerBoundary;
    let cancelled = false;
    void fetchAccountResource("/api/transfers/recent-recipients")
      .then((value) => {
        if (!cancelled) {
          setRecentRecipientState({
            ownerBoundary: requestedOwnerBoundary,
            recipients: readRecentTransferRecipientsResponse(value),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentRecipientState({ ownerBoundary: requestedOwnerBoundary, recipients: [] });
        }
      });
    return () => { cancelled = true; };
  }, [fetchAccountResource, open, ownerBoundary, recentRecipientState]);

  useEffect(() => {
    if (!open || !ownerBoundary || !fetchAccountResource) return;
    let cancelled = false;
    const requestedBoundary = resourceBoundary;
    void fetchAccountResource(`/api/funding/providers?region=${encodeURIComponent(regionId)}&direction=offramp`)
      .then((value) => { if (!cancelled) setOfframps(readProviderBindings(value).filter((binding): binding is FundingOfframpBinding => binding.direction === "offramp")); })
      .catch(() => { if (!cancelled) setOfframps(null); })
      .finally(() => { if (!cancelled) setProvidersLoadedFor(requestedBoundary); });
    return () => { cancelled = true; };
  }, [fetchAccountResource, open, ownerBoundary, regionId, resourceBoundary, providerRetry]);

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
    let settled = false;
    setStep("preparing"); setError(null);
    void resumeMoneyAction(resumeActionId).then((resumed) => {
      settled = true;
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
      settled = true;
      if (cancelled) return;
      setRequest(null); setCashout(null); setAction(null); setStep("amount"); onInvalidResume?.();
    });
    return () => {
      cancelled = true;
      if (!settled && resumedActionRef.current === resumeActionId) resumedActionRef.current = null;
    };
  }, [onInvalidResume, open, ownerBoundary, resumeActionId, resumeMoneyAction]);

  function reset() {
    setAssetId(availableAssets?.[0]?.id ?? null); setRecipient(""); changeAmount("");
    setResolution(null);
    setRequest(null); setCashout(null); setSelectedOfframp(null); setSelectedPlatform(null); setPayoutHandle("");
    setCanonicalHandle(""); setHandleConfirmation(""); setAction(null); setStep("amount"); setError(null);
  }
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

  function showPreparedReview(prepared: PreparedMoneyAction) {
    resumedActionRef.current = prepared.id;
    setAction(prepared); onReview?.(prepared.id); setStep("confirm");
  }

  async function prepareSend() {
    try {
      if (!address || !selectedAsset || !activeAssetId || !effectiveRecipient) throw new TransferExecutionError("unavailable");
      const next: TransferRequest = {
        assetId: activeAssetId,
        recipient: effectiveRecipient,
        amountBaseUnits: parseTransferAmount(amount.replace(/\.$/, ""), selectedAsset.decimals),
        ...(recipientName === undefined ? {} : { recipientName }),
      };
      assertTransferRequest(next); setRequest(next); setCashout(null); setStep("preparing"); setError(null);
      const prepared = await prepareMoneyAction("send", next);
      showPreparedReview(prepared);
    } catch (caught) {
      setError(networkFeeErrorMessage(caught) ?? "Enter a valid Base address and positive amount, then try again."); setStep("destination");
    }
  }

  async function prepareCashout() {
    try {
      if (!selectedAsset || !selectedOfframp || !selectedPlatform || !canonicalHandle || handleConfirmation !== canonicalHandle) throw new Error("invalid");
      const amountBaseUnits = parseTransferAmount(amount.replace(/\.$/, ""), selectedAsset.decimals);
      setStep("preparing"); setError(null);
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
      setRequest(null); showPreparedReview(prepared);
    } catch (caught) {
      setError(networkFeeErrorMessage(caught) ?? serverCashoutMessage(caught)); setStep("handle-confirm");
    }
  }

  async function prepareWithdraw(order: CashoutOrderSummary) {
    try {
      if (!order.nextActions.includes("withdraw")) throw new Error("invalid");
      setStep("preparing"); setError(null);
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
      setRequest(null); showPreparedReview(prepared);
    } catch (caught) {
      setError(networkFeeErrorMessage(caught) ?? serverCashoutMessage(caught)); setStep("destination");
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
      if (request) setRecentRecipientState(null);
      reset(); onClose();
    } catch (caught) {
      if (isUnavailableReview(caught)) {
        reset(); setError("This review is no longer available — start again."); onInvalidResume?.(); return;
      }
      setError(messageForError(caught, Boolean(cashout))); setStep("error");
    }
  }

  const confirmAmount = request ? formatSendConfirmAmount(request.amountBaseUnits, request.assetId)
    : cashout ? (cashout.symbol === "USDC"
      ? formatUsdStablecoinAmount(cashout.amountBaseUnits, cashout.decimals)
      : `${atomicToDecimal(cashout.amountBaseUnits, cashout.decimals)} ${cashout.symbol}`) : "";
  const requestAsset = request ? getTransferAsset(request.assetId) : selectedAsset;
  const offrampName = cashout?.providerName ?? selectedOfframp?.displayName;
  const busy = step === "pending" || step === "preparing";
  const modalTitle = step === "confirm" || busy || step === "error" ? "Confirm" : cashout || ["payout", "handle", "handle-confirm"].includes(step) ? `Cash out${offrampName ? ` with ${offrampName}` : ""}` : "Send";
  const amountAssetProps = {
    assetId: activeAssetId ?? undefined,
    assetLabel: selectedAsset?.symbol,
    assetCurrency: selectedAsset?.cashCurrency,
    assetOptions,
    onAssetChange: (next: string) => { setAssetId(next); changeAmount(""); },
  };
  return (
    <MoneyModal open={open} labelledBy="send-title" immediate={immediate} pending={busy} onCancel={onClose} onClose={() => { reset(); (onClosed ?? onClose)(); }}>
      <MoneyModalHeader
        title={modalTitle}
        titleId="send-title"
        {...(step === "amount"
          ? { assetControl: <MoneyAssetPicker {...amountAssetProps} /> }
          : busy ? {} : { onBack: back })}
        onClose={onClose}
        closeLabel="Close send dialog"
      />
      <MoneyModalBody hasFooter={["amount", "destination", "handle", "handle-confirm", "confirm", "error"].includes(step)} className="gap-4 pt-4">
        {step === "amount" ? <>
          <MoneyAmountDisplay amount={amount} maxDecimals={selectedAsset?.decimals ?? 6} onAmountChange={changeAmount} overAvailable={overAvailable} onSubmit={canContinueAmount ? continueFromAmount : undefined} availableLabel={selectedAvailability ? `${selectedAvailability.balanceLabel} available` : undefined} availableAmount={sendCeiling} assetId={activeAssetId ?? undefined} assetLabel={selectedAsset?.symbol} assetControl="header" chipSet={pricing.status === "priced" ? "quick-local" : "none"} pricing={pricing} nativeSymbol={selectedAsset?.symbol ?? ""}>
            {selectedAsset?.symbol.toUpperCase() === "USDC" && reserveFailed ? (
              <StatusMessage tone="error" role="alert">
                Couldn&apos;t check the network fee. <Button variant="ghost" size="sm" onClick={retryReserve}>Retry</Button>
              </StatusMessage>
            ) : null}
          </MoneyAmountDisplay>
          {!selectedAsset ? <StatusMessage>No catalog balance is available to send.</StatusMessage> : null}
          {!selectedAsset && visibleActiveOrders.length > 0 ? <div className="grid gap-1">{visibleActiveOrders.map((order) => <RecoveryItem key={order.depositId} order={order} onWithdraw={() => void prepareWithdraw(order)} />)}</div> : null}
          {!selectedAsset && providersLoaded && ordersLoaded && recoveryEligible && !recoveryAttempted && visibleActiveOrders.length === 0 ? <Button variant="ghost" size="sm" onClick={() => void recoverCashouts()}>Recover a Peer cash-out</Button> : null}
        </> : null}
        {step === "destination" ? <div className="grid gap-4">
          <AddressField
            id="send-recipient"
            label="To"
            value={recipient}
            onChange={changeRecipient}
            aria-describedby={resolvedRecipient || resolving || unresolved || recipientHint ? "send-recipient-status" : undefined}
          />
          <div id="send-recipient-status" className="grid gap-2">
            {resolvedRecipient && typedName ? <StatusMessage>Resolves to <CopyableValue value={resolvedRecipient} presentation="full" valueKind="address" /></StatusMessage> : null}
            {resolving && typedName ? <StatusMessage aria-busy="true">Resolving {typedName}…</StatusMessage> : null}
            {unresolved && typedName ? <StatusMessage tone="error">{`We couldn't resolve ${typedName}. Check the name and try again.`}</StatusMessage> : null}
            {recipientHint ? <StatusMessage>{recipientHint}</StatusMessage> : null}
          </div>
          <FieldSeparator>Or</FieldSeparator>
          <div className="grid gap-1">
            {recentRecipients.length > 0 ? <RecentRecipients recipients={recentRecipients} onSelect={changeRecipient} /> : null}
            {visibleActiveOrders.map((order) => <RecoveryItem key={order.depositId} order={order} onWithdraw={() => void prepareWithdraw(order)} />)}
            {eligibleOfframps.length > 0 ? <CashoutItem binding={eligibleOfframps[0]!} onSelect={() => { setSelectedOfframp(eligibleOfframps[0]!); setStep("payout"); }} /> : null}
            {providersLoaded && offramps === null ? <>
              <StatusMessage>Cash out is unavailable right now.</StatusMessage>
              <Button variant="ghost" size="sm" onClick={() => setProviderRetry((count) => count + 1)}>Try again</Button>
            </> : null}
            {providersLoaded && offramps?.length === 0 ? <StatusMessage>Cash out isn&apos;t available in {presentationRegions[regionId].countryName} yet.</StatusMessage> : null}
            {providersLoaded && ordersLoaded && recoveryEligible && !recoveryAttempted && visibleActiveOrders.length === 0 ? <Button variant="ghost" size="sm" onClick={() => void recoverCashouts()}>Recover a Peer cash-out</Button> : null}
          </div>
        </div> : null}
        {step === "payout" && selectedOfframp ? <div className="grid gap-2">
          {selectedOfframp.paymentMethods.map((method) => <Button key={method.id} variant="outline" onClick={() => { setSelectedPlatform(method); setStep("handle"); }}>{method.label}</Button>)}
        </div> : null}
        {step === "handle" && selectedPlatform ? <div className="grid gap-2">
          <Label htmlFor="peer-payout-handle">{selectedPlatform.label} handle</Label>
          <Input
            id="peer-payout-handle"
            className="h-11"
            variant="touch"
            value={payoutHandle}
            onInput={(event) => setPayoutHandle(event.currentTarget.value)}
            placeholder={selectedPlatform.handleHint}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
          />
        </div> : null}
        {step === "handle-confirm" && selectedPlatform ? <div className="grid gap-2">
          <StatusMessage>Confirm the payout handle exactly: <strong>{canonicalHandle}</strong></StatusMessage>
          <Label htmlFor="peer-payout-confirmation">Re-enter handle</Label>
          <Input
            id="peer-payout-confirmation"
            className="h-11"
            variant="touch"
            value={handleConfirmation}
            onInput={(event) => setHandleConfirmation(event.currentTarget.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
        </div> : null}
        {(request || cashout) && (!request || requestAsset) && (step === "confirm" || busy || step === "error") ? <>
          <MoneyConfirmSummary action={action} amount={confirmAmount} lead={cashout ? (cashout.operation === "withdraw" ? `You're withdrawing from ${cashout.providerName}` : `You're cashing out with ${cashout.providerName}`) : `You're sending ${requestAsset?.symbol ?? ""}`} rows={cashout ? [
            ...(action ? [moneyConfirmFromRow(action.owner)] : []),
            { label: "Provider", value: cashout.providerName },
            { label: "Payout app", value: cashout.platformLabel },
            ...(cashout.canonicalHandle ? [{ label: "Payout handle", value: cashout.canonicalHandle }] : []),
            ...(cashout.operation === "deposit" ? [
              { label: "Approximate receive", value: `≈ ${cashout.approximateFiatAmount} ${cashout.currency}` },
              { label: "Estimated delivery", value: cashout.etaSeconds === null ? "Historical estimate unavailable" : `About ${formatEta(cashout.etaSeconds)}` },
            ] : []),
            { label: "Network", value: "Base" },
          ] : [
            ...(action ? [moneyConfirmFromRow(action.owner)] : []),
            { label: "To", value: <CopyableValue value={request!.recipient} presentation="full" valueKind="address" className="sm:justify-end" />, fullValue: true },
            { label: "Asset", value: requestAsset?.symbol ?? "" }, { label: "Network", value: "Base" },
          ]} />
          {cashout?.operation === "deposit" ? <StatusMessage>The fiat amount and delivery time are approximate, not guaranteed.</StatusMessage> : null}
          {step === "pending" ? <StatusMessage><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Waiting for your wallet…</span></StatusMessage> : null}
        </> : null}
        {step === "preparing" ? <StatusMessage><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Preparing review…</span></StatusMessage> : null}
        {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
      </MoneyModalBody>
      {step === "amount" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!canContinueAmount} onPrimary={continueFromAmount} /> : null}
      {step === "destination" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={effectiveRecipient === null || resolving} onPrimary={() => void prepareSend()} /> : null}
      {step === "handle" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!payoutHandle.trim()} onPrimary={() => { const normalized = canonicalizeCashPayee(selectedPlatform?.platform ?? "", payoutHandle); setCanonicalHandle(normalized); setHandleConfirmation(""); setStep("handle-confirm"); }} /> : null}
      {step === "handle-confirm" ? <MoneyModalFooter primaryLabel="Review" primaryDisabled={!canonicalHandle || handleConfirmation !== canonicalHandle} onPrimary={() => void prepareCashout()} /> : null}
      {step === "confirm" && action ? <MoneyConfirmFooter action={action} primaryLabel={cashout ? <>{cashout.operation === "withdraw" ? "Withdraw" : "Cash out"} <MoneyTicker value={confirmAmount} /></> : <>Send <MoneyTicker value={confirmAmount} /></>} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={back} /> : null}
      {step === "error" ? <MoneyModalFooter primaryLabel="Try again" onPrimary={() => { setError(null); setStep("confirm"); }} secondaryLabel="Back" onSecondary={back} /> : null}
    </MoneyModal>
  );
}

function RecentRecipients({ recipients, onSelect }: { recipients: ReadonlyArray<RecentTransferRecipient>; onSelect: (address: `0x${string}`) => void }) {
  return <div role="group" aria-labelledby="send-recent-recipients-label" className="grid gap-1">
    <p id="send-recent-recipients-label" className="px-1 text-sm text-muted-foreground">Recent recipients</p>
    {recipients.map((recipient) => <Item
      key={recipient.address}
      render={<Button variant="ghost" press="none" />}
      className="flex-nowrap items-center text-left"
      onClick={() => onSelect(recipient.address)}
    >
      <ItemContent className="min-w-0">
        <ItemTitle>{recipient.name ?? formatAddress(recipient.address)}</ItemTitle>
        {recipient.name ? <ItemDescription lines={1}>{formatAddress(recipient.address)}</ItemDescription> : null}
      </ItemContent>
      <ItemActions aria-hidden="true"><ChevronRight className="size-4 text-muted-foreground" /></ItemActions>
    </Item>)}
  </div>;
}

function CashoutItem({ binding, onSelect }: { binding: FundingOfframpBinding; onSelect: () => void }) {
  const labels = binding.paymentMethods.map((method) => method.label);
  const destination = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
  return <Item
    render={<Button variant="ghost" press="none" />}
    className="flex-nowrap items-center text-left"
    onClick={onSelect}
  >
    <ItemMedia><PayoutMethodMarks methods={binding.paymentMethods} /></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle>{`Send to ${destination}`}</ItemTitle>
      <ItemDescription lines={1}>Use Peer to send via app</ItemDescription>
    </ItemContent>
    <ItemActions aria-hidden="true"><ChevronRight className="size-4 text-muted-foreground" /></ItemActions>
  </Item>;
}

function RecoveryItem({ order, onWithdraw }: { order: CashoutOrderSummary; onWithdraw: () => void }) {
  const amount = order.assetSymbol === "USDC"
    ? formatUsdStablecoinAmount(order.remainingAmountAtomic, order.assetDecimals)
    : `${atomicToDecimal(order.remainingAmountAtomic, order.assetDecimals)} ${order.assetSymbol}`;
  return <Item
    render={<Button variant="ghost" press="none" />}
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
  const reason = error instanceof TransferExecutionError && error.reason === "submission-unknown" && error.cause instanceof Error ? error.cause.message.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return reason
    ? `The wallet result is unknown: ${reason}. Check Activity before trying again.`
    : "The wallet result is unknown. Check Activity before trying again.";
}
function serverCashoutMessage(error: unknown): string {
  const value = error as { code?: unknown; serverMessage?: unknown };
  if (typeof value.serverMessage === "string" && typeof value.code === "string" && value.code.startsWith("CASHOUT_")) return value.serverMessage;
  return "Peer could not prepare this cash-out safely. Check the handle and try again.";
}
