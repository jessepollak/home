"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { MoneyTicker } from "@/components/money-ticker";
import { CopyableValue } from "@/components/copyable-value";
import {
  formatFiatAmount,
  formatPresentationDate,
  formatPresentationTokenAmount,
  presentationCurrencyMetadata,
} from "@/shared/formatting";
import {
  MoneyAmountDisplay,
  MoneyModalFooter,
  MoneyNumpad,
} from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import styles from "./add-money.module.css";
import {
  ownerQueryKey,
  ownerQueryMeta,
  publicQueryKey,
  useHomeQuery,
} from "@/client/query/query-client";

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
  kyc: {
    terms?: { url: string };
    fields?: ReadonlyArray<{
      name: string;
      label: string;
      type: "text" | "email" | "date" | "select";
      options?: ReadonlyArray<string>;
    }>;
  } | null;
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
  | {
      kind: "bank-transfer";
      rail: string;
      accountNumber: string;
      accountName?: string;
      bank?: string;
      alias?: string;
      reference?: string;
      amount: string;
      currency: string;
    }
  | {
      kind: "qr";
      scheme: string;
      payload: string;
      amount: string;
      currency: string;
    }
  | {
      kind: "payment-key";
      scheme: string;
      key: string;
      amount: string;
      currency: string;
    };

type AccountFetch = (
  path: string,
  options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
) => Promise<unknown>;

