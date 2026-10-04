"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { useReactiveExpiry } from "@/client/actions/expiry";
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey, tradeMoneyOwnerKey } from "@/client/account/owner-keys";
import { PRODUCT_NOT_OFFERED_CODE } from "@/shared/actions/contracts/prepare";
import {
  MoneyAmountDisplay, MoneyAssetPicker, MoneyConfirmFooter, MoneyConfirmSummary, MoneyModal,
  MoneyModalBody, MoneyModalFooter, MoneyModalHeader,
  MoneyModalStep,
  decimalFromBaseUnits, isPositiveDecimalAmount, maxAmountAfterNetworkFee, moneyConfirmFromRow, useMoneyAmountUnit,
  useMoneyModalExit, useMoneyModalPending, useNetworkFeeReserveState, type MoneyAssetPrice, type MoneyConfirmRow,
} from "@/client/money-modal";
import { Button } from "@/components/ui/button";
import { assetKeyForErc20, canonicalUsdcAsset } from "@/config/portfolio-assets";
import { CopyableValue } from "@/components/copyable-value";
import { reportClientError } from "@/client/observability/client-reporter";
import { formatExactPresentationCashAmount, formatExactPresentationTokenAmount, formatUsdStablecoinAmount } from "@/shared/formatting";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import type { PreparedMoneyAction, OperationResult } from "@/shared/money-actions/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { BASE_USDC } from "@/shared/assets/base";
import {
  TRADE_ACTION_CONTRACT_VERSION, TRADE_SELL_ALL, TRADE_SLIPPAGE_BPS,
  isTradeErrorCode, type TradeActionParams, type TradeDirection, type TradeMoneyActionMetadata, type TradeToken,
} from "@/shared/trading/contract";
import { tradeCustomerAmounts, type TradeCustomerAmounts } from "@/shared/trading/fee-amounts";
import { type CashConversionCurrency, cashConversionPair, cashConversionTrade } from "@/shared/trading/cash-conversion";
import { tradeRateLabel } from "@/shared/trading/review";
import { operatorFeeAmount, parseOperatorFeeRecord } from "@/shared/fees/contract";
import { SERVICE_FEE_LABEL, serviceFeeValue } from "./service-fee";

type TradeMoneyFlowProps = {
  direction: TradeDirection;
  session: VerifiedAccountSession;
  token: TradeToken;
  assetName: string;
  availableBaseUnits: string | null;
  assetPrice?: MoneyAssetPrice | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  onConfirmed?: (result: OperationResult) => void | Promise<void>;
  depth?: number;
  onBack?: () => void;
  onDone: () => void;
  conversion?: { from: CashConversionCurrency; to: CashConversionCurrency };
  onAttemptedChange?: (attempted: boolean, dispatchUnknown?: boolean) => void;
  initialAmount?: string;
  onAmountChange?: (amount: string) => void;
  resume?: { amount: string; amountBaseUnits: string; prepared: PreparedMoneyAction };
  onUnresolved?: (state: { amount: string; amountBaseUnits: string; prepared: PreparedMoneyAction }) => void;
};
type Props = Omit<TradeMoneyFlowProps, "onDone"> & { open: boolean; onClose: () => void; onClosed?: () => void };
type Step = "amount" | "confirm" | "failed" | "dispatch-unknown";

type FencedExecution = { state: "current"; result: OperationResult } | { state: "superseded"; result: OperationResult | null };

async function executeFenced(run: () => Promise<OperationResult>, isCurrent: () => boolean): Promise<FencedExecution> {
  try {
    const result = await run();
    return isCurrent() ? { state: "current", result } : { state: "superseded", result };
  } catch (error) {
    if (isCurrent()) throw error;
    return { state: "superseded", result: null };
  }
}

