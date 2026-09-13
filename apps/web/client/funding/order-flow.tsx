"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Heading, Input, Select, Stack, StatusMessage, Text } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import { CopyableValue } from "@/components/copyable-value";
import {
  formatFiatAmount,
  formatPresentationDate,
  formatPresentationTokenAmount,
  presentationCurrencyMetadata,
} from "@/shared/formatting";
import { MoneyAmountDisplay, MoneyModalFooter, MoneyNumpad } from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import styles from "./add-money.module.css";
import { ownerQueryKey, ownerQueryMeta, publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import type { FundingBinding } from "@/shared/funding/contracts/providers";
import { readQuoteDraft, type QuoteDraft } from "@/shared/funding/contracts/quotes";
import { readFundingOrder, type FundingOrderSummary, type Instruction } from "@/shared/funding/contracts/order";

type AccountFetch = (path: string, options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }) => Promise<unknown>;

export type { FundingBinding } from "@/shared/funding/contracts/providers";
export type { FundingOrderSummary } from "@/shared/funding/contracts/order";
export { readFundingOrder } from "@/shared/funding/contracts/order";

export function FundingOrderFlow({ binding, fetchAccountResource, queryOwnerKey, onBack, onOpenRedirect, initialOrder }: { binding: FundingBinding; fetchAccountResource: AccountFetch; queryOwnerKey?: string | null; onBack: () => void; onOpenRedirect: (url: string) => void; initialOrder?: FundingOrderSummary | null }) {
  const [method, setMethod] = useState(binding.paymentMethods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [order, setOrder] = useState<FundingOrderSummary | null>(initialOrder ?? null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmationAttempted, setConfirmationAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only redirect orders created in this dialog session auto-open; a resumed open
  // order keeps its explicit "Continue to payment" link.
  const openedRedirectOrderRef = useRef<string | null>(initialOrder?.id ?? null);

  const orderQuery = useHomeQuery({
    queryKey: order
      ? (queryOwnerKey
          ? ownerQueryKey(queryOwnerKey, "funding-order", order.id)
          : publicQueryKey("funding-order-isolated", order.id))
      : publicQueryKey("funding-order-disabled"),
    enabled: Boolean(order && !terminal(order.state)),
    // The created order is authoritative for the first poll interval; the
    // provider is polled from then on (matches the previous setInterval cadence).
    initialData: order ?? undefined,
    initialDataUpdatedAt: () => Date.now(),
    staleTime: 4_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const current = query.state.data as FundingOrderSummary | undefined;
      return current && !terminal(current.state) ? 4_000 : false;
    },
    meta: queryOwnerKey ? ownerQueryMeta(queryOwnerKey, "owner") : undefined,
    queryFn: async ({ signal }) => {
      if (!order) throw new Error("Funding order is unavailable.");
      const next = readFundingOrder(await fetchAccountResource(`/api/funding/orders/${order.id}`, { signal }));
      if (!next) throw new Error("Funding order response is invalid.");
      return next;
    },
  });
  const currentOrder = orderQuery.data ?? order;

  useEffect(() => {
    if (
      !currentOrder ||
      currentOrder.instructions?.kind !== "redirect" ||
      openedRedirectOrderRef.current === currentOrder.id
    ) return;
    openedRedirectOrderRef.current = currentOrder.id;
    onOpenRedirect(currentOrder.instructions.url);
  }, [currentOrder, onOpenRedirect]);

  async function requestQuote() {
    if (busy || draft || !method || !positiveDecimal(amount)) return;
    setBusy(true);
    setError(null);
    try {
      const value = await fetchAccountResource("/api/funding/quotes", {
        method: "POST",
        body: {
          providerId: binding.providerId,
          region: binding.region,
          paymentMethod: method,
          fiatAmount: amount,
          ...(binding.kyc ? { kycFields: fields } : {}),
        },
      });
      const parsed = readQuoteDraft(value);
      if (!parsed) throw new Error("quote");
      setDraft(parsed);
    } catch {
      setError("This quote could not be created. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmOrder() {
    if (busy || !draft) return;
    setBusy(true);
    setConfirmationAttempted(true);
    setError(null);
    try {
      // Keep and retry this exact signed token if the response is lost. The
      // server correlates it to one durable reservation and never redispatches.
      const value = await fetchAccountResource("/api/funding/orders", {
        method: "POST",
        body: { quoteToken: draft.quoteToken },
      });
      const next = readFundingOrder(value);
      if (!next) throw new Error("order");
      setOrder(next);
    } catch {
      setError("Home could not confirm the order response. Retry to recover this same order; no new quote or provider request will be created.");
    } finally {
      setBusy(false);
    }
  }

  if (currentOrder?.instructions?.kind === "redirect") {
    return <OrderStatus order={currentOrder} onBack={onBack} />;
  }
  if (currentOrder?.instructions && currentOrder.expectedTokenAmountAtomic && !showInstructions) {
    return <ProviderEconomicsReview binding={binding} order={currentOrder} onContinue={() => setShowInstructions(true)} />;
  }
  if (currentOrder) return <OrderStatus order={currentOrder} onBack={onBack} />;
  if (draft) {
    return (
      <QuoteReview
        binding={binding}
        draft={draft}
        busy={busy}
        confirmationAttempted={confirmationAttempted}
        error={error}
        onConfirm={() => void confirmOrder()}
        onBack={() => setDraft(null)}
      />
    );
  }

  const fieldsComplete = !binding.kyc?.fields?.some((field) => !fields[field.name]?.trim());
  return (
    <>
      <Stack className={`${modal.body} ${styles.statusStack}`} space="2">
        {binding.paymentMethods.length > 1 ? (
          <Field label="Payment method" htmlFor="funding-payment-method" required>
            <Select id="funding-payment-method" value={method} onChange={(event) => setMethod(event.currentTarget.value)}>
              {binding.paymentMethods.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
            </Select>
          </Field>
        ) : null}
        {binding.kyc?.fields?.map((field) => {
          const id = `funding-kyc-${field.name}`;
          const value = fields[field.name] ?? "";
          const onChange = (nextValue: string) => setFields((current) => ({ ...current, [field.name]: nextValue }));
          return (
            <Field key={field.name} label={field.label} htmlFor={id} required>
              {field.type === "select" ? (
                <Select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
                  <option value="">Choose</option>
                  {field.options?.map((option) => <option key={option}>{option}</option>)}
                </Select>
              ) : (
                <Input id={id} type={field.type} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
              )}
            </Field>
          );
        })}
        <MoneyAmountDisplay amount={amount} onAmountChange={setAmount} assetId={binding.assetId} assetLabel={binding.currency} assetCurrency={binding.currency} assetLocked pricing={{ status: "unpriced" }} nativeSymbol={binding.currency} />
        <MoneyNumpad value={amount} maxDecimals={2} onChange={setAmount} disabled={busy} />
        {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
      </Stack>
      <MoneyModalFooter primaryLabel={busy ? "Getting quote…" : "Review quote"} primaryDisabled={busy || !fieldsComplete || !positiveDecimal(amount)} onPrimary={() => void requestQuote()} secondaryLabel="Back" onSecondary={onBack} />
    </>
  );
}

function QuoteReview({ binding, draft, busy, confirmationAttempted, error, onConfirm, onBack }: { binding: FundingBinding; draft: QuoteDraft; busy: boolean; confirmationAttempted: boolean; error: string | null; onConfirm: () => void; onBack: () => void }) {
  const regionId = presentationCurrencyMetadata(binding.currency).defaultRegionId;
  const deposit = formatFiatAmount(draft.quote.fiatAmount, binding.currency, { regionId });
  const receive = formatPresentationTokenAmount(draft.quote.tokenAmountAtomic, binding.assetDecimals, binding.assetSymbol, { regionId, useNoBreakSpace: true });
  return (
    <>
      <Stack className={`${modal.body} ${styles.statusStack}`} space="2">
        <Heading level={3} textStyle="section-title">Review quote</Heading>
        <MoneyLine value={`Deposit: ${deposit}`} />
        <MoneyLine value={`Receive: ${receive}`} />
        {draft.quote.fees.length ? (
          <section aria-label="Fees">
            <Stack space="2">
              <Heading level={4} textStyle="row-label">Fees</Heading>
              {draft.quote.fees.map((fee, index) => (
                <MoneyLine key={`${fee.label}:${index}`} value={`${fee.label}: ${formatFiatAmount(fee.amount, fee.currency)}`} />
              ))}
            </Stack>
          </section>
        ) : draft.quote.feesKnown ? (
          <Text>Fees: None</Text>
        ) : (
          <Text>Fees: Not yet available</Text>
        )}
        <Text textStyle="secondary" tone="muted">
          Expires: {formatPresentationDate(draft.quote.expiresAt, { regionId, style: "date-time-zone" })}
        </Text>
        {error ? <StatusMessage tone="error" role="alert">{error}</StatusMessage> : null}
      </Stack>
      <MoneyModalFooter primaryLabel={busy ? "Confirming same order…" : "Confirm deposit"} primaryDisabled={busy} onPrimary={onConfirm} secondaryLabel="Back" secondaryDisabled={confirmationAttempted} onSecondary={onBack} />
    </>
  );
}

function ProviderEconomicsReview({ binding, order, onContinue }: { binding: FundingBinding; order: FundingOrderSummary; onContinue: () => void }) {
  const fees = order.fees ?? [];
  const regionId = presentationCurrencyMetadata(binding.currency).defaultRegionId;
  const receive = formatPresentationTokenAmount(order.expectedTokenAmountAtomic!, binding.assetDecimals, binding.assetSymbol, { regionId, useNoBreakSpace: true });
  return (
    <>
      <Stack className={`${modal.body} ${styles.statusStack}`} space="2">
        <Heading level={3} textStyle="section-title">Review payment details</Heading>
        <MoneyLine value={`Receive: ${receive}`} />
        {fees.length ? (
          <section aria-label="Provider fees">
            <Stack space="2">
              <Heading level={4} textStyle="row-label">Fees</Heading>
              {fees.map((fee, index) => (
                <MoneyLine key={`${fee.label}:${index}`} value={`${fee.label}: ${formatFiatAmount(fee.amount, fee.currency)}`} />
              ))}
            </Stack>
          </section>
        ) : (
          <Text>Fees: None</Text>
        )}
      </Stack>
      <MoneyModalFooter primaryLabel="View payment instructions" onPrimary={onContinue} />
    </>
  );
}

function OrderStatus({ order, onBack }: { order: FundingOrderSummary; onBack: () => void }) {
  const copy = stateCopy(order.state);
  return (
    <>
      <Stack className={`${modal.body} ${styles.statusStack}`} space="2">
        <Heading level={3} textStyle="section-title">{copy.title}</Heading>
        <StatusMessage>{copy.body}</StatusMessage>
        {order.instructions ? <InstructionView instruction={order.instructions} /> : null}
        {order.providerStatus ? <Text textStyle="secondary" tone="muted">Status: {order.providerStatus}</Text> : null}
      </Stack>
      {order.state !== "dispatch-ambiguous" ? (
        <div className={modal.footer}>
          <Button className={modal.quiet} variant="quiet" onClick={onBack}>Back</Button>
        </div>
      ) : null}
    </>
  );
}

function InstructionView({ instruction }: { instruction: Instruction }) {
  if (instruction.kind === "redirect") {
    return <a className={modal.primary} href={instruction.url} rel="noreferrer">Continue to payment</a>;
  }
  if (instruction.kind === "bank-transfer") {
    return (
      <section>
        <Stack space="2">
          <Heading level={4} textStyle="row-label">{instruction.rail} transfer</Heading>
          {instruction.bank ? <Text>Bank: {instruction.bank}</Text> : null}
          {instruction.accountName ? <Text>Name: {instruction.accountName}</Text> : null}
          <Text as="div">Account: <CopyableValue value={instruction.accountNumber} valueKind="account number" /></Text>
          {instruction.alias ? <Text as="div">Alias: <CopyableValue value={instruction.alias} valueKind="alias" /></Text> : null}
          {instruction.reference ? <Text as="div">Reference: <CopyableValue value={instruction.reference} valueKind="reference" /></Text> : null}
          <MoneyLine value={`Send exactly ${formatFiatAmount(instruction.amount, instruction.currency)}`} />
        </Stack>
      </section>
    );
  }
  if (instruction.kind === "qr") {
    return (
      <section>
        <Stack space="2">
          <Heading level={4} textStyle="row-label">{instruction.scheme.toUpperCase()} payment</Heading>
          <CopyableValue value={instruction.payload} display="Copy payment code" valueKind="payment code" />
          <MoneyLine value={`Pay exactly ${formatFiatAmount(instruction.amount, instruction.currency)}`} />
        </Stack>
      </section>
    );
  }
  return (
    <section>
      <Stack space="2">
        <Heading level={4} textStyle="row-label">{instruction.scheme}</Heading>
        <CopyableValue value={instruction.key} valueKind="payment key" />
        <MoneyLine value={`Pay exactly ${formatFiatAmount(instruction.amount, instruction.currency)}`} />
      </Stack>
    </section>
  );
}

function MoneyLine({ value }: { value: string }) {
  return (
    <Text textStyle="body">
      <MoneyTicker value={value} />
    </Text>
  );
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
