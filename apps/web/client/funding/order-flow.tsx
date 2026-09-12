"use client";

import { useEffect, useState } from "react";
import { CopyableValue } from "@/components/copyable-value";
import { MoneyAmountDisplay, MoneyModalFooter, MoneyNumpad } from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import styles from "./add-money.module.css";

export type FundingBinding = {
  providerId: string;
  displayName: string;
  region: string;
  assetId: string;
  assetSymbol: string;
  assetDecimals: number;
  currency: string;
  paymentMethods: ReadonlyArray<{ id: string; label: string }>;
  quotes: boolean;
  kyc: { terms?: { url: string }; fields?: ReadonlyArray<{ name: string; label: string; type: "text" | "email" | "date" | "select"; options?: ReadonlyArray<string> }> } | null;
};

type FundingQuote = {
  fiatAmount: string;
  tokenAmountAtomic: string;
  fees: ReadonlyArray<{ label: string; amount: string; currency: string }>;
  feesKnown?: boolean;
  expiresAt: string;
};
type QuoteDraft = { quote: FundingQuote; quoteToken: string };
export type FundingOrderSummary = {
  id: string;
  providerId: string;
  state: string;
  fiatAmount: string;
  quote?: FundingQuote;
  quoteToken?: string;
  expectedTokenAmountAtomic?: string | null;
  fees?: ReadonlyArray<{ label: string; amount: string; currency: string }>;
  providerStatus: string | null;
  instructions: Instruction | null;
};
type Instruction =
  | { kind: "redirect"; url: string }
  | { kind: "bank-transfer"; rail: string; accountNumber: string; accountName?: string; bank?: string; alias?: string; reference?: string; amount: string; currency: string }
  | { kind: "qr"; scheme: string; payload: string; amount: string; currency: string }
  | { kind: "payment-key"; scheme: string; key: string; amount: string; currency: string };

type AccountFetch = (path: string, options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }) => Promise<unknown>;

export function FundingOrderFlow({ binding, fetchAccountResource, onBack, initialOrder }: { binding: FundingBinding; fetchAccountResource: AccountFetch; onBack: () => void; initialOrder?: FundingOrderSummary | null }) {
  const [method, setMethod] = useState(binding.paymentMethods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [order, setOrder] = useState<FundingOrderSummary | null>(initialOrder ?? null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmationAttempted, setConfirmationAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order || terminal(order.state)) return;
    const timer = window.setInterval(() => {
      void fetchAccountResource(`/api/funding/orders/${order.id}`).then((value) => {
        const next = readFundingOrder(value); if (next) setOrder(next);
      }).catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [fetchAccountResource, order]);

  async function requestQuote() {
    if (busy || draft || !method || !positiveDecimal(amount)) return;
    setBusy(true); setError(null);
    try {
      const value = await fetchAccountResource("/api/funding/quotes", {
        method: "POST",
        body: { providerId: binding.providerId, region: binding.region, paymentMethod: method, fiatAmount: amount, ...(binding.kyc ? { kycFields: fields } : {}) },
      });
      const parsed = readQuoteDraft(value);
      if (!parsed) throw new Error("quote");
      setDraft(parsed);
    } catch { setError("This quote could not be created. Check your details and try again."); }
    finally { setBusy(false); }
  }

  async function confirmOrder() {
    if (busy || !draft) return;
    setBusy(true); setConfirmationAttempted(true); setError(null);
    try {
      // Keep and retry this exact signed token if the response is lost. The
      // server correlates it to one durable reservation and never redispatches.
      const value = await fetchAccountResource("/api/funding/orders", { method: "POST", body: { quoteToken: draft.quoteToken } });
      const next = readFundingOrder(value);
      if (!next) throw new Error("order");
      setOrder(next);
    } catch { setError("Home could not confirm the order response. Retry to recover this same order; no new quote or provider request will be created."); }
    finally { setBusy(false); }
  }

  if (order?.instructions && order.expectedTokenAmountAtomic && !showInstructions) {
    return <ProviderEconomicsReview binding={binding} order={order} onContinue={() => setShowInstructions(true)} />;
  }
  if (order) return <OrderStatus order={order} onBack={onBack} />;
  if (draft) return <QuoteReview binding={binding} draft={draft} busy={busy} confirmationAttempted={confirmationAttempted} error={error} onConfirm={() => void confirmOrder()} onBack={() => setDraft(null)} />;

  const fieldsComplete = !binding.kyc?.fields?.some((field) => !fields[field.name]?.trim());
  return (
    <>
      <div className={`${modal.body} ${styles.statusStack}`}>
        {binding.paymentMethods.length > 1 ? <label>Payment method<select value={method} onChange={(event) => setMethod(event.currentTarget.value)}>{binding.paymentMethods.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label> : null}
        {binding.kyc?.terms ? <a href={binding.kyc.terms.url} target="_blank" rel="noreferrer">Review {binding.displayName} terms</a> : null}
        {binding.kyc?.fields?.map((field) => <label key={field.name}>{field.label}{field.type === "select" ? <select value={fields[field.name] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [field.name]: event.currentTarget.value }))}><option value="">Choose</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type} value={fields[field.name] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [field.name]: event.currentTarget.value }))} />}</label>)}
        <MoneyAmountDisplay amount={amount} onAmountChange={setAmount} assetId={binding.assetId} assetLabel={binding.currency} assetCurrency={binding.currency} assetLocked pricing={{ status: "unpriced" }} nativeSymbol={binding.currency} />
        <MoneyNumpad value={amount} maxDecimals={2} onChange={setAmount} disabled={busy} />
        {error ? <p className={modal.error} role="alert">{error}</p> : null}
      </div>
      <MoneyModalFooter primaryLabel={busy ? "Getting quote…" : "Review quote"} primaryDisabled={busy || !fieldsComplete || !positiveDecimal(amount)} onPrimary={() => void requestQuote()} secondaryLabel="Back" onSecondary={onBack} />
    </>
  );
}