export function FundingOrderFlow({
  binding,
  fetchAccountResource,
  queryOwnerKey,
  onBack,
  onOpenRedirect,
  initialOrder,
}: {
  binding: FundingBinding;
  fetchAccountResource: AccountFetch;
  queryOwnerKey?: string | null;
  onBack: () => void;
  onOpenRedirect: (url: string) => void;
  initialOrder?: FundingOrderSummary | null;
}) {
  const [method, setMethod] = useState(binding.paymentMethods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [order, setOrder] = useState<FundingOrderSummary | null>(
    initialOrder ?? null,
  );
  const [showInstructions, setShowInstructions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmationAttempted, setConfirmationAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only redirect orders created in this dialog session auto-open; a resumed open
  // order keeps its explicit "Continue to payment" link.
  const openedRedirectOrderRef = useRef<string | null>(
    initialOrder?.id ?? null,
  );

  const orderQuery = useHomeQuery({
    queryKey: order
      ? queryOwnerKey
        ? ownerQueryKey(queryOwnerKey, "funding-order", order.id)
        : publicQueryKey("funding-order-isolated", order.id)
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
      const next = readFundingOrder(
        await fetchAccountResource(`/api/funding/orders/${order.id}`, {
          signal,
        }),
      );
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
    )
      return;
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
      setError(
        "This quote could not be created. Check your details and try again.",
      );
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
      setError(
        "Home could not confirm the order response. Retry to recover this same order; no new quote or provider request will be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (currentOrder?.instructions?.kind === "redirect") {
    return <OrderStatus order={currentOrder} onBack={onBack} />;
  }
  if (
    currentOrder?.instructions &&
    currentOrder.expectedTokenAmountAtomic &&
    !showInstructions
  ) {
    return (
      <ProviderEconomicsReview
        binding={binding}
        order={currentOrder}
        onContinue={() => setShowInstructions(true)}
      />
    );
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

  const fieldsComplete = !binding.kyc?.fields?.some(
    (field) => !fields[field.name]?.trim(),
  );
  return (
    <>
      <div
        className={`${modal.body} ${styles.statusStack} flex flex-col gap-2`}
      >
        {binding.paymentMethods.length > 1 ? (
          <Field>
            <FieldLabel htmlFor="funding-payment-method">
              Payment method
            </FieldLabel>
            <NativeSelect
              className="w-full"
              id="funding-payment-method"
              value={method}
              required
              onChange={(event) => setMethod(event.currentTarget.value)}
            >
              {binding.paymentMethods.map((item) => (
                <NativeSelectOption value={item.id} key={item.id}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        {binding.kyc?.fields?.map((field) => {
          const id = `funding-kyc-${field.name}`;
          const value = fields[field.name] ?? "";
          const onChange = (nextValue: string) =>
            setFields((current) => ({ ...current, [field.name]: nextValue }));
          return (
            <Field key={field.name}>
              <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
              {field.type === "select" ? (
                <NativeSelect
                  className="w-full"
                  id={id}
                  value={value}
                  required
                  onChange={(event) => onChange(event.currentTarget.value)}
                >
                  <NativeSelectOption value="">Choose</NativeSelectOption>
                  {field.options?.map((option) => (
                    <NativeSelectOption key={option}>
                      {option}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  className="min-h-11"
                  id={id}
                  type={field.type}
                  value={value}
                  required
                  onChange={(event) => onChange(event.currentTarget.value)}
                />
              )}
            </Field>
          );
        })}
        <MoneyAmountDisplay
          amount={amount}
          onAmountChange={setAmount}
          assetId={binding.assetId}
          assetLabel={binding.currency}
          assetCurrency={binding.currency}
          assetLocked
          pricing={{ status: "unpriced" }}
          nativeSymbol={binding.currency}
        />
        <MoneyNumpad
          value={amount}
          maxDecimals={2}
          onChange={setAmount}
          disabled={busy}
        />
        {error ? (
          <FundingNotice tone="error" role="alert">
            {error}
          </FundingNotice>
        ) : null}
      </div>
      <MoneyModalFooter
        primaryLabel={busy ? "Getting quote…" : "Review quote"}
        primaryDisabled={busy || !fieldsComplete || !positiveDecimal(amount)}
        onPrimary={() => void requestQuote()}
        secondaryLabel="Back"
        onSecondary={onBack}
      />
    </>
  );
}

function QuoteReview({
  binding,
  draft,
  busy,
  confirmationAttempted,
  error,
  onConfirm,
  onBack,
}: {
  binding: FundingBinding;
  draft: QuoteDraft;
  busy: boolean;
  confirmationAttempted: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const regionId = presentationCurrencyMetadata(
    binding.currency,
  ).defaultRegionId;
  const deposit = formatFiatAmount(draft.quote.fiatAmount, binding.currency, {
    regionId,
  });
  const receive = formatPresentationTokenAmount(
    draft.quote.tokenAmountAtomic,
    binding.assetDecimals,
    binding.assetSymbol,
    { regionId, useNoBreakSpace: true },
  );
  return (
    <>
      <div
        className={`${modal.body} ${styles.statusStack} flex flex-col gap-2`}
      >
        <h3 className="text-section-title font-semibold">Review quote</h3>
        <MoneyLine value={`Deposit: ${deposit}`} />
        <MoneyLine value={`Receive: ${receive}`} />
        {draft.quote.fees.length ? (
          <section aria-label="Fees">
            <div className="flex flex-col gap-2">
              <h4 className="text-row-label font-semibold">Fees</h4>
              {draft.quote.fees.map((fee, index) => (
                <MoneyLine
                  key={`${fee.label}:${index}`}
                  value={`${fee.label}: ${formatFiatAmount(fee.amount, fee.currency)}`}
                />
              ))}
            </div>
          </section>
        ) : draft.quote.feesKnown ? (
          <p className="text-body">Fees: None</p>
        ) : (
          <p className="text-body">Fees: Not yet available</p>
        )}
        <p className="text-caption text-muted-foreground">
          Expires:{" "}
          {formatPresentationDate(draft.quote.expiresAt, {
            regionId,
            style: "date-time-zone",
          })}
        </p>
        {error ? (
          <FundingNotice tone="error" role="alert">
            {error}
          </FundingNotice>
        ) : null}
      </div>
      <MoneyModalFooter
        primaryLabel={busy ? "Confirming same order…" : "Confirm deposit"}
        primaryDisabled={busy}
        onPrimary={onConfirm}
        secondaryLabel="Back"
        secondaryDisabled={confirmationAttempted}
        onSecondary={onBack}
      />
    </>
  );
}

function ProviderEconomicsReview({
  binding,
  order,
  onContinue,
}: {
  binding: FundingBinding;
  order: FundingOrderSummary;
  onContinue: () => void;
}) {
  const fees = order.fees ?? [];
  const regionId = presentationCurrencyMetadata(
    binding.currency,
  ).defaultRegionId;
  const receive = formatPresentationTokenAmount(
    order.expectedTokenAmountAtomic!,
    binding.assetDecimals,
    binding.assetSymbol,
    { regionId, useNoBreakSpace: true },
  );
  return (
    <>
      <div
        className={`${modal.body} ${styles.statusStack} flex flex-col gap-2`}
      >
        <h3 className="text-section-title font-semibold">
          Review payment details
        </h3>
        <MoneyLine value={`Receive: ${receive}`} />
        {fees.length ? (
          <section aria-label="Provider fees">
            <div className="flex flex-col gap-2">
              <h4 className="text-row-label font-semibold">Fees</h4>
              {fees.map((fee, index) => (
                <MoneyLine
                  key={`${fee.label}:${index}`}
                  value={`${fee.label}: ${formatFiatAmount(fee.amount, fee.currency)}`}
                />
              ))}
            </div>
          </section>
        ) : (
          <p className="text-body">Fees: None</p>
        )}
      </div>
      <MoneyModalFooter
        primaryLabel="View payment instructions"
        onPrimary={onContinue}
      />
    </>
  );
}

function OrderStatus({
  order,
  onBack,
}: {
  order: FundingOrderSummary;
  onBack: () => void;
}) {
  const copy = stateCopy(order.state);
  return (
    <>
      <div
        className={`${modal.body} ${styles.statusStack} flex flex-col gap-2`}
      >
        <h3 className="text-section-title font-semibold">{copy.title}</h3>
        <FundingNotice>{copy.body}</FundingNotice>
        {order.instructions ? (
          <InstructionView instruction={order.instructions} />
        ) : null}
        {order.providerStatus ? (
          <p className="text-caption text-muted-foreground">
            Status: {order.providerStatus}
          </p>
        ) : null}
      </div>
      {order.state !== "dispatch-ambiguous" ? (
        <div className={modal.footer}>
          <Button className={modal.quiet} variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      ) : null}
    </>
  );
}

function InstructionView({ instruction }: { instruction: Instruction }) {
  if (instruction.kind === "redirect") {
    return (
      <a className={modal.primary} href={instruction.url} rel="noreferrer">
        Continue to payment
      </a>
    );
  }
  if (instruction.kind === "bank-transfer") {
    return (
      <section>
        <div className="flex flex-col gap-2">
          <h4 className="text-row-label font-semibold">
            {instruction.rail} transfer
          </h4>
          {instruction.bank ? (
            <p className="text-body">Bank: {instruction.bank}</p>
          ) : null}
          {instruction.accountName ? (
            <p className="text-body">Name: {instruction.accountName}</p>
          ) : null}
          <div className="text-body">
            Account:{" "}
            <CopyableValue
              value={instruction.accountNumber}
              valueKind="account number"
            />
          </div>
          {instruction.alias ? (
            <div className="text-body">
              Alias:{" "}
              <CopyableValue value={instruction.alias} valueKind="alias" />
            </div>
          ) : null}
          {instruction.reference ? (
            <div className="text-body">
              Reference:{" "}
              <CopyableValue
                value={instruction.reference}
                valueKind="reference"
              />
            </div>
          ) : null}
          <MoneyLine
            value={`Send exactly ${formatFiatAmount(instruction.amount, instruction.currency)}`}
          />
        </div>
      </section>
    );
  }
  if (instruction.kind === "qr") {
    return (
      <section>
        <div className="flex flex-col gap-2">
          <h4 className="text-row-label font-semibold">
            {instruction.scheme.toUpperCase()} payment
          </h4>
          <CopyableValue
            value={instruction.payload}
            display="Copy payment code"
            valueKind="payment code"
          />
          <MoneyLine
            value={`Pay exactly ${formatFiatAmount(instruction.amount, instruction.currency)}`}
          />
        </div>
      </section>
    );
  }
  return (
    <section>
      <div className="flex flex-col gap-2">
        <h4 className="text-row-label font-semibold">{instruction.scheme}</h4>
        <CopyableValue value={instruction.key} valueKind="payment key" />
        <MoneyLine
          value={`Pay exactly ${formatFiatAmount(instruction.amount, instruction.currency)}`}
        />
      </div>
    </section>
  );
}

function MoneyLine({ value }: { value: string }) {
  return (
    <p className="text-body">
      <MoneyTicker value={value} />
    </p>
  );
}

function FundingNotice({
  children,
  role = "status",
  tone = "neutral",
}: {
  children: React.ReactNode;
  role?: "status" | "alert";
  tone?: "neutral" | "error";
}) {
  return (
    <Alert role={role} variant={tone === "error" ? "destructive" : "default"}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function stateCopy(state: string) {
  if (state === "received")
    return {
      title: "Money received",
      body: "The matching Base transfer was verified.",
    };
  if (state === "dispatch-ambiguous")
    return {
      title: "Check Activity before trying again",
      body: "The provider may have received this request. Home retained the original order and will not send it twice.",
    };
  if (state === "sent-unverified")
    return {
      title: "Transfer sent, still verifying",
      body: "Home is waiting for an exact matching Base receipt.",
    };
  if (["failed", "cancelled", "expired", "refunded"].includes(state))
    return {
      title: "Deposit not completed",
      body: "No matching funds were marked received. Review the status before starting another deposit.",
    };
  return {
    title: "Deposit pending",
    body: "Complete the payment instructions. Home will keep checking the provider and Base receipt.",
  };
}
function terminal(state: string) {
  return [
    "received",
    "dispatch-ambiguous",
    "failed",
    "cancelled",
    "expired",
    "refunded",
  ].includes(state);
}
function positiveDecimal(value: string) {
  return /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) && /[1-9]/.test(value);
}
function readQuoteDraft(value: unknown): QuoteDraft | null {
  if (
    !record(value) ||
    typeof value.quoteToken !== "string" ||
    !record(value.quote) ||
    typeof value.quote.fiatAmount !== "string" ||
    typeof value.quote.tokenAmountAtomic !== "string" ||
    !Array.isArray(value.quote.fees) ||
    typeof value.quote.expiresAt !== "string"
  )
    return null;
  return { quoteToken: value.quoteToken, quote: value.quote as FundingQuote };
}
export function readFundingOrder(value: unknown): FundingOrderSummary | null {
  const candidate = record(value) && record(value.order) ? value.order : null;
  return candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.state === "string" &&
    typeof candidate.fiatAmount === "string"
    ? (candidate as FundingOrderSummary)
    : null;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
