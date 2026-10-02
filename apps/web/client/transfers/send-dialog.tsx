"use client";

import { useMoneyActionOutcome } from "@/client/actions/money-action-outcome";
import { recentActionsPath } from "@/client/actions/recent-actions-query";
import { openPanelAfterClose, useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import type { MoneyAssetPrice } from "@/client/money-modal";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import { CASHOUT_PREPARE_ERRORS, isCashoutPrepareErrorCode } from "@/shared/actions/contracts/prepare";
import { MoneyTicker } from "@/components/money-ticker";
import { Alert, AlertIcon, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { presentPortfolioAssetMark, type AssetMarkResolution } from "@/client/asset-mark/presentation";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, useMemo } from "react";
import { CircleAlertIcon, ChevronRight } from "lucide-react";
import { AddressField } from "@/components/address";
import { FieldSeparator } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { CopyableValue } from "@/components/copyable-value";
import { PayoutMethodMarks } from "@/components/payout-method-marks";
import { useReactiveExpiry } from "@/client/actions/expiry";
import { cashoutQuoteFromLegacy, type CashoutQuote } from "@/shared/funding/cash-out-quote";
import { atomicToDecimal } from "@/shared/formatting/atomic";
import { formatAddress, formatUsdStablecoinAmount } from "@/shared/formatting";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { presentationRegions, type RegionId } from "@/config/regions";
import type { FundingOfframpBinding } from "@/shared/funding/contracts/providers";
import { fundingProvidersQuery } from "@/client/funding/funding-queries";
import { browserHomeQueryClient, ownerQueryKey, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { recentTransferRecipientsQuery, transferRecipientNameQuery } from "./send-queries";
import { canonicalizeCashPayee, cashPayeeLabels } from "@/shared/funding/cash-payee";
import type { RecentTransferRecipient } from "@/shared/transfers/contracts/recipients";
import { normalizeTransferRecipientName } from "@/shared/transfers/recipient-name";
import {
  MoneyAmountDisplay,
  MoneyAssetPicker,
  CashOutReview,
  MoneyConfirmSummary,
  moneyConfirmFromRow,
  MoneyConfirmFooter,
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyModalStep,
  amountExceedsCeiling,
  isPositiveDecimalAmount,
  useMoneyAmountUnit,
  MoneyResult,
  MoneyResultFooter,
  maxAmountAfterNetworkFee,
  useNetworkFeeReserve,
} from "@/client/money-modal";
import {
  formatSendConfirmAmount,
  getTransferAsset,
  isTransferRecipient,
  normalizeTransferRecipient,
  parseTransferAmount,
} from "@/shared/transfers/transfer-helpers";
import { assertTransferRequest, transferRequestFromAction } from "@/shared/transfers/transfer-request";
import { TransferExecutionError, type TransferRequest } from "@/shared/transfers/types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";

type SendStep = "amount" | "destination" | "payout" | "handle" | "confirm" | "pending" | "error" | "result";
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
  quote: CashoutQuote | null;
  depositId?: string;
};
type CashoutQuoteInput = Pick<CashoutRequest, "providerId" | "providerName" | "assetId" | "amountBaseUnits" | "platform" | "platformLabel" | "currency" | "payoutHandle"> & { canonicalHandle: string };
export function SendDialog({
  open,
  address,
  availableAssets,
  assetMarkResolution,
  prepareMoneyAction,
  fetchAccountResource,
  resumeMoneyAction,
  executeMoneyAction,
  queryOwnerKey,
  regionId = "US",
  regionReady = true,
  immediate = false,
  resumeActionId = null,
  onReview,
  onInvalidResume,
  onSubmitted,
  onClose,
  onClosed,
}: {
  open: boolean;
  address: `0x${string}` | null;
  availableAssets?: readonly (TransferAssetAvailability & { price?: MoneyAssetPrice | null })[];
  assetMarkResolution?: AssetMarkResolution;
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  resumeMoneyAction: AccountWalletClient["resumeMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  queryOwnerKey: string | null;
  regionId?: RegionId;
  regionReady?: boolean;
  resumeActionId?: string | null;
  immediate?: boolean;
  onReview?: (actionId: string) => void;
  onInvalidResume?: () => void;
  onSubmitted?: () => void;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const [assetId, setAssetId] = useState<string | null>(() => availableAssets?.[0]?.id ?? null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [cashout, setCashout] = useState<CashoutRequest | null>(null);
  const [selectedOfframp, setSelectedOfframp] = useState<FundingOfframpBinding | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<FundingOfframpBinding["paymentMethods"][number] | null>(null);
  const [payoutHandle, setPayoutHandle] = useState("");
  const [action, setAction] = useState<PreparedMoneyAction | null>(null);
  const [serverExpiredId, setServerExpiredId] = useState<string | null>(null);
  const [quoteNotice, setQuoteNotice] = useState<string | null>(null);
  const [step, setStep] = useState<SendStep>("amount");
  const [preparing, setPreparing] = useState(false);
  const [submission, setSubmission] = useState<"submitted" | "ambiguous" | "failed" | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>();
  const submittingRef = useRef(false);
  const prepareTokenRef = useRef(0);
  const prepareBoundaryRef = useRef({ open, queryOwnerKey });
  const handleInputRef = useRef<HTMLInputElement>(null);
  const focusHandleRef = useRef(false);
  const routing = useOptionalHomeShellRouting();
  const [error, setError] = useState<string | null>(null);
  const resumedActionRef = useRef<string | null>(null);
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const cashoutExpiry = useReactiveExpiry(cashout?.operation === "deposit" ? action?.expiresAt ?? null : null);
  const quoteExpired = cashout?.operation === "deposit" && action !== null && (cashoutExpiry.expired || serverExpiredId === action.id);
  const selectedStillAvailable = !assetId || availableAssets?.some((asset) => asset.id === assetId) !== false;
  const activeAssetId = assetId && selectedStillAvailable ? assetId : availableAssets?.[0]?.id ?? null;
  function invalidatePrepare() {
    prepareTokenRef.current += 1;
    setPreparing(false);
  }
  useLayoutEffect(() => {
    if (prepareBoundaryRef.current.open === open && prepareBoundaryRef.current.queryOwnerKey === queryOwnerKey) return;
    prepareBoundaryRef.current = { open, queryOwnerKey };
    invalidatePrepare();
  }, [open, queryOwnerKey]);
  function isCurrentPrepare(token: number, startedOwner: string | null) {
    return token === prepareTokenRef.current && prepareBoundaryRef.current.open && prepareBoundaryRef.current.queryOwnerKey === startedOwner;
  }
  function changeAmount(value: string) {
    invalidatePrepare();
    setAmount(value);
  }
  function editAmount(value: string) {
    if (!preparing) changeAmount(value);
  }
  function changeRecipient(value: string) {
    if (value === recipient) return;
    invalidatePrepare();
    setRecipient(value);
  }
  function changePayoutHandle(value: string) {
    invalidatePrepare();
    setPayoutHandle(value);
  }
  function chooseCashout(binding: FundingOfframpBinding) {
    invalidatePrepare();
    setSelectedOfframp(binding); setStep("payout");
  }

  if (assetId && !selectedStillAvailable) {
    setAssetId(activeAssetId);
    if (amount !== "") setAmount("");
  }
  const trimmedRecipient = recipient.trim();
  const typedAddress = isTransferRecipient(trimmedRecipient) ? normalizeTransferRecipient(trimmedRecipient) : null;
  const typedName = typedAddress === null ? normalizeTransferRecipientName(trimmedRecipient) : null;
  const readOwnerKey = open ? queryOwnerKey : null;
  const nameQuery = useHomeQuery(transferRecipientNameQuery(readOwnerKey, typedName, open && step === "destination" && Boolean(fetchAccountResource), fetchAccountResource));
  const namePending = nameQuery.isPending || nameQuery.isFetching;
  const nameSettled = typedName !== null && !namePending && (nameQuery.isSuccess || nameQuery.isError);
  const resolvedRecipient = !namePending && nameQuery.isSuccess && nameQuery.data?.name === typedName ? nameQuery.data.address : null;
  const resolving = typedName !== null && !nameSettled;
  const unresolved = nameSettled && resolvedRecipient === null;
  const recipientName = typedName !== null && resolvedRecipient !== null ? typedName : undefined;
  const effectiveRecipient = typedAddress ?? resolvedRecipient;
  const recipientHint = typedAddress !== null || typedName !== null || trimmedRecipient.length === 0
    ? null
    : "Enter a 0x address or a name like example.base.eth.";
  const selectedAsset = activeAssetId ? getTransferAsset(activeAssetId) : null;
  const selectedAvailability = availableAssets?.find((asset) => asset.id === activeAssetId);
  const unit = useMoneyAmountUnit(selectedAsset?.cashCurrency, selectedAvailability?.price ?? null);
  const { reserve, failed: reserveFailed, retry: retryReserve } = useNetworkFeeReserve(queryOwnerKey, fetchAccountResource, open);
  const sendCeiling = selectedAvailability ? atomicToDecimal(maxAmountAfterNetworkFee(selectedAvailability.balanceBaseUnits, selectedAsset?.symbol ?? "", reserve) ?? "0", selectedAvailability.decimals) : null;
  const ceilingSettled = selectedAsset?.symbol.toUpperCase() !== "USDC" || reserve !== undefined;
  const overAvailable = ceilingSettled && amountExceedsCeiling(amount, sendCeiling);
  const canContinueAmount = Boolean(selectedAsset) && ceilingSettled && isPositiveDecimalAmount(amount) && !overAvailable;
  const continueFromAmount = () => { setError(null); setStep("destination"); };
  const recentRecipientsQuery = useHomeQuery(recentTransferRecipientsQuery(readOwnerKey, open, fetchAccountResource));
  const recentRecipients = recentRecipientsQuery.isError ? [] : recentRecipientsQuery.data ?? [];
  const offrampQuery = useHomeQuery({
    ...fundingProvidersQuery(readOwnerKey, regionId, "offramp", fetchAccountResource),
    enabled: open && regionReady && Boolean(fetchAccountResource),
  });
  const offramps = offrampQuery.isError ? null : offrampQuery.data ?? null;
  const providersLoaded = regionReady && (offrampQuery.data !== undefined || offrampQuery.isFetched);
  const eligibleOfframps = (providersLoaded ? offramps ?? [] : []).filter((binding): binding is FundingOfframpBinding => selectedAsset?.symbol === "USDC" && binding.direction === "offramp" && binding.assetId === "base:usdc");
  const assetOptions = useMemo(() => availableAssets?.map((asset) => ({
    id: asset.id, label: asset.symbol, description: asset.name, currency: asset.cashCurrency,
    mark: presentPortfolioAssetMark({ assetKey: asset.assetKey, name: asset.name, symbol: asset.symbol, currency: asset.cashCurrency }, assetMarkResolution),
  })) ?? [], [assetMarkResolution, availableAssets]);

  useEffect(() => {
    if (!open || !queryOwnerKey || !regionReady || !resumeActionId || resumedActionRef.current === resumeActionId) return;
    resumedActionRef.current = resumeActionId;
    const startedOwner = queryOwnerKey;
    const token = ++prepareTokenRef.current;
    let cancelled = false;
    let settled = false;
    setPreparing(true); setError(null);
    void resumeMoneyAction(resumeActionId).then((resumed) => {
      settled = true;
      if (cancelled || !isCurrentPrepare(token, startedOwner)) return;
      setPreparing(false);
      if (resumed.kind === "send") {
        const nextRequest = transferRequestFromAction(resumed);
        if (!nextRequest) throw new TransferExecutionError("unavailable");
        setAssetId(nextRequest.assetId); changeAmount(atomicToDecimal(nextRequest.amountBaseUnits, getTransferAsset(nextRequest.assetId)?.decimals ?? 6)); setRecipient(nextRequest.recipient); setRequest(nextRequest); setCashout(null);
      } else if (resumed.kind === "cash-out" && resumed.metadata?.product === "cashout" && resumed.metadata.operation === "deposit") {
        if (!resumed.metadata.canonicalHandle) throw new TransferExecutionError("unavailable");
        const spent = resumed.amounts.find((item) => item.direction === "spend");
        if (!spent) throw new TransferExecutionError("unavailable");
        const metadata = resumed.metadata;
        changeAmount(atomicToDecimal(spent.amountBaseUnits, spent.decimals));
        setAssetId(spent.assetId);
        setRequest(null);
        setPayoutHandle(metadata.canonicalHandle);
        setCashout({
          operation: "deposit", providerId: metadata.providerId, providerName: metadata.providerName, assetId: spent.assetId,
          symbol: spent.symbol, decimals: spent.decimals, amountBaseUnits: spent.amountBaseUnits,
          platform: metadata.platform, platformLabel: metadata.platformLabel, currency: metadata.currency,
          payoutHandle: metadata.canonicalHandle, canonicalHandle: metadata.canonicalHandle,
          quote: metadata.quote ?? cashoutQuoteFromLegacy(metadata),
        });
      } else if (resumed.kind === "cash-out-withdraw" && resumed.metadata?.product === "cashout" && resumed.metadata.operation === "withdraw") {
        const received = resumed.amounts.find((item) => item.direction === "receive");
        if (!received) throw new TransferExecutionError("unavailable");
        changeAmount(atomicToDecimal(received.amountBaseUnits, received.decimals));
        setAssetId(received.assetId);
        const metadata = resumed.metadata;
        setRequest(null);
        setCashout({
          operation: "withdraw", providerId: metadata.providerId, providerName: metadata.providerName, assetId: received.assetId,
          symbol: received.symbol, decimals: received.decimals, amountBaseUnits: received.amountBaseUnits,
          platform: metadata.platform, platformLabel: metadata.platformLabel, currency: metadata.currency,
          payoutHandle: "", canonicalHandle: null, quote: null, depositId: metadata.depositId,
        });
      } else throw new TransferExecutionError("unavailable");
      setAction(resumed); setStep("confirm");
    }).catch(() => {
      settled = true;
      if (cancelled || !isCurrentPrepare(token, startedOwner)) return;
      setPreparing(false); setRequest(null); setCashout(null); setAction(null); setStep("amount"); onInvalidResume?.();
    });
    return () => {
      cancelled = true;
      if (!settled) setPreparing(false);
      if (!settled && resumedActionRef.current === resumeActionId) resumedActionRef.current = null;
    };
  }, [onInvalidResume, open, queryOwnerKey, regionReady, resumeActionId, resumeMoneyAction]);

  function reset() {
    prepareTokenRef.current += 1;
    setAssetId(availableAssets?.[0]?.id ?? null); setRecipient(""); changeAmount("");
    setSubmission(null); setSubmittedAt(undefined); submittingRef.current = false; setRequest(null); setCashout(null); setSelectedOfframp(null); setSelectedPlatform(null); setPayoutHandle("");
    setAction(null); setStep("amount"); setPreparing(false); setError(null); setQuoteNotice(null); setServerExpiredId(null);
  }
  function discardPreparedReview() {
    setAction(null); onInvalidResume?.();
  }
  function returnToCashoutHandle(focus: boolean) {
    prepareTokenRef.current += 1;
    discardPreparedReview();
    setPreparing(false); setQuoteNotice(null);
    const binding = selectedOfframp?.providerId === cashout?.providerId && selectedOfframp?.region === regionId && selectedOfframp?.assetId === "base:usdc" && selectedOfframp?.currency === cashout?.currency &&
      selectedPlatform?.platform === cashout?.platform ? selectedOfframp :
      (providersLoaded ? offramps : null)?.find((item): item is FundingOfframpBinding => item.direction === "offramp" && item.providerId === cashout?.providerId && item.region === regionId && item.assetId === "base:usdc" && item.currency === cashout?.currency &&
        item.paymentMethods.some((method) => method.platform === cashout?.platform));
    const method = binding?.paymentMethods.find((item) => item.platform === cashout?.platform);
    setCashout(null);
    if (!binding || !method) { setStep("destination"); return; }
    setSelectedOfframp(binding); setSelectedPlatform(method);
    focusHandleRef.current = focus;
    setStep("handle");
  }
  useEffect(() => {
    if (step === "handle" && focusHandleRef.current) {
      handleInputRef.current?.focus();
      focusHandleRef.current = false;
    }
  }, [step, selectedPlatform]);
  function back() {
    prepareTokenRef.current += 1;
    setPreparing(false); setError(null);
    if (step === "destination") setStep("amount");
    else if (step === "payout") setStep("destination");
    else if (step === "handle") setStep("payout");
    else if (step === "confirm" || step === "error") {
      if (cashout?.operation === "withdraw") { onClose(); return; }
      if (cashout) returnToCashoutHandle(false);
      else { discardPreparedReview(); setStep("destination"); }
    }
  }

  function showPreparedReview(prepared: PreparedMoneyAction) {
    resumedActionRef.current = prepared.id;
    setAction(prepared); onReview?.(prepared.id); setStep("confirm");
  }

  async function prepareSend() {
    if (preparing) return;
    const token = ++prepareTokenRef.current;
    const startedOwner = queryOwnerKey;
    try {
      if (!address || !selectedAsset || !activeAssetId || !effectiveRecipient) throw new TransferExecutionError("unavailable");
      const next: TransferRequest = {
        assetId: activeAssetId,
        recipient: effectiveRecipient,
        amountBaseUnits: parseTransferAmount(amount.replace(/\.$/, ""), selectedAsset.decimals),
        ...(recipientName === undefined ? {} : { recipientName }),
      };
      assertTransferRequest(next); setPreparing(true); setError(null);
      const outcome = await prepareMoneyAction("send", next).then((prepared) => ({ prepared }), (failure: unknown) => ({ failure }));
      if (!isCurrentPrepare(token, startedOwner)) return;
      if ("failure" in outcome) throw outcome.failure;
      setRequest(next); setCashout(null); setPreparing(false); showPreparedReview(outcome.prepared);
    } catch (caught) {
      if (!isCurrentPrepare(token, startedOwner)) return { failure: caught };
      setPreparing(false); setError(networkFeeErrorMessage(caught) ?? "Enter a valid Base address and positive amount, then try again."); setStep("destination");
    }
  }

  async function prepareCashout() {
    if (!regionReady || preparing) return;
    const token = ++prepareTokenRef.current;
    const startedOwner = queryOwnerKey;
    try {
      if (!selectedAsset || !selectedOfframp || !selectedPlatform) throw new Error("invalid");
      const canonicalHandle = canonicalizeCashPayee(selectedPlatform.platform, payoutHandle);
      if (!canonicalHandle) throw new Error("invalid");
      const amountBaseUnits = parseTransferAmount(amount.replace(/\.$/, ""), selectedAsset.decimals);
      setPreparing(true); setError(null); setQuoteNotice(null);
      const next = await prepareCashoutReview({
        providerId: selectedOfframp.providerId, providerName: selectedOfframp.displayName, assetId: selectedOfframp.assetId,
        amountBaseUnits, platform: selectedPlatform.platform, platformLabel: selectedPlatform.label, currency: selectedOfframp.currency,
        payoutHandle, canonicalHandle,
      });
      if (!isCurrentPrepare(token, startedOwner)) return;
      setCashout(next.cashout); setRequest(null); setPreparing(false); showPreparedReview(next.prepared);
    } catch (caught) { // oxlint-disable-line home/no-silent-catch -- superseded cash-out preparations cannot overwrite the edited destination
      if (isCurrentPrepare(token, startedOwner)) {
        setPreparing(false); setError(networkFeeErrorMessage(caught) ?? serverCashoutMessage(caught)); setStep("handle");
      }
    }
  }

  async function prepareCashoutReview(input: CashoutQuoteInput): Promise<{ prepared: PreparedMoneyAction; cashout: CashoutRequest }> {
    const prepared = await prepareMoneyAction("cash-out", {
      providerId: input.providerId, region: regionId, assetId: input.assetId,
      amountBaseUnits: input.amountBaseUnits, platform: input.platform, currency: input.currency, payoutHandle: input.payoutHandle,
    });
    if (prepared.kind !== "cash-out" || prepared.metadata?.product !== "cashout" || prepared.metadata.operation !== "deposit" ||
      prepared.metadata.canonicalHandle !== input.canonicalHandle) throw new Error("invalid");
    const metadata = prepared.metadata;
    const spent = prepared.amounts.find((item) => item.direction === "spend");
    if (!spent) throw new Error("invalid");
    return { prepared, cashout: {
      ...input, operation: "deposit", assetId: spent.assetId, symbol: spent.symbol, decimals: spent.decimals, amountBaseUnits: spent.amountBaseUnits,
      canonicalHandle: metadata.canonicalHandle, quote: metadata.quote ?? cashoutQuoteFromLegacy(metadata),
    } };
  }

  async function requoteCashout() {
    if (!regionReady || preparing || cashout?.operation !== "deposit" || !cashout.canonicalHandle || !cashout.quote) return;
    const previous = { ...cashout, canonicalHandle: cashout.canonicalHandle, quote: cashout.quote };
    const token = ++prepareTokenRef.current;
    const startedOwner = queryOwnerKey;
    setPreparing(true); setError(null); setQuoteNotice(null);
    try {
      const next = await prepareCashoutReview({ ...previous, payoutHandle: previous.canonicalHandle });
      if (!isCurrentPrepare(token, startedOwner)) return;
      const receive = next.cashout.quote?.receive;
      const changed = !receive || receive.currency !== previous.quote.receive.currency || !sameDecimal(receive.amount, previous.quote.receive.amount);
      setCashout(next.cashout); setPreparing(false);
      setQuoteNotice(changed ? "The quote changed. Check what you receive before you cash out." : null);
      showPreparedReview(next.prepared);
    } catch (caught) { // oxlint-disable-line home/no-silent-catch -- a superseded requote cannot overwrite a newer review
      if (isCurrentPrepare(token, startedOwner)) {
        setPreparing(false); setError(networkFeeErrorMessage(caught) ?? serverCashoutMessage(caught)); setStep("error");
      }
    }
  }

  async function confirm() {
    if (!action || (!request && !cashout) || submittingRef.current || step !== "confirm") return;
    if (cashout?.operation === "deposit" && (quoteExpired || cashoutExpiry.recheckExpired())) return;
    submittingRef.current = true;
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
        setSubmission("failed"); setStep("result");
        return;
      }
      if (request && queryOwnerKey) void queryClient.invalidateQueries({ queryKey: ownerQueryKey(queryOwnerKey, "transfers-recent-recipients") });
      onSubmitted?.();
      setSubmittedAt(new Date().toISOString());
      setSubmission("submitted"); setStep("result");
    } catch (caught) {
      if (caught instanceof TransferExecutionError && (caught.reason === "submission-unknown" || caught.reason === "dispatch-unknown")) {
        onSubmitted?.();
        setSubmission("ambiguous"); setStep("result");
        return;
      }
      if (cashout?.operation === "deposit" && isExpiredReview(caught)) {
        setServerExpiredId(action.id); setStep("confirm"); return;
      }
      if (isUnavailableReview(caught)) {
        reset(); setError("This review is no longer available — start again."); onInvalidResume?.(); return;
      }
      setError(messageForError(caught, Boolean(cashout))); setStep("error");
    } finally {
      submittingRef.current = false;
    }
  }

  const confirmAmount = request ? formatSendConfirmAmount(request.amountBaseUnits, request.assetId)
    : cashout ? (cashout.symbol === "USDC"
      ? formatUsdStablecoinAmount(cashout.amountBaseUnits, cashout.decimals)
      : `${atomicToDecimal(cashout.amountBaseUnits, cashout.decimals)} ${cashout.symbol}`) : "";
  const requestAsset = request ? getTransferAsset(request.assetId) : selectedAsset;
  const offrampName = cashout?.providerName ?? selectedOfframp?.displayName;
  const busy = step === "pending" || preparing;
  const reviewing = step === "confirm" || step === "pending" || step === "error";
  const modalTitle = reviewing ? "Confirm" : cashout || ["payout", "handle"].includes(step) ? `Cash out${offrampName ? ` with ${offrampName}` : ""}` : "Send";
  const amountAssetProps = {
    assetId: activeAssetId ?? undefined,
    assetLabel: selectedAsset?.symbol,
    assetCurrency: selectedAsset?.cashCurrency,
    assetOptions,
    onAssetChange: (next: string) => { if (preparing) return; setAssetId(next); changeAmount(""); },
    locked: preparing,
  };
  return (
    <MoneyModal open={open} labelledBy="send-title" immediate={immediate} pending={busy} onCancel={() => { prepareTokenRef.current += 1; onClose(); }} onClose={() => { reset(); (onClosed ?? onClose)(); }}>
      <MoneyModalStep step={step === "pending" || step === "error" ? "confirm" : step} depth={{ amount: 0, destination: 1, payout: 2, handle: 3, confirm: 4, pending: 4, error: 4, result: 5 }[step]}>
      <MoneyModalHeader
        title={modalTitle}
        titleId="send-title"
        {...(step === "amount"
          ? { assetControl: <MoneyAssetPicker {...amountAssetProps} /> }
          : busy || step === "result" ? {} : { onBack: back })}
        closeLabel="Close send dialog"
      />
      {step !== "result" ? <MoneyModalBody hasFooter={["amount", "destination", "handle", "confirm", "error"].includes(step)} className="gap-4 pt-4">
        {step === "amount" ? <>
          <MoneyAmountDisplay amount={amount} maxDecimals={selectedAsset?.decimals ?? 6} onAmountChange={editAmount} readOnly={preparing} overAvailable={overAvailable} onSubmit={canContinueAmount ? continueFromAmount : undefined} availableLabel={selectedAvailability ? `${selectedAvailability.balanceLabel} available` : undefined} availableAmount={sendCeiling} assetId={activeAssetId ?? undefined} assetLabel={selectedAsset?.symbol} assetControl="header" chipSet={unit.kind === "fiat" || unit.kind === "convertible" ? "quick-local" : "none"} unit={unit} nativeSymbol={selectedAsset?.symbol ?? ""}>
            {selectedAsset?.symbol.toUpperCase() === "USDC" && reserveFailed ? (
              <StatusMessage tone="error" role="alert">
                Couldn&apos;t check the network fee. <Button variant="ghost" size="sm" onClick={retryReserve}>Retry</Button>
              </StatusMessage>
            ) : null}
          </MoneyAmountDisplay>
          {!selectedAsset ? <StatusMessage>No catalog balance is available to send.</StatusMessage> : null}
        </> : null}
        {step === "destination" ? <div className="grid gap-4">
          <AddressField
            id="send-recipient"
            label="To"
            value={recipient}
            onChange={changeRecipient}
            readOnly={preparing}
            aria-describedby={resolvedRecipient || resolving || unresolved || recipientHint ? "send-recipient-status" : undefined}
          />
          <div id="send-recipient-status" className="grid gap-2">
            {resolvedRecipient && typedName ? <StatusMessage>Resolves to <CopyableValue value={resolvedRecipient} presentation="reveal" valueKind="address" /></StatusMessage> : null}
            {resolving && typedName ? <StatusMessage aria-busy="true">Resolving {typedName}…</StatusMessage> : null}
            {unresolved && typedName ? <StatusMessage tone="error">{`We couldn't resolve ${typedName}. Check the name and try again.`}</StatusMessage> : null}
            {recipientHint ? <StatusMessage>{recipientHint}</StatusMessage> : null}
          </div>
          <FieldSeparator>Or</FieldSeparator>
          <div className="grid gap-1">
            {recentRecipients.length > 0 ? <RecentRecipients recipients={recentRecipients} disabled={preparing} onSelect={changeRecipient} /> : null}
            {eligibleOfframps.length > 0 ? <CashoutItem binding={eligibleOfframps[0]!} disabled={preparing} onSelect={() => chooseCashout(eligibleOfframps[0]!)} /> : null}
            {providersLoaded && offramps === null ? <>
              <StatusMessage>Cash out is unavailable right now.</StatusMessage>
              <Button variant="ghost" size="sm" disabled={preparing} onClick={() => void offrampQuery.refetch()}>Try again</Button>
            </> : null}
            {providersLoaded && offramps?.length === 0 ? <StatusMessage>Cash out isn&apos;t available in {presentationRegions[regionId].countryName} yet.</StatusMessage> : null}
          </div>
        </div> : null}
        {step === "payout" && selectedOfframp ? <div className="grid gap-2">
          {selectedOfframp.paymentMethods.map((method) => <Button key={method.id} variant="outline" onClick={() => { setSelectedPlatform(method); setStep("handle"); }}>{method.label}</Button>)}
        </div> : null}
        {step === "handle" && selectedPlatform ? <div className="grid gap-2">
          <Label htmlFor="peer-payout-handle">{cashPayeeLabels(selectedPlatform.platform, selectedPlatform.label).field}</Label>
          <Input
            id="peer-payout-handle"
            ref={handleInputRef}
            className="h-11"
            variant="touch"
            value={payoutHandle}
            readOnly={preparing}
            onInput={(event) => changePayoutHandle(event.currentTarget.value)}
            placeholder={selectedPlatform.handleHint}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            onKeyDown={(event) => { if (event.key === "Enter" && !preparing && canonicalizeCashPayee(selectedPlatform.platform, payoutHandle)) { event.preventDefault(); void prepareCashout(); } }}
          />
        </div> : null}
        {cashout?.operation === "deposit" && cashout.quote && cashout.canonicalHandle && action && reviewing ? <CashOutReview
          action={action} amount={confirmAmount} quote={cashout.quote} providerName={cashout.providerName}
          platform={cashout.platform} platformLabel={cashout.platformLabel} canonicalHandle={cashout.canonicalHandle}
          onEdit={() => returnToCashoutHandle(true)}
          notice={quoteExpired ? { tone: "neutral", text: "This quote expired. Get a new quote to continue." } : quoteNotice ? { tone: "neutral", text: quoteNotice } : null}
        /> : (request || cashout) && (!request || requestAsset) && reviewing ? <>
          <MoneyConfirmSummary action={action} amount={confirmAmount} lead={cashout ? `You're withdrawing from ${cashout.providerName}` : `You're sending ${requestAsset?.symbol ?? ""}`} rows={cashout ? [
            ...(action ? [moneyConfirmFromRow(action.owner)] : []),
            { label: "Provider", value: cashout.providerName },
            { label: "Payout app", value: cashout.platformLabel },
            { label: "Network", value: "Base" },
          ] : [
            ...(action ? [moneyConfirmFromRow(action.owner)] : []),
            { label: "To", value: <CopyableValue value={request!.recipient} presentation="reveal" valueKind="address" className="-my-3 justify-end" /> },
            { label: "Asset", value: requestAsset?.symbol ?? "" }, { label: "Network", value: "Base" },
          ]} />
        </> : null}
        {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
      </MoneyModalBody> : null}
      {step === "result" && action && submission ? <SendResult action={action} submission={submission} amount={confirmAmount} provider={cashout?.providerName} submittedAt={submittedAt} fetchAccountResource={fetchAccountResource} onDone={onClose} onTryAgain={() => { setAction(null); setSubmission(null); setStep("amount"); onInvalidResume?.(); }} onViewActivity={() => openPanelAfterClose(routing, "activity", onClose)} /> : null}
      {step === "amount" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!canContinueAmount} primaryLoading={preparing} onPrimary={continueFromAmount} /> : null}
      {step === "destination" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={effectiveRecipient === null || resolving} primaryLoading={preparing} onPrimary={() => void prepareSend()} /> : null}
      {step === "handle" ? <MoneyModalFooter primaryLabel="Review" primaryDisabled={!canonicalizeCashPayee(selectedPlatform?.platform ?? "", payoutHandle)} primaryLoading={preparing} onPrimary={() => void prepareCashout()} /> : null}
      {(step === "confirm" || step === "pending") && action ? <MoneyConfirmFooter action={action} actionExpired={quoteExpired} primaryLabel={quoteExpired ? "Get new quote" : cashout ? <>{cashout.operation === "withdraw" ? "Withdraw" : "Cash out"} <MoneyTicker value={confirmAmount} /></> : <>Send <MoneyTicker value={confirmAmount} /></>} submitting={step === "pending" || preparing} onPrimary={() => void (quoteExpired ? requoteCashout() : confirm())} secondaryLabel="Back" onSecondary={back} /> : null}
      {step === "error" ? <MoneyModalFooter primaryLabel="Try again" onPrimary={() => { setError(null); setStep("confirm"); }} secondaryLabel="Back" onSecondary={back} /> : null}
      </MoneyModalStep>
    </MoneyModal>
  );
}

function SendResult({ action, submission, amount, provider, submittedAt, fetchAccountResource, onDone, onTryAgain, onViewActivity }: {
  action: PreparedMoneyAction;
  submission: "submitted" | "ambiguous" | "failed";
  amount: string;
  provider?: string;
  submittedAt?: string;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  onDone: () => void;
  onTryAgain: () => void;
  onViewActivity: () => void;
}) {
  const { outcome } = useMoneyActionOutcome({
    action, submission,
    fetchOperations: (signal) => fetchAccountResource
      ? fetchAccountResource(recentActionsPath, { signal })
      : Promise.reject(new Error("Actions unavailable")),
  });
  return <>
    <MoneyModalBody hasFooter className="gap-4 pt-4">
      <MoneyResult kind={action.kind === "cash-out" || action.kind === "cash-out-withdraw" ? action.kind : "send"} outcome={outcome} amount={amount} provider={provider} submittedAt={submittedAt} />
    </MoneyModalBody>
    <MoneyResultFooter outcome={outcome} onDone={onDone} onTryAgain={onTryAgain} onViewActivity={onViewActivity} />
  </>;
}

function RecentRecipients({ recipients, disabled, onSelect }: { recipients: ReadonlyArray<RecentTransferRecipient>; disabled: boolean; onSelect: (address: `0x${string}`) => void }) {
  return <div role="group" aria-labelledby="send-recent-recipients-label" className="grid gap-1">
    <p id="send-recent-recipients-label" className="px-1 text-sm text-muted-foreground">Recent recipients</p>
    {recipients.map((recipient) => <Item
      key={recipient.address}
      render={<Button variant="ghost" press="none" disabled={disabled} />}
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

function CashoutItem({ binding, disabled, onSelect }: { binding: FundingOfframpBinding; disabled: boolean; onSelect: () => void }) {
  const labels = binding.paymentMethods.map((method) => method.label);
  const destination = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
  return <Item
    render={<Button variant="ghost" press="none" disabled={disabled} />}
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

function sameDecimal(left: string, right: string): boolean {
  const trim = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return trim(left) === trim(right);
}
function isExpiredReview(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === "ACTION_EXPIRED") return true;
  return error instanceof TransferExecutionError && error.reason === "unavailable" &&
    (error as TransferExecutionError & { status?: unknown }).status === 410;
}
function StatusMessage({ children, tone = "neutral", role, ...props }: Omit<ComponentProps<typeof Alert>, "children"> & { children: ReactNode; tone?: "neutral" | "error" }) {
  return <Alert variant={tone === "error" ? "destructive" : "default"} role={role ?? (tone === "error" ? "alert" : "status")} {...props}>{tone === "error" ? <AlertIcon><CircleAlertIcon /></AlertIcon> : null}<AlertDescription>{children}</AlertDescription></Alert>;
}
function isUnavailableReview(error: unknown): boolean {
  if (!(error instanceof TransferExecutionError) || error.reason !== "unavailable") return false;
  const details = error as TransferExecutionError & { status?: unknown; code?: unknown };
  return details.status === 404 || details.status === 410 ||
    details.code === CASHOUT_PREPARE_ERRORS.unavailable.code ||
    details.code === CASHOUT_PREPARE_ERRORS["settings-unavailable"].code;
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
  if (typeof value.serverMessage === "string" && isCashoutPrepareErrorCode(value.code)) return value.serverMessage;
  return "Check the payout details and try again.";
}
