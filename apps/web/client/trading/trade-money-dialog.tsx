"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { useReactiveExpiry } from "@/client/actions/expiry";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import {
  MoneyAmountDisplay, MoneyConfirmFooter, MoneyConfirmSummary, MoneyModal,
  MoneyModalBody, MoneyModalFooter, MoneyModalHeader,
  decimalFromBaseUnits, isPositiveDecimalAmount, moneyConfirmFromRow,
} from "@/client/money-modal";
import { Button } from "@/components/ui/button";
import { maxAmountAfterNetworkFee, useNetworkFeeReserveState } from "@/client/money-modal/network-fee-policy";
import { reportClientError } from "@/client/observability/client-reporter";
import { formatExactPresentationTokenAmount, formatUsdStablecoinAmount } from "@/shared/formatting";
import { networkFeeErrorMessage } from "@/shared/money-actions/network-fee";
import type { PreparedMoneyAction, OperationResult } from "@/shared/money-actions/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { TransferExecutionError } from "@/shared/transfers/types";
import {
  TRADE_ACTION_CONTRACT_VERSION, TRADE_ASSET_ID, TRADE_SLIPPAGE_BPS,
  isTradeErrorCode, type TradeActionParams, type TradeDirection, type TradeMoneyActionMetadata,
} from "@/shared/trading/contract";

type Props = {
  open: boolean;
  direction: TradeDirection;
  session: VerifiedAccountSession;
  availableBaseUnits: string | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
  prepareMoneyAction: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction: AccountWalletClient["executeMoneyAction"];
  onClose: () => void;
  onClosed?: () => void;
  onConfirmed?: (result: OperationResult) => void | Promise<void>;
};
type Step = "amount" | "confirm" | "pending" | "failed";