function QuoteReview({ binding, draft, busy, confirmationAttempted, error, onConfirm, onBack }: { binding: FundingBinding; draft: QuoteDraft; busy: boolean; confirmationAttempted: boolean; error: string | null; onConfirm: () => void; onBack: () => void }) {
  return <><div className={`${modal.body} ${styles.statusStack}`}><h3>Review quote</h3><p>Deposit: {draft.quote.fiatAmount} {binding.currency}</p><p>Receive: {atomicToDecimal(draft.quote.tokenAmountAtomic, binding.assetDecimals)} {binding.assetSymbol}</p>{draft.quote.fees.length ? <section aria-label="Fees"><h4>Fees</h4>{draft.quote.fees.map((fee, index) => <p key={`${fee.label}:${index}`}>{fee.label}: {fee.amount} {fee.currency}</p>)}</section> : draft.quote.feesKnown ? <p>Fees: None</p> : <p>Fees: Not yet available</p>}<p>Expires: {new Date(draft.quote.expiresAt).toLocaleString()}</p>{error ? <p className={modal.error} role="alert">{error}</p> : null}</div><MoneyModalFooter primaryLabel={busy ? "Confirming same order…" : "Confirm deposit"} primaryDisabled={busy} onPrimary={onConfirm} secondaryLabel="Back" secondaryDisabled={confirmationAttempted} onSecondary={onBack} /></>;
}
function ProviderEconomicsReview({ binding, order, onContinue }: { binding: FundingBinding; order: FundingOrderSummary; onContinue: () => void }) {
  const fees = order.fees ?? [];
  return <><div className={`${modal.body} ${styles.statusStack}`}><h3>Review payment details</h3><p>Receive: {atomicToDecimal(order.expectedTokenAmountAtomic!, binding.assetDecimals)} {binding.assetSymbol}</p>{fees.length ? <section aria-label="Provider fees"><h4>Fees</h4>{fees.map((fee, index) => <p key={`${fee.label}:${index}`}>{fee.label}: {fee.amount} {fee.currency}</p>)}</section> : <p>Fees: None</p>}<p>These details came from {binding.displayName}. Review them before using the payment instructions.</p></div><MoneyModalFooter primaryLabel="View payment instructions" onPrimary={onContinue} /></>;
}
function OrderStatus({ order, onBack }: { order: FundingOrderSummary; onBack: () => void }) {
  const copy = stateCopy(order.state);
  return <><div className={`${modal.body} ${styles.statusStack}`}><h3>{copy.title}</h3><p>{copy.body}</p>{order.instructions ? <InstructionView instruction={order.instructions} /> : null}{order.providerStatus ? <p>Status: {order.providerStatus}</p> : null}</div>{order.state !== "dispatch-ambiguous" ? <div className={modal.footer}><button className={modal.quiet} type="button" onClick={onBack}>Back</button></div> : null}</>;
}
function InstructionView({ instruction }: { instruction: Instruction }) {
  if (instruction.kind === "redirect") return <a className={modal.primary} href={instruction.url} rel="noreferrer">Continue to payment</a>;
  if (instruction.kind === "bank-transfer") return <section><h4>{instruction.rail} transfer</h4>{instruction.bank ? <p>Bank: {instruction.bank}</p> : null}{instruction.accountName ? <p>Name: {instruction.accountName}</p> : null}<p>Account: <CopyableValue value={instruction.accountNumber} valueKind="account number" /></p>{instruction.alias ? <p>Alias: <CopyableValue value={instruction.alias} valueKind="alias" /></p> : null}{instruction.reference ? <p>Reference: <CopyableValue value={instruction.reference} valueKind="reference" /></p> : null}<p>Send exactly {instruction.amount} {instruction.currency}</p></section>;
  if (instruction.kind === "qr") return <section><h4>{instruction.scheme.toUpperCase()} payment</h4><CopyableValue value={instruction.payload} display="Copy payment code" valueKind="payment code" /><p>Pay exactly {instruction.amount} {instruction.currency}</p></section>;
  return <section><h4>{instruction.scheme}</h4><CopyableValue value={instruction.key} valueKind="payment key" /><p>Pay exactly {instruction.amount} {instruction.currency}</p></section>;
}
function stateCopy(state: string) {
  if (state === "received") return { title: "Money received", body: "The matching Base transfer was verified." };
  if (state === "dispatch-ambiguous") return { title: "Check Activity before trying again", body: "The provider may have received this request. Home retained the original order and will not send it twice." };
  if (state === "sent-unverified") return { title: "Transfer sent, still verifying", body: "Home is waiting for an exact matching Base receipt." };
  if (["failed", "cancelled", "expired", "refunded"].includes(state)) return { title: "Deposit not completed", body: "No matching funds were marked received. Review the status before starting another deposit." };
  return { title: "Deposit pending", body: "Complete the payment instructions. Home will keep checking the provider and Base receipt." };
}
function terminal(state: string) { return ["received", "dispatch-ambiguous", "failed", "cancelled", "expired", "refunded"].includes(state); }
function positiveDecimal(value: string) { return /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) && /[1-9]/.test(value); }
function atomicToDecimal(value: string, decimals: number) { const padded = value.padStart(decimals + 1, "0"); const fraction = padded.slice(-decimals).replace(/0+$/, ""); return fraction ? `${padded.slice(0, -decimals)}.${fraction}` : padded.slice(0, -decimals); }
function readQuoteDraft(value: unknown): QuoteDraft | null { if (!record(value) || typeof value.quoteToken !== "string" || !record(value.quote) || typeof value.quote.fiatAmount !== "string" || typeof value.quote.tokenAmountAtomic !== "string" || !Array.isArray(value.quote.fees) || typeof value.quote.expiresAt !== "string") return null; return { quoteToken: value.quoteToken, quote: value.quote as FundingQuote }; }
export function readFundingOrder(value: unknown): FundingOrderSummary | null { const candidate = record(value) && record(value.order) ? value.order : null; return candidate && typeof candidate.id === "string" && typeof candidate.providerId === "string" && typeof candidate.state === "string" && typeof candidate.fiatAmount === "string" ? candidate as FundingOrderSummary : null; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