export function TradeMoneyDialog({ open, onClose, onClosed, onAttemptedChange, ...props }: Props) {
  const [resetKey, setResetKey] = useState(0);
  const attempted = useRef(false);
  const dispatchUnknown = useRef(false);
  return <MoneyMotionProvider><MoneyModal open={open} labelledBy="trade-action-title" onCancel={onClose} onClose={() => {
    if (!attempted.current || dispatchUnknown.current) setResetKey((key) => key + 1);
    onClosed?.();
  }}>
    <TradeMoneyFlow key={`${resetKey}:${tradeMoneyOwnerKey(props.session)}:${props.token.assetId}`} {...props} onDone={onClose} onAttemptedChange={(value, unknown = false) => {
      attempted.current = value;
      dispatchUnknown.current = unknown;
      onAttemptedChange?.(value, unknown);
    }} />
  </MoneyModal></MoneyMotionProvider>;
}

/** @public Embeddable trade step for a Cash Convert host */
export function TradeMoneyFlow({ direction, session, token, assetName, availableBaseUnits, assetPrice, fetchAccountResource, prepareMoneyAction, executeMoneyAction, onConfirmed, depth = 0, onBack, onDone, conversion, onAttemptedChange, initialAmount = "", onAmountChange, resume, onUnresolved }: TradeMoneyFlowProps) {
  const exit = useMoneyModalExit();
  const ownerKey = session.smartAccount ? dataOwnerKey(session) : null;
  const { reserve, failed: reserveFailed, retrying: reserveRetrying, retry: retryReserve } = useNetworkFeeReserveState(ownerKey, fetchAccountResource, true);
  const maxBaseUnits = direction === "buy" ? maxAmountAfterNetworkFee(availableBaseUnits, "USDC", reserve) : availableBaseUnits;
  const decimals = direction === "buy" ? 6 : token.decimals;
  const symbol = direction === "buy" ? "USDC" : token.symbol;
  const cashUnit = useMoneyAmountUnit(conversion?.from.code ?? canonicalUsdcAsset.cashCurrency);
  const sellUnit = useMoneyAmountUnit(null, assetPrice);
  const [amount, setAmount] = useState(resume?.amount ?? initialAmount);
  const [maxSelected, setMaxSelected] = useState(false);
  const [amountBaseUnits, setAmountBaseUnits] = useState<string | null>(resume?.amountBaseUnits ?? null);
  const [prepared, setPrepared] = useState<PreparedMoneyAction | null>(resume?.prepared ?? null);
  const [step, setStep] = useState<Step>(resume ? "confirm" : "amount");
  const [busy, setBusy] = useState<"quote" | "wallet" | null>(null);
  const [error, setError] = useState<string | null>(resume ? "We couldn't confirm this conversion yet. Retry to record the same conversion, or check Activity before converting again." : null);
  const [attempted, setAttempted] = useState(Boolean(resume));
  const [serverExpiredId, setServerExpiredId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const preparation = useRef(0);
  const confirming = useRef(false);
  const metadata = prepared?.metadata?.product === "trade" ? prepared.metadata : null;
  const customer = metadata ? tradeCustomerAmounts(metadata) : null;
  const { expired, recheckExpired } = useReactiveExpiry(prepared?.expiresAt ?? null);
  const actionExpired = expired || (prepared !== null && serverExpiredId === prepared.id);
  const expiredUnresolved = step === "confirm" && actionExpired && attempted && busy !== "wallet";
  const expiryRecovery = actionExpired && busy !== "wallet";
  const canGoBack = step === "failed" || (step === "confirm" && !attempted);
  const secondsLeft = prepared ? Math.max(0, Math.ceil((Date.parse(prepared.expiresAt) - now) / 1000)) : 0;
  useMoneyModalPending(busy !== null);
  useEffect(() => {
    if (step !== "confirm" || !prepared || actionExpired) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step, prepared, actionExpired]);
  useEffect(() => () => { preparation.current += 1; }, []);
  function changeAttempted(value: boolean, dispatchUnknown = false) {
    setAttempted(value);
    onAttemptedChange?.(value, dispatchUnknown);
  }
  function close() {
    preparation.current += 1;
    exit();
  }
  function complete() {
    preparation.current += 1;
    onDone();
  }
  function refreshHost(result: OperationResult) {
    void (async () => {
      try {
        await onConfirmed?.(result);
      } catch (caught) {
        void reportClientError({ name: caught instanceof Error ? caught.name : "Error", message: caught instanceof Error ? caught.message : "The post-confirm refresh failed.", route: window.location.pathname });
      }
    })();
  }
  function back() {
    setPrepared(null); setServerExpiredId(null); changeAttempted(false); setError(null); setStep("amount");
  }
  const conversionRoute = conversion ? cashConversionTrade(conversion.from.code, conversion.to.code) : null;
  const validConversion = !conversion || Boolean(conversionRoute && conversionRoute.assetId === token.assetId && conversionRoute.direction === direction &&
    token.address.toLowerCase() === (direction === "buy" ? conversion.to.address : conversion.from.address).toLowerCase() &&
    token.decimals === (direction === "buy" ? conversion.to.decimals : conversion.from.decimals));
  const enteredBaseUnits = parseTradeAmount(amount, decimals);
  const reservePending = direction === "buy" && reserve === undefined;
  const exceedsAvailable = !reservePending && enteredBaseUnits !== null && maxBaseUnits !== null && BigInt(enteredBaseUnits) > BigInt(maxBaseUnits);
  const canContinue = validConversion && !!ownerKey && maxBaseUnits !== null && !reservePending &&
    isPositiveDecimalAmount(amount) && enteredBaseUnits !== null && !exceedsAvailable;

  async function prepare(requote = false) {
    const amountToPrepare = requote ? amountBaseUnits : direction === "sell" && maxSelected && enteredBaseUnits === maxBaseUnits ? TRADE_SELL_ALL : enteredBaseUnits;
    if (!amountToPrepare || !session.smartAccount || !validConversion || busy !== null) return;
    const request: TradeActionParams = {
      version: TRADE_ACTION_CONTRACT_VERSION,
      assetId: token.assetId,
      direction,
      amountBaseUnits: amountToPrepare,
    };
    const generation = ++preparation.current;
    setError(null);
    setBusy("quote");
    if (!requote) setAmountBaseUnits(amountToPrepare);
    try {
      const action = await prepareMoneyAction("trade", request);
      if (generation !== preparation.current) return;
      const pair = action.metadata?.product === "trade" ? cashConversionPair(action.metadata) : null;
      if (!matchesPreparedTrade(action, session, request, token) || (conversion &&
        (pair?.from.code !== conversion.from.code || pair.to.code !== conversion.to.code))) throw new Error(conversion
          ? "The conversion quote did not match this account or currencies. Get a new quote."
          : "The quote did not match this account or trade. Get a new quote.");
      setPrepared(action); setServerExpiredId(null); changeAttempted(false); setNow(Date.now()); setStep("confirm");
      setBusy(null);
    } catch (caught) {
      if (generation !== preparation.current) return;
      setError(messageForTradeError(caught, direction, conversion));
      setStep(requote ? "confirm" : "amount");
      setBusy(null);
    }
  }

  async function confirm() {
    if (!prepared || !metadata || step !== "confirm" || busy !== null || confirming.current) return;
    if (actionExpired || recheckExpired()) { setServerExpiredId(prepared.id); return; }
    const generation = preparation.current;
    confirming.current = true;
    setError(null);
    setBusy("wallet");
    try {
      const execution = await executeFenced(() => executeMoneyAction(prepared), () => generation === preparation.current);
      if (execution.state === "superseded") {
        if (execution.result && execution.result.status !== "rejected" && execution.result.status !== "failed") refreshHost(execution.result);
        return;
      }
      const result = execution.result;
      if (result.status === "rejected") {
        setError(conversion ? "The wallet request was rejected. Review the conversion and try again." : "The wallet request was rejected. Review the quote and try again.");
        return;
      }
      if (result.status === "failed") {
        changeAttempted(false);
        setError(conversion ? "This conversion did not succeed onchain. Check Activity before converting again." : "This trade did not succeed onchain. Check Activity before trading again.");
        setStep("failed");
        return;
      }
      changeAttempted(false);
      complete();
      refreshHost(result);
    } catch (caught) {
      if (isRecord(caught) && caught.code === PRODUCT_NOT_OFFERED_CODE) {
        setError("This is no longer offered.");
        setStep("confirm");
        return;
      }
      if (isRecord(caught) && (caught.code === "ACTION_EXPIRED" || caught.code === "TRADE_QUOTE_STALE")) {
        setServerExpiredId(prepared.id);
        setError("This quote expired. Get a new quote.");
      } else if (caught instanceof TransferExecutionError && (caught.reason === "not-submitted" || caught.reason === "invalid-request")) {
        setError(caught.reason === "not-submitted" ? conversion ? "Couldn't sign this conversion. Try again or get a new quote." : "Couldn't sign this trade. Try again or get a new quote." : conversion ? "This conversion quote can't be signed. Get a new quote." : "This quote can't be signed. Get a new quote.");
      } else if (caught instanceof TransferExecutionError && caught.reason === "dispatch-unknown") {
        changeAttempted(true, true);
        setStep("dispatch-unknown");
        return;
      } else {
        changeAttempted(true);
        if (amountBaseUnits) onUnresolved?.({ amount, amountBaseUnits, prepared });
        setError(conversion ? "We couldn't confirm this conversion yet. Retry to record the same conversion, or check Activity before converting again." : "We couldn't confirm this trade yet. Retry to record the same trade, or check Activity before trading again.");
      }
    } finally {
      confirming.current = false;
      if (generation === preparation.current) setBusy(null);
    }
  }

  const amountAssetProps = conversion
    ? { assetId: conversion.from.portfolioAssetId, assetLabel: conversion.from.symbol, assetCurrency: conversion.from.code }
    : direction === "buy"
      ? { assetId: "usdc", assetLabel: "USDC", assetCurrency: canonicalUsdcAsset.cashCurrency }
      : { assetId: token.assetId, assetLabel: token.symbol, assetMark: presentPortfolioAssetMark({ assetKey: assetKeyForErc20(token.address), name: assetName, symbol: token.symbol, currency: null }) };
  const conversionPair = conversion && metadata ? cashConversionPair(metadata) : null;
  const spentAmount = metadata && customer ? conversionPair
    ? formatExactPresentationCashAmount(customer.spendBaseUnits, metadata.fromAsset.decimals, conversionPair.from.code)
    : tradeDisplayAmount(customer.spendBaseUnits, metadata.fromAsset) : "";
  const receivedAmount = metadata && customer ? conversionPair
    ? formatExactPresentationCashAmount(customer.expectedReceiveBaseUnits, metadata.toAsset.decimals, conversionPair.to.code)
    : tradeDisplayAmount(customer.expectedReceiveBaseUnits, metadata.toAsset) : "";
  return <MoneyModalStep step={step === "failed" ? "confirm" : step} depth={depth + (step === "amount" ? 0 : step === "dispatch-unknown" ? 2 : 1)}>
      <MoneyModalHeader title={step === "amount" ? conversion ? `Convert to ${conversion.to.name}` : `${direction === "buy" ? "Buy" : "Sell"} ${assetName}` : step === "dispatch-unknown" ? "Check Activity" : "Confirm"} titleId="trade-action-title"
        {...(step === "amount" ? onBack ? { onBack } : { assetControl: <MoneyAssetPicker {...amountAssetProps} locked /> } : canGoBack ? { onBack: back, backDisabled: busy !== null } : {})} closeLabel={conversion ? "Close conversion" : "Close trade dialog"} />
      <MoneyModalBody hasFooter className="gap-4 pt-4">
        {step === "amount" ? <MoneyAmountDisplay amount={amount} maxDecimals={decimals} readOnly={busy !== null} onAmountChange={(value) => { if (busy !== null) return; setAmount(value); onAmountChange?.(value); setMaxSelected(false); }}
            onMaxSelect={() => { if (busy === null) setMaxSelected(true); }}
            overAvailable={exceedsAvailable} onSubmit={canContinue && busy === null ? () => void prepare() : undefined}
            {...amountAssetProps} assetControl="header" assetLocked
            nativeSymbol={symbol} unit={conversion || direction === "buy" ? cashUnit : sellUnit}
            availableLabel={reservePending ? reserveFailed ? "Network fee unavailable" : "Checking network fee…" : maxBaseUnits !== null ? `${decimalFromBaseUnits(maxBaseUnits, decimals)} available` : "Balance unavailable"}
            availableAmount={!reservePending && maxBaseUnits !== null ? decimalFromBaseUnits(maxBaseUnits, decimals) : null} chipSet="max">
            {reservePending && reserveFailed
              ? <Notice tone="error"><span className="flex flex-wrap items-center gap-x-2">Couldn&apos;t check the network fee.<Button variant="link" size="inline" aria-busy={reserveRetrying || undefined} onClick={() => { if (!reserveRetrying) retryReserve(); }}>Try again</Button></span></Notice>
              : null}
            {maxBaseUnits === null ? <Notice>Balance unavailable. Try again shortly.</Notice> : null}
          </MoneyAmountDisplay> : null}
        {prepared && metadata && customer && step !== "amount" && step !== "dispatch-unknown" ? <MoneyConfirmSummary key={prepared.id} action={prepared}
          amount={spentAmount} lead={conversion ? `Convert ${conversion.from.code} to ${conversion.to.code}` : `${direction === "buy" ? "Buy" : "Sell"} ${assetName}`}
          rows={conversionPair ? [
            { label: "You pay", value: spentAmount },
            { label: "You receive", value: `≈ ${receivedAmount}` },
            { label: "Rate", value: tradeRateLabel(metadata) },
            ...metadata.operatorFee ? [{ label: SERVICE_FEE_LABEL, value: serviceFeeValue(metadata.operatorFee) }] : [],
          ] : [
            { label: "You get", value: `≈ ${receivedAmount}` },
            ...metadata.operatorFee ? [{ label: SERVICE_FEE_LABEL, value: serviceFeeValue(metadata.operatorFee) }] : [],
          ]}
          details={tradeDetailRows(prepared, metadata, customer, actionExpired ? 0 : secondsLeft, conversionPair)} /> : null}
        {step === "dispatch-unknown" ? <Notice tone="error" role="alert">{conversion ? "This conversion may have been submitted. Check Activity for its result." : "This trade may have been submitted. Check Activity for its result."}</Notice> : null}
        {expiredUnresolved ? <Notice tone="error" role="alert">{conversion ? "This quote expired before the outcome was recorded. Check Activity before converting again." : "This quote expired before the outcome was recorded. Check Activity before trading again."}</Notice>
          : error ? <Notice tone="error" role="alert">{error}</Notice> : null}
      </MoneyModalBody>
      {step === "amount" ? <MoneyModalFooter primaryLabel={busy === "quote" ? "Getting quote…" : "Continue"} primaryDisabled={!canContinue} primaryLoading={busy === "quote"} onPrimary={() => void prepare()} /> : null}
      {step === "confirm" && prepared ? <MoneyConfirmFooter action={prepared} actionExpired={actionExpired} submitting={busy !== null}
        primaryLabel={busy === "quote" ? "Getting quote…" : expiredUnresolved ? "Close" : expiryRecovery ? "Get new quote" : attempted ? "Retry" : `${conversion ? "Convert" : direction === "buy" ? "Buy" : "Sell"} ${spentAmount}`}
        primaryDisabled={!metadata} onPrimary={() => void (expiredUnresolved ? close() : expiryRecovery ? prepare(true) : confirm())}
        {...(canGoBack ? { secondaryLabel: "Back", onSecondary: back } : {})} /> : null}
      {step === "failed" ? <MoneyModalFooter primaryLabel="Back" onPrimary={back} secondaryLabel="Close" onSecondary={close} /> : null}
      {step === "dispatch-unknown" ? <MoneyModalFooter primaryLabel="Close" onPrimary={close} /> : null}
  </MoneyModalStep>;
}

function parseTradeAmount(value: string, decimals: number): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim().replace(/\.$/, ""));
  if (!match || (match[2]?.length ?? 0) > decimals) return null;
  const atoms = BigInt(match[1] + (match[2] ?? "").padEnd(decimals, "0"));
  return atoms > BigInt(0) ? atoms.toString() : null;
}
function matchesPreparedTrade(action: PreparedMoneyAction, session: VerifiedAccountSession, request: TradeActionParams, token: TradeToken): boolean {
  const metadata = action.metadata;
  const traded = metadata?.product === "trade" ? request.direction === "buy" ? metadata.toAsset : metadata.fromAsset : null;
  const cash = metadata?.product === "trade" ? request.direction === "buy" ? metadata.fromAsset : metadata.toAsset : null;
  const customer = metadata?.product === "trade" ? customerAmountsIfValid(metadata) : null;
  return action.kind === "trade" && !!session.smartAccount &&
    action.owner.subject === session.user.subject && action.owner.accountProvider === session.accountProvider &&
    action.owner.chainId === 8453 && action.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    metadata?.product === "trade" && metadata.direction === request.direction && metadata.assetId === request.assetId &&
    traded?.id === token.assetId && traded.address.toLowerCase() === token.address.toLowerCase() &&
    traded.symbol === token.symbol && traded.decimals === token.decimals &&
    cash?.id === "usdc" && cash.symbol === "USDC" && cash.decimals === 6 && cash.address.toLowerCase() === BASE_USDC.address.toLowerCase() &&
    !!customer && (request.amountBaseUnits === TRADE_SELL_ALL || customer.spendBaseUnits === request.amountBaseUnits) &&
    metadata.slippageBps === TRADE_SLIPPAGE_BPS && metadata.network.name === "Base" && metadata.network.chainId === 8453 &&
    action.amounts.some((amount) => amount.direction === "spend" && amount.amountBaseUnits === customer.spendBaseUnits && amount.assetId === metadata.fromAsset.id) &&
    action.amounts.some((amount) => amount.direction === "receive" && amount.assetId === metadata.toAsset.id && amount.amountBaseUnits === customer.expectedReceiveBaseUnits && amount.estimated) &&
    Number.isFinite(Date.parse(action.expiresAt)) && !!action.signing;
}
function customerAmountsIfValid(metadata: TradeMoneyActionMetadata): TradeCustomerAmounts | null {
  const swap = [metadata.fromAmountBaseUnits, metadata.expectedToAmountBaseUnits, metadata.minimumToAmountBaseUnits];
  if (!swap.every((amount) => /^\d+$/.test(amount) && BigInt(amount) > BigInt(0))) return null;
  if (metadata.operatorFee !== undefined) {
    const fee = parseOperatorFeeRecord(metadata.operatorFee);
    const cash = metadata.direction === "buy" ? metadata.fromAsset : metadata.toAsset;
    if (!fee || cash.address.toLowerCase() !== fee.token.address) return null;
    const feeBasis = metadata.direction === "buy"
      ? BigInt(metadata.fromAmountBaseUnits) + BigInt(fee.amountBaseUnits) : BigInt(metadata.minimumToAmountBaseUnits);
    if (BigInt(fee.amountBaseUnits) > operatorFeeAmount(feeBasis, fee.bps)) return null;
  }
  const customer = tradeCustomerAmounts(metadata);
  return BigInt(customer.expectedReceiveBaseUnits) > BigInt(0) && BigInt(customer.minimumReceiveBaseUnits) > BigInt(0) ? customer : null;
}
function tradeDisplayAmount(amount: string, asset: TradeMoneyActionMetadata["fromAsset"]): string {
  return asset.id === "usdc" ? formatUsdStablecoinAmount(amount) : formatExactPresentationTokenAmount(amount, asset.decimals, asset.symbol);
}
function tradeContractRow(metadata: TradeMoneyActionMetadata): MoneyConfirmRow {
  const traded = metadata.direction === "buy" ? metadata.toAsset : metadata.fromAsset;
  return { label: `${traded.symbol} contract`, value: <CopyableValue value={traded.address} presentation="reveal" valueKind="contract" className="-my-3 justify-end" /> };
}
function tradeDetailRows(action: PreparedMoneyAction, metadata: TradeMoneyActionMetadata, customer: TradeCustomerAmounts, secondsLeft: number, conversionPair: { from: CashConversionCurrency; to: CashConversionCurrency } | null): MoneyConfirmRow[] {
  return [
    { label: "Minimum received", value: conversionPair ? formatExactPresentationCashAmount(customer.minimumReceiveBaseUnits, metadata.toAsset.decimals, conversionPair.to.code) : tradeDisplayAmount(customer.minimumReceiveBaseUnits, metadata.toAsset) },
    ...(!conversionPair ? [{ label: "Rate", value: tradeRateLabel(metadata) }] : []),
    { label: "Max slippage", value: `${metadata.slippageBps / 100}%` },
    ...metadata.fees.filter((fee) => fee.kind !== "gas").map((fee) => ({ label: "Protocol fee", value: formatExactPresentationTokenAmount(fee.amountBaseUnits, fee.decimals, fee.symbol) })),
    { label: "Quote expires in", value: secondsLeft > 0 ? `${secondsLeft}s` : "Expired" },
    { label: "Network", value: metadata.network.name },
    moneyConfirmFromRow(action.owner),
    tradeContractRow(metadata),
  ];
}
function messageForTradeError(error: unknown, direction: TradeDirection, conversion?: TradeMoneyFlowProps["conversion"]): string {
  const networkFee = networkFeeErrorMessage(error);
  if (networkFee) return networkFee;
  if (error instanceof Error && (error.message.startsWith("The quote did not match") || error.message.startsWith("The conversion quote did not match"))) return error.message;
  const code = isRecord(error) ? error.code : null;
  if (isTradeErrorCode(code)) {
    if (conversion) {
      if (code === "TRADE_NOT_ROUTED" || code === "TRADE_ROUTE_UNAVAILABLE") return `Can't convert to ${conversion.to.name} right now. Try a different amount or try again later.`;
      if (code === "TRADE_INSUFFICIENT_BALANCE") return `Your ${conversion.from.name} balance changed. Review the amount again.`;
      if (code === "TRADE_BUY_UNAVAILABLE" || code === "TRADE_UNAVAILABLE" || code === "TRADE_SIGNER_UNSUPPORTED") return "Conversion isn't available right now. Try again later.";
      if (code === "TRADE_TOKEN_UNREADABLE") return `Can't read ${conversion.to.name} on Base right now. Try again later.`;
    }
    switch (code) {
      case PRODUCT_NOT_OFFERED_CODE: return "This is no longer offered.";
      case "TRADE_STOCK_RESTRICTED": return "Stock buys aren't available in your location.";
      case "TRADE_NOT_ROUTED": return "This asset can't be traded in Home yet.";
      case "TRADE_ROUTE_UNAVAILABLE": return "No route for this amount. Try a different amount or try again later.";
      case "TRADE_BELOW_MINIMUM": return "This amount is below the trade minimum. Enter a larger amount.";
      case "TRADE_TOKEN_UNREADABLE": return "This token couldn't be read on Base. Try again later.";
      case "TRADE_BUY_UNAVAILABLE": return "Buying is unavailable. You can still sell or send.";
      case "TRADE_INSUFFICIENT_BALANCE": return direction === "sell" ? "Your token balance changed. Review the amount again." : "Your Cash balance changed. Review the amount again.";
      case "TRADE_QUOTE_STALE":
      case "TRADE_QUOTE_REJECTED": return "This quote changed. Get a new quote.";
      case "TRADE_SIGNER_UNSUPPORTED": return "Trading isn't available for this account.";
      case "TRADE_UNAVAILABLE": return "Trading isn't available right now. Try again later.";
      case "TRADE_INVALID": return "Enter a valid amount and try again.";
    }
  }
  return "Couldn't get a quote. Try again later.";
}
function Notice({ children, tone = "neutral", ...props }: Omit<ComponentProps<typeof Alert>, "children"> & { children: ReactNode; tone?: "neutral" | "error" }) {
  return <Alert ref={tone === "error" ? revealNotice : undefined} variant={tone === "error" ? "destructive" : "default"} role={tone === "error" ? "alert" : "status"} {...props}><AlertDescription>{children}</AlertDescription></Alert>;
}
function revealNotice(node: HTMLDivElement | null) {
  node?.scrollIntoView?.({ block: "nearest" });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