export function TradeMoneyDialog({ open, direction, session, availableBaseUnits, fetchAccountResource, prepareMoneyAction, executeMoneyAction, onClose, onClosed, onConfirmed }: Props) {
  const ownerKey = session.smartAccount ? dataOwnerKey(session) : null;
  const { reserve, failed: reserveFailed, retrying: reserveRetrying, retry: retryReserve } = useNetworkFeeReserveState(ownerKey, fetchAccountResource, open);
  const maxBaseUnits = direction === "buy" ? maxAmountAfterNetworkFee(availableBaseUnits, "USDC", reserve) : availableBaseUnits;
  const decimals = direction === "buy" ? 6 : 8;
  const symbol = direction === "buy" ? "USDC" : "BTC";
  const [amount, setAmount] = useState("");
  const [amountBaseUnits, setAmountBaseUnits] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedMoneyAction | null>(null);
  const [step, setStep] = useState<Step>("amount");
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [serverExpiredId, setServerExpiredId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const preparation = useRef(0);
  const metadata = prepared?.metadata?.product === "trade" ? prepared.metadata : null;
  const { expired, recheckExpired } = useReactiveExpiry(prepared?.expiresAt ?? null);
  const actionExpired = expired || (prepared !== null && serverExpiredId === prepared.id);
  const expiredUnresolved = step === "confirm" && actionExpired && attempted;
  const canGoBack = step === "failed" || (step === "confirm" && !attempted);
  const secondsLeft = prepared ? Math.max(0, Math.ceil((Date.parse(prepared.expiresAt) - now) / 1000)) : 0;
  useEffect(() => {
    if (step !== "confirm" || !prepared || actionExpired) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step, prepared, actionExpired]);
  useEffect(() => () => { preparation.current += 1; }, []);

  function changeAmount(value: string) {
    setAmount(value);
  }
  function close() {
    preparation.current += 1;
    setAmount(""); setAmountBaseUnits(null); setPrepared(null); setAttempted(false);
    setServerExpiredId(null); setStep("amount"); setError(null);
    onClose();
  }
  function back() {
    setPrepared(null); setServerExpiredId(null); setAttempted(false); setError(null); setStep("amount");
  }
  const enteredBaseUnits = parseTradeAmount(amount, decimals);
  const reservePending = direction === "buy" && reserve === undefined;
  const exceedsAvailable = !reservePending && enteredBaseUnits !== null && maxBaseUnits !== null && BigInt(enteredBaseUnits) > BigInt(maxBaseUnits);
  const canContinue = !!ownerKey && maxBaseUnits !== null && !reservePending &&
    isPositiveDecimalAmount(amount) && enteredBaseUnits !== null && !exceedsAvailable;

  async function prepare(requote = false) {
    const amountToPrepare = requote ? amountBaseUnits : enteredBaseUnits;
    if (!amountToPrepare || !session.smartAccount) return;
    const request: TradeActionParams = { version: TRADE_ACTION_CONTRACT_VERSION, assetId: TRADE_ASSET_ID, direction, amountBaseUnits: amountToPrepare };
    const generation = ++preparation.current;
    setError(null);
    setStep("pending");
    if (!requote) setAmountBaseUnits(amountToPrepare);
    try {
      const action = await prepareMoneyAction("trade", request);
      if (generation !== preparation.current) return;
      if (!matchesPreparedTrade(action, session, request)) throw new Error("The quote did not match this account or trade. Get a new quote.");
      setPrepared(action); setServerExpiredId(null); setAttempted(false); setNow(Date.now()); setStep("confirm");
    } catch (caught) { // oxlint-disable-line home/no-silent-catch -- superseded quote failures are fenced; current failures show recovery copy
      if (generation !== preparation.current) return;
      setError(messageForTradeError(caught));
      setStep(requote ? "confirm" : "amount");
    }
  }

  async function confirm() {
    if (!prepared || !metadata || step !== "confirm") return;
    if (actionExpired || recheckExpired()) { setServerExpiredId(prepared.id); return; }
    setError(null);
    setStep("pending");
    try {
      const result = await executeMoneyAction(prepared);
      if (result.status === "rejected") {
        setError("The wallet request was rejected. Review the quote and try again.");
        setStep("confirm");
        return;
      }
      setAttempted(true);
      if (result.status === "failed") {
        setError("This trade did not succeed onchain. Check Activity before trading again.");
        setStep("failed");
        return;
      }
      try {
        await onConfirmed?.(result);
      } catch (caught) {
        void reportClientError({ name: caught instanceof Error ? caught.name : "Error", message: caught instanceof Error ? caught.message : "The post-confirm refresh failed.", route: window.location.pathname });
      }
      close();
    } catch (caught) {
      if (isRecord(caught) && (caught.code === "ACTION_EXPIRED" || caught.code === "TRADE_QUOTE_STALE")) {
        setServerExpiredId(prepared.id);
        setError("This quote expired. Get a new quote.");
      } else if (caught instanceof TransferExecutionError && (caught.reason === "not-submitted" || caught.reason === "invalid-request")) {
        setError(caught.reason === "not-submitted" ? "Couldn't sign this trade. Try again or get a new quote." : "This quote can't be signed. Get a new quote.");
      } else {
        setAttempted(true);
        setError("We couldn't confirm this trade yet. Retry to record the same trade, or check Activity before trading again.");
      }
      setStep("confirm");
    }
  }

  return <MoneyMotionProvider>
    <MoneyModal open={open} labelledBy="trade-action-title" pending={step === "pending"} onCancel={close} onClose={onClosed ?? (() => {})}>
      <MoneyModalHeader title={step === "amount" ? direction === "buy" ? "Buy Bitcoin" : "Sell Bitcoin" : "Confirm"} titleId="trade-action-title"
        {...(canGoBack ? { onBack: back } : {})} onClose={close} closeLabel="Close trade dialog" />
      <MoneyModalBody hasFooter={step !== "pending"} className="gap-4 pt-4">
        {step === "amount" ? <>
          <MoneyAmountDisplay amount={amount} maxDecimals={decimals} onAmountChange={changeAmount}
            overAvailable={exceedsAvailable} onSubmit={canContinue ? () => void prepare() : undefined}
            assetId={direction === "buy" ? "usdc" : "cbbtc"} assetLabel={symbol} assetLocked
            fiatCurrency={direction === "buy" ? "USD" : undefined}
            nativeSymbol={symbol} pricing={direction === "buy" ? { status: "priced", localCurrency: "USD", nativePerLocal: { atoms: "1", scale: 0 } } : { status: "unpriced" }}
            availableLabel={reservePending ? reserveFailed ? "Network fee unavailable" : "Checking network fee…" : maxBaseUnits !== null ? `${decimalFromBaseUnits(maxBaseUnits, decimals)} available` : "Balance unavailable"}
            availableAmount={!reservePending && maxBaseUnits !== null ? decimalFromBaseUnits(maxBaseUnits, decimals) : null} chipSet="max">
            {reservePending && reserveFailed
              ? <Notice tone="error"><span className="flex flex-wrap items-center gap-x-2">Couldn&apos;t check the network fee.<Button variant="link" size="inline" aria-busy={reserveRetrying || undefined} onClick={() => { if (!reserveRetrying) retryReserve(); }}>Try again</Button></span></Notice>
              : null}
            {maxBaseUnits === null ? <Notice>Balance unavailable. Try again shortly.</Notice> : null}
          </MoneyAmountDisplay>
        </> : null}
        {prepared && metadata && step !== "amount" ? <MoneyConfirmSummary action={prepared}
          amount={tradeDisplayAmount(metadata.direction, metadata.fromAmountBaseUnits)}
          lead={direction === "buy" ? "Buy Bitcoin" : "Sell Bitcoin"}
          rows={tradeReviewRows(prepared, metadata, actionExpired ? 0 : secondsLeft)} /> : null}
        {step === "pending" ? <Notice><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{prepared ? "Waiting for your wallet…" : "Getting a quote…"}</span></Notice> : null}
        {expiredUnresolved ? <Notice tone="error" role="alert">This quote expired before the outcome was recorded. Check Activity before trading again.</Notice>
          : error ? <Notice tone="error" role="alert">{error}</Notice> : null}
      </MoneyModalBody>
      {step === "amount" ? <MoneyModalFooter primaryLabel="Continue" primaryDisabled={!canContinue} onPrimary={() => void prepare()} /> : null}
      {step === "confirm" && prepared ? <MoneyConfirmFooter action={prepared} actionExpired={actionExpired}
        primaryLabel={expiredUnresolved ? "Close" : actionExpired ? "Get new quote" : attempted ? "Retry" : `${direction === "buy" ? "Buy" : "Sell"} ${tradeDisplayAmount(direction, amountBaseUnits ?? "0")}`}
        primaryDisabled={!metadata} onPrimary={() => void (expiredUnresolved ? close() : actionExpired ? prepare(true) : confirm())}
        {...(canGoBack ? { secondaryLabel: "Back", onSecondary: back } : {})} /> : null}
      {step === "failed" ? <MoneyModalFooter primaryLabel="Back" onPrimary={back} secondaryLabel="Close" onSecondary={close} /> : null}
    </MoneyModal>
  </MoneyMotionProvider>;
}

function parseTradeAmount(value: string, decimals: number): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim().replace(/\.$/, ""));
  if (!match || (match[2]?.length ?? 0) > decimals) return null;
  const atoms = BigInt(match[1] + (match[2] ?? "").padEnd(decimals, "0"));
  return atoms > BigInt(0) ? atoms.toString() : null;
}
function matchesPreparedTrade(action: PreparedMoneyAction, session: VerifiedAccountSession, request: TradeActionParams): boolean {
  const metadata = action.metadata;
  return action.kind === "trade" && !!session.smartAccount &&
    action.owner.subject === session.user.subject && action.owner.accountProvider === session.accountProvider &&
    action.owner.chainId === 8453 && action.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    metadata?.product === "trade" && metadata.direction === request.direction &&
    metadata.fromAsset.id === (request.direction === "buy" ? "usdc" : "cbbtc") &&
    metadata.toAsset.id === (request.direction === "buy" ? "cbbtc" : "usdc") &&
    metadata.fromAmountBaseUnits === request.amountBaseUnits &&
    metadata.slippageBps === TRADE_SLIPPAGE_BPS && metadata.network.name === "Base" && metadata.network.chainId === 8453 &&
    /^\d+$/.test(metadata.expectedToAmountBaseUnits) && BigInt(metadata.expectedToAmountBaseUnits) > BigInt(0) &&
    /^\d+$/.test(metadata.minimumToAmountBaseUnits) && BigInt(metadata.minimumToAmountBaseUnits) > BigInt(0) &&
    action.amounts.some((amount) => amount.direction === "spend" && amount.amountBaseUnits === request.amountBaseUnits && amount.assetId === metadata.fromAsset.id) &&
    action.amounts.some((amount) => amount.direction === "receive" && amount.assetId === metadata.toAsset.id && amount.amountBaseUnits === metadata.expectedToAmountBaseUnits && amount.estimated) &&
    Number.isFinite(Date.parse(action.expiresAt)) && !!action.signing;
}
function tradeDisplayAmount(direction: TradeDirection, amount: string): string {
  return direction === "buy" ? formatUsdStablecoinAmount(amount) : formatExactPresentationTokenAmount(amount, 8, "BTC");
}
function tradeReviewRows(action: PreparedMoneyAction, metadata: TradeMoneyActionMetadata, secondsLeft: number) {
  const formatAsset = (amount: string, asset: TradeMoneyActionMetadata["fromAsset"]) => asset.id === "usdc"
    ? formatUsdStablecoinAmount(amount)
    : formatExactPresentationTokenAmount(amount, 8, "BTC");
  const btcUnits = BigInt(metadata.direction === "buy" ? metadata.expectedToAmountBaseUnits : metadata.fromAmountBaseUnits);
  const usdcUnits = BigInt(metadata.direction === "buy" ? metadata.fromAmountBaseUnits : metadata.expectedToAmountBaseUnits);
  const priceCents = btcUnits > BigInt(0) ? usdcUnits * BigInt(10_000) / btcUnits : BigInt(0);
  return [
    moneyConfirmFromRow(action.owner),
    { label: "You pay", value: formatAsset(metadata.fromAmountBaseUnits, metadata.fromAsset) },
    { label: "You receive (estimated)", value: formatAsset(metadata.expectedToAmountBaseUnits, metadata.toAsset) },
    { label: "Minimum received", value: formatAsset(metadata.minimumToAmountBaseUnits, metadata.toAsset) },
    { label: "Slippage", value: `${metadata.slippageBps / 100}%` },
    { label: "Price", value: `1 BTC ≈ ${formatUsdStablecoinAmount(priceCents, 2)}` },
    ...metadata.fees.map((fee) => ({ label: `${fee.kind === "gas" ? "Gas" : "Protocol"} fee`, value: formatExactPresentationTokenAmount(fee.amountBaseUnits, fee.decimals, fee.symbol) })),
    { label: "Network", value: metadata.network.name },
    { label: "Quote expires in", value: secondsLeft > 0 ? `${secondsLeft}s` : "Expired" },
  ];
}
function messageForTradeError(error: unknown): string {
  const networkFee = networkFeeErrorMessage(error);
  if (networkFee) return networkFee;
  if (error instanceof Error && error.message.startsWith("The quote did not match")) return error.message;
  const code = isRecord(error) ? error.code : null;
  if (isTradeErrorCode(code)) {
    switch (code) {
      case "TRADE_NO_LIQUIDITY": return "No liquidity for this amount. Try a smaller trade.";
      case "TRADE_INSUFFICIENT_BALANCE": return "Not enough balance for this trade. Try a smaller amount.";
      case "TRADE_QUOTE_STALE": case "TRADE_QUOTE_REJECTED": return "This quote changed. Get a new quote.";
      case "TRADE_SIGNER_UNSUPPORTED": return "Trading isn't available for this account.";
      case "TRADE_UNAVAILABLE": return "Trading isn't available right now. Try again later.";
      case "TRADE_INVALID": return "Enter a valid amount and try again.";
    }
  }
  return "Couldn't get a quote. Try again shortly.";
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
