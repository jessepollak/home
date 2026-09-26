"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MoneyMotionProvider } from "@/components/money-ticker";
import {
  MoneyAmountDisplay, MoneyAssetPicker, MoneyConfirmFooter,
  MoneyModal, MoneyModalBody, MoneyModalFooter, MoneyModalHeader,
  useMoneyAssetPricing,
} from "@/client/money-modal";
import { useReactiveExpiry } from "@/client/actions/expiry";
import { useHomeToast } from "@/client/home/use-home-toast";
import type { OperationResult } from "@/shared/money-actions/types";
import { formatFiatAmount } from "@/shared/formatting";
import { TransferExecutionError, type TransferFailureReason } from "@/shared/transfers/types";
import { fixtureCash, fixtureHolding, fixtureMaxNetworkFee, quoteAmount, quoteFiatReceive, quoteSpendLabel, type TradeQuote } from "./trade-fixtures";
import { TradeStepTransition } from "./trade-step-transition";
import { TradeSummary } from "./trade-summary";
import { TradeDetails } from "./trade-details";

export type TradeStep =
  | { name: "amount"; error?: "no-liquidity" | "provider-unavailable" | "insufficient-balance" | "unsupported-signer" }
  | { name: "review" | "signing" | "wallet-rejected" | "quote-expired"; quote: TradeQuote }
  | { name: "execution-error"; quote: TradeQuote; error: "stale-session" | "unavailable" };

export type TradeSheetProps = {
  open: boolean;
  side: "buy" | "sell";
  initialState?: { step: TradeStep; amount: string };
  available?: string;
  reducedMotion?: boolean;
  timeZone?: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  prepareQuote: (side: "buy" | "sell", amount: string) => Promise<TradeQuote>;
  execute: (quote: TradeQuote) => Promise<OperationResult>;
};

const errorCopy = {
  "no-liquidity": "Not enough liquidity. Try a smaller amount.",
  "provider-unavailable": "Couldn't get a quote. Try again.",
  "insufficient-balance": "Your balance changed. Enter a new amount.",
  "unsupported-signer": "Your wallet can't trade in Home yet.",
} as const;

function isValidAmount(amount: string, available: string) {
  return /^\d+(?:\.\d+)?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(available);
}

