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
  currency: string;
  paymentMethods: ReadonlyArray<{ id: string; label: string }>;
  quotes: boolean;
  kyc: { terms?: { url: string }; fields?: ReadonlyArray<{ name: string; label: string; type: "text" | "email" | "date" | "select"; options?: string[] }> } | null;
};

export type FundingOrderSummary = {
  id: string; state: string; fiatAmount: string; providerStatus: string | null;
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
  const [order, setOrder] = useState<FundingOrderSummary | null>(initialOrder ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order || terminal(order.state)) return;
    const timer = window.setInterval(() => {
      void fetchAccountResource(`/api/funding/orders/${order.id}`).then((value) => {
        const next = readOrder(value); if (next) setOrder(next);
      }).catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [fetchAccountResource, order]);

  async function create() {
    if (busy || !method || !positiveDecimal(amount)) return;
    setBusy(true); setError(null);
    try {
      const quoteValue = await fetchAccountResource("/api/funding/quotes", { method: "POST", body: { providerId: binding.providerId, region: binding.region, paymentMethod: method, fiatAmount: amount, ...(binding.kyc ? { kycFields: fields } : {}) } });
      const quoteToken = readQuoteToken(quoteValue);
      if (!quoteToken) throw new Error("quote");
      const created = await fetchAccountResource("/api/funding/orders", { method: "POST", body: { quoteToken } });
      const next = readOrder(created);
      if (!next) throw new Error("order");
      setOrder(next);
    } catch { setError("This deposit could not be started. Check your details and try again."); }
    finally { setBusy(false); }
  }

  if (order) return <OrderStatus order={order} onBack={onBack} />;
  const fieldsComplete = !binding.kyc?.fields?.some((field) => !fields[field.name]?.trim());
  return (
    <>
      <div className={`${modal.body} ${styles.statusStack}`}>
        {binding.paymentMethods.length > 1 ? <label>Payment method<select value={method} onChange={(event) => setMethod(event.currentTarget.value)}>{binding.paymentMethods.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label> : null}
        {binding.kyc?.terms ? <a href={binding.kyc.terms.url} target="_blank" rel="noreferrer">Review {binding.displayName} terms</a> : null}
        {binding.kyc?.fields?.map((field) => <label key={field.name}>{field.label}{field.type === "select" ? <select value={fields[field.name] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [field.name]: event.currentTarget.value }))}><option value="">Choose</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type} value={fields[field.name] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [field.name]: event.currentTarget.value }))} />}</label>)}
        <MoneyAmountDisplay amount={amount} onAmountChange={setAmount} assetId={binding.assetId} assetLabel={binding.currency} assetCurrency={binding.currency} assetLocked pricing={{ status: "unpriced" }} nativeSymbol={binding.currency} />
        <MoneyNumpad value={amount} maxDecimals={2} onChange={setAmount} disabled={busy} />
        <p>You&apos;ll receive {binding.assetSymbol} on Base. The final amount and fees are locked by the quote.</p>
        {error ? <p className={modal.error} role="alert">{error}</p> : null}
      </div>
      <MoneyModalFooter primaryLabel={busy ? "Starting…" : "Continue"} primaryDisabled={busy || !fieldsComplete || !positiveDecimal(amount)} onPrimary={() => void create()} secondaryLabel="Back" onSecondary={onBack} />
    </>
  );
}

function OrderStatus({ order, onBack }: { order: FundingOrderSummary; onBack: () => void }) {
  const copy = stateCopy(order.state);
  return <><div className={`${modal.body} ${styles.statusStack}`}><h3>{copy.title}</h3><p>{copy.body}</p>{order.instructions ? <InstructionView instruction={order.instructions} /> : null}{order.providerStatus ? <p>Status: {order.providerStatus}</p> : null}</div><div className={modal.footer}><button className={modal.quiet} type="button" onClick={onBack}>Back</button></div></>;
}
function InstructionView({ instruction }: { instruction: Instruction }) {
  if (instruction.kind === "redirect") return <a className={modal.primary} href={instruction.url} rel="noreferrer">Continue to payment</a>;
  if (instruction.kind === "bank-transfer") return <section><h4>{instruction.rail} transfer</h4>{instruction.bank ? <p>Bank: {instruction.bank}</p> : null}{instruction.accountName ? <p>Name: {instruction.accountName}</p> : null}<p>Account: <CopyableValue value={instruction.accountNumber} valueKind="account number" /></p>{instruction.alias ? <p>Alias: <CopyableValue value={instruction.alias} valueKind="alias" /></p> : null}{instruction.reference ? <p>Reference: <CopyableValue value={instruction.reference} valueKind="reference" /></p> : null}<p>Send exactly {instruction.amount} {instruction.currency}</p></section>;
  if (instruction.kind === "qr") return <section><h4>{instruction.scheme.toUpperCase()} payment</h4><CopyableValue value={instruction.payload} display="Copy payment code" valueKind="payment code" /><p>Pay exactly {instruction.amount} {instruction.currency}</p></section>;
  return <section><h4>{instruction.scheme}</h4><CopyableValue value={instruction.key} valueKind="payment key" /><p>Pay exactly {instruction.amount} {instruction.currency}</p></section>;
}
function stateCopy(state: string) {
  if (state === "received") return { title: "Money received", body: "The matching Base transfer was verified." };
  if (state === "dispatch-ambiguous") return { title: "Check Activity before trying again", body: "The provider may have received this request. Home will not send it twice." };
  if (state === "sent-unverified") return { title: "Transfer sent, still verifying", body: "Home is waiting for an exact matching Base receipt." };
  if (["failed", "cancelled", "expired", "refunded"].includes(state)) return { title: "Deposit not completed", body: "No matching funds were marked received. Review the status before starting another deposit." };
  return { title: "Deposit pending", body: "Complete the payment instructions. Home will keep checking the provider and Base receipt." };
}
function terminal(state: string) { return ["received", "dispatch-ambiguous", "failed", "cancelled", "expired", "refunded"].includes(state); }
function positiveDecimal(value: string) { return /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) && /[1-9]/.test(value); }
function readQuoteToken(value: unknown): string | null { return record(value) && typeof value.quoteToken === "string" ? value.quoteToken : null; }
export function readFundingOrder(value: unknown): FundingOrderSummary | null { const candidate = record(value) && record(value.order) ? value.order : null; return candidate && typeof candidate.id === "string" && typeof candidate.state === "string" && typeof candidate.fiatAmount === "string" ? candidate as FundingOrderSummary : null; }
const readOrder = readFundingOrder;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