function buyLimit(balance: string) {
  function micros(value: string) {
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
    return match ? BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0")) : BigInt(0);
  }
  const remaining = micros(balance) - micros(fixtureMaxNetworkFee);
  const limit = remaining > BigInt(0) ? remaining : BigInt(0);
  const fraction = (limit % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return `${limit / BigInt(1_000_000)}${fraction ? `.${fraction}` : ""}`;
}

export function TradeSheet({ open, side, initialState, available, reducedMotion, timeZone, onClose, returnFocusRef, prepareQuote, execute }: TradeSheetProps) {
  const [step, setStep] = useState<TradeStep>(initialState?.step ?? { name: "amount" });
  const [amount, setAmount] = useState(initialState?.amount ?? "");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [preparing, setPreparing] = useState(false);
  const [details, setDetails] = useState<{ quoteId: string; open: boolean } | null>(null);
  const { add } = useHomeToast(null);
  const requestRef = useRef(0);
  const detailsRef = useRef<HTMLDivElement>(null);
  const pricing = useMoneyAssetPricing(side === "buy" ? "USDC" : "cbBTC");
  const asset = side === "buy" ? "USDC" : "cbBTC";
  const balance = available ?? (side === "buy" ? fixtureCash : fixtureHolding);
  const limit = side === "buy" ? buyLimit(balance) : balance;
  const tooMuch = Number(amount) > Number(limit);
  const canContinue = !preparing && isValidAmount(amount, limit) && step.name === "amount"
    && step.error !== "unsupported-signer" && step.error !== "insufficient-balance" && step.error !== "no-liquidity";
  const pending = step.name === "signing";
  const quote = "quote" in step ? step.quote : null;
  const { expired, recheckExpired } = useReactiveExpiry(quote && (step.name === "review" || step.name === "wallet-rejected" || step.name === "execution-error") ? quote.action.expiresAt : null);
  const title = step.name === "amount" ? `${side === "buy" ? "Buy" : "Sell"} Bitcoin` : "Confirm";
  const quoteId = quote?.action.quoteId ?? quote?.action.id ?? "";
  const detailsOpen = details?.quoteId === quoteId && details.open || false;
  const detailsId = "fixture-trade-details";

  useEffect(() => {
    if (!open) invalidate();
  }, [open]);

  useEffect(() => {
    invalidate();
  }, [side]);

  useEffect(() => {
    if (open && detailsOpen) detailsRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [open, detailsOpen, quoteId]);

  useEffect(() => {
    if (!expired || !quote || (step.name !== "review" && step.name !== "wallet-rejected" && step.name !== "execution-error")) return;
    const timer = window.setTimeout(() => setStep({ name: "quote-expired", quote }), 0);
    return () => window.clearTimeout(timer);
  }, [expired, quote, step.name]);

  function invalidate() {
    requestRef.current += 1;
    setPreparing(false);
  }

  function close() {
    invalidate();
    setDetails(null);
    onClose();
  }

  function changeAmount(value: string) {
    invalidate();
    setAmount(value);
    if (step.name === "amount" && step.error && step.error !== "unsupported-signer") setStep({ name: "amount" });
  }

  function resetAfterClose() {
    if (document.activeElement === document.body || document.activeElement?.closest("[data-money-sheet]")) returnFocusRef?.current?.focus({ preventScroll: true });
    invalidate();
    setAmount("");
    setDirection("forward");
    setDetails(null);
    setStep({ name: "amount" });
  }

  function back() {
    invalidate();
    setDirection("back");
    setDetails(null);
    setStep({ name: "amount" });
  }

  async function requestQuote(onError: (error: unknown) => TradeStep) {
    const request = ++requestRef.current;
    setPreparing(true);
    let next: TradeStep;
    try {
      next = { name: "review", quote: await prepareQuote(side, amount) };
    } catch (error) {
      next = onError(error);
    }
    if (request !== requestRef.current) return;
    setPreparing(false);
    setDirection("forward");
    setStep(next);
  }

  async function prepare() {
    if (preparing || !isValidAmount(amount, limit)) return;
    await requestQuote((error) => {
      const code = error instanceof Error ? error.message : "provider-unavailable";
      return { name: "amount", error: code in errorCopy ? code as keyof typeof errorCopy : "provider-unavailable" };
    });
  }

  async function confirm() {
    if (!quote || step.name === "signing") return;
    if (recheckExpired()) {
      setStep({ name: "quote-expired", quote });
      return;
    }
    const request = ++requestRef.current;
    setStep({ name: "signing", quote });
    let result: OperationResult | { reason: TransferFailureReason };
    try {
      result = await execute(quote);
    } catch (error) {
      result = { reason: error instanceof TransferExecutionError ? error.reason : "unavailable" };
    }
    if (request !== requestRef.current) return;
    if ("reason" in result) {
      if (result.reason === "submission-unknown") result = { id: quote.action.id, status: "unknown" };
      else if (result.reason === "rejected") result = { id: quote.action.id, status: "rejected" };
      else if (result.reason === "insufficient-balance") {
        setDirection("back");
        setDetails(null);
        setStep({ name: "amount", error: "insufficient-balance" });
        return;
      } else {
        setStep({ name: "execution-error", quote, error: result.reason === "stale-session" ? "stale-session" : "unavailable" });
        return;
      }
    }
    if (result.status === "rejected") {
      setStep({ name: "wallet-rejected", quote });
      return;
    }
    close();
    const spend = quoteSpendLabel(quote);
    if (result.status === "confirmed") {
      const received = side === "sell" ? formatFiatAmount(quote.result.confirmedReceive.replace(/ USDC$/, "").replaceAll(",", ""), "USD") : quote.result.confirmedReceive;
      add({ message: side === "buy" ? `Bought ${received}` : quote.all ? `Sold all your Bitcoin for ${received}` : `Sold ${spend} for ${received}`, tone: "success", role: "status" });
    } else if (result.status === "failed") {
      add({ message: side === "buy" ? `Trade failed. Your ${spend} is still in Cash.` : `Trade failed. Your ${spend} is still in your investments.`, tone: "error", role: "alert", duration: 10_000 });
    } else if (result.status === "unknown") {
      add({ message: "Can't confirm your trade yet. Check Activity before trying again.", tone: "neutral", role: "status", duration: 10_000 });
    } else {
      add({ message: side === "buy" ? `Buying ${spend} of Bitcoin` : quote.all ? "Selling all your Bitcoin" : `Selling ${spend}`, tone: "neutral", role: "status" });
    }
  }

  async function refresh() {
    if (!quote || preparing) return;
    await requestQuote(() => ({ name: "amount", error: "provider-unavailable" }));
  }

  return (
    <MoneyMotionProvider reducedMotion={reducedMotion ? true : undefined}>
      <MoneyModal open={open} immediate={reducedMotion === true} labelledBy="fixture-trade-title" pending={pending} onCancel={close} onClose={resetAfterClose}>
        <MoneyModalHeader title={title} titleId="fixture-trade-title" onClose={close} {...(step.name === "amount" ? { assetControl: <MoneyAssetPicker assetId={`fixture-${asset.toLowerCase()}`} assetLabel={asset} locked /> } : step.name === "review" || step.name === "wallet-rejected" || step.name === "execution-error" || step.name === "quote-expired" ? { onBack: back } : {})} />
        <MoneyModalBody hasFooter className="gap-4 pt-4">
          <TradeStepTransition stepKey={step.name === "amount" ? "amount" : "review"} direction={direction} reducedMotion={reducedMotion ? true : undefined}>
            {step.name === "amount" ? (
              <>
                <MoneyAmountDisplay amount={amount} maxDecimals={side === "buy" ? 6 : 8} onAmountChange={changeAmount} overAvailable={tooMuch} onSubmit={canContinue ? () => void prepare() : undefined} availableLabel={side === "buy" ? `${formatFiatAmount(limit, "USD")} available` : `${balance} cbBTC available`} availableAmount={limit} chipSet="max" assetId={`fixture-${asset.toLowerCase()}`} assetLabel={asset} assetControl="header" pricing={pricing} nativeSymbol={asset} />
                {step.error ? <p role="alert" className="min-w-0 break-words text-center text-sm text-foreground">{errorCopy[step.error]}</p> : null}
              </>
            ) : quote ? (
              <div className="space-y-4">
                {step.name === "wallet-rejected" ? <Alert role="alert"><AlertDescription>You declined in your wallet. Your review is still ready.</AlertDescription></Alert> : null}
                {step.name === "execution-error" ? <Alert role="alert"><AlertDescription>{step.error === "stale-session" ? "Your session ended. Sign in again, then try again." : "Couldn't start your trade. Try again."}</AlertDescription></Alert> : null}
                {step.name === "quote-expired" ? <Alert role="alert"><AlertDescription>This quote expired.</AlertDescription></Alert> : null}
                <div className={step.name === "quote-expired" ? "opacity-60" : undefined}>
                  <TradeSummary amount={quoteSpendLabel(quote)} lead={quote.lead} receive={side === "buy" ? quoteAmount(quote, "receive") : quoteFiatReceive(quote)} action={quote.action} />
                </div>
                <Button variant="ghost" size="touch" className="w-full" aria-expanded={detailsOpen} aria-controls={detailsId} disabled={pending} onClick={() => setDetails({ quoteId, open: !detailsOpen })}>Details {detailsOpen ? <ChevronUp data-icon="inline-end" aria-hidden="true" /> : <ChevronDown data-icon="inline-end" aria-hidden="true" />}</Button>
                {detailsOpen ? <div ref={detailsRef} className={step.name === "quote-expired" ? "opacity-60" : undefined}><TradeDetails id={detailsId} quote={quote} timeZone={timeZone} reducedMotion={reducedMotion} /></div> : null}
              </div>
            ) : null}
          </TradeStepTransition>
        </MoneyModalBody>
        {step.name === "amount" ? <MoneyModalFooter primaryLabel={preparing ? "Getting quote…" : step.error === "provider-unavailable" ? "Try again" : "Continue"} primaryDisabled={!canContinue} onPrimary={() => void prepare()} /> : null}
        {quote && (step.name === "review" || step.name === "wallet-rejected" || step.name === "execution-error" || pending) ? <MoneyConfirmFooter action={quote.action} actionExpired={expired} primaryLabel={quote.side === "buy" ? `Buy ${quoteSpendLabel(quote)}` : quote.all ? "Sell all Bitcoin" : `Sell ${quoteSpendLabel(quote)}`} submitting={pending} secondaryLabel="Back" onSecondary={back} onPrimary={() => void confirm()} /> : null}
        {quote && step.name === "quote-expired" ? <MoneyConfirmFooter action={quote.action} actionExpired primaryLabel={preparing ? "Getting quote…" : "Get new quote"} primaryDisabled={preparing} onPrimary={() => void refresh()} secondaryLabel="Back" onSecondary={back} /> : null}
      </MoneyModal>
    </MoneyMotionProvider>
  );
}
