"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { DrawerFooter } from "@/components/ui/drawer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  MoneyModalBody,
  MoneyModalFooter,
  MoneyNumpad,
  type MoneyAmountChangeSource,
} from "@/client/money-modal";
import {
  ownerQueryKey,
  ownerQueryMeta,
  publicQueryKey,
  useHomeQuery,
} from "@/client/query/query-client";
import type { FundingBinding } from "@/shared/funding/contracts/providers";
import {
  readQuoteDraft,
  type QuoteDraft,
} from "@/shared/funding/contracts/quotes";
import {
  readFundingOrder,
  type FundingOrderSummary,
  type Instruction,
} from "@/shared/funding/contracts/order";

type AccountFetch = (
  path: string,
  options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
) => Promise<unknown>;

export type { FundingBinding } from "@/shared/funding/contracts/providers";
export type { FundingOrderSummary } from "@/shared/funding/contracts/order";
export { readFundingOrder } from "@/shared/funding/contracts/order";

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
  const [amountChangeSource, setAmountChangeSource] =
    useState<MoneyAmountChangeSource>("programmatic");
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

  function changeAmount(value: string, source: MoneyAmountChangeSource) {
    setAmountChangeSource(source);
    setAmount(value);
  }

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
      <MoneyModalBody className="gap-4 pt-4">
        {binding.paymentMethods.length > 1 ? (
          <Field>
            <FieldLabel htmlFor="funding-payment-method">
              Payment method
            </FieldLabel>
            <Select
              value={method}
              required
              onValueChange={(value) => setMethod(value ?? "")}
            >
              <SelectTrigger
                className="h-11 w-full"
                id="funding-payment-method"
              >
                <SelectValue>
                  {(selectedMethod) =>
                    binding.paymentMethods.find(
                      (item) => item.id === selectedMethod,
                    )?.label ?? selectedMethod
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {binding.paymentMethods.map((item) => (
                  <SelectItem value={item.id} key={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                <Select
                  value={value || null}
                  required
                  onValueChange={(nextValue) => onChange(nextValue ?? "")}
                >
                  <SelectTrigger className="h-11 w-full" id={id}>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-11"
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
          amountChangeSource={amountChangeSource}
          onAmountChange={changeAmount}
          assetId={binding.assetId}
          pricing={{ status: "unpriced" }}
          nativeSymbol={binding.currency}
          fiatCurrency={binding.currency}
        />
        <MoneyNumpad
          value={amount}
          maxDecimals={2}
          onChange={changeAmount}
          disabled={busy}
        />
        {error ? (
          <FundingNotice tone="error" role="alert">
            {error}
          </FundingNotice>
        ) : null}
      </MoneyModalBody>
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
      <MoneyModalBody className="gap-4 pt-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Review quote</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <DefinitionRow label="Deposit" value={deposit} />
              <DefinitionRow label="Receive" value={receive} />
              {draft.quote.fees.length ? (
                draft.quote.fees.map((fee, index) => (
                  <DefinitionRow
                    key={`${fee.label}:${index}`}
                    label={fee.label}
                    value={formatFiatAmount(fee.amount, fee.currency)}
                  />
                ))
              ) : (
                <DefinitionRow
                  label="Fees"
                  value={draft.quote.feesKnown ? "None" : "Not yet available"}
                />
              )}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Expires:{" "}
              {formatPresentationDate(draft.quote.expiresAt, {
                regionId,
                style: "date-time-zone",
              })}
            </p>
          </CardContent>
        </Card>
        {error ? (
          <FundingNotice tone="error" role="alert">
            {error}
          </FundingNotice>
        ) : null}
      </MoneyModalBody>
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
      <MoneyModalBody className="gap-4 pt-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Review payment details</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <DefinitionRow label="Receive" value={receive} />
              {fees.length ? (
                fees.map((fee, index) => (
                  <DefinitionRow
                    key={`${fee.label}:${index}`}
                    label={fee.label}
                    value={formatFiatAmount(fee.amount, fee.currency)}
                  />
                ))
              ) : (
                <DefinitionRow label="Fees" value="None" />
              )}
            </dl>
          </CardContent>
        </Card>
      </MoneyModalBody>
      <MoneyModalFooter
        primaryLabel="View payment instructions"
        onPrimary={onContinue}
      />
    </>
  );
}

function DefinitionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">
        <MoneyTicker value={value} />
      </dd>
    </div>
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
      <MoneyModalBody className="gap-4 pt-4">
        <h3 className="text-lg font-semibold">{copy.title}</h3>
        <FundingNotice>{copy.body}</FundingNotice>
        {order.instructions ? (
          <InstructionView instruction={order.instructions} />
        ) : null}
        {order.providerStatus ? (
          <p className="text-sm text-muted-foreground">
            Status: {order.providerStatus}
          </p>
        ) : null}
      </MoneyModalBody>
      {order.state !== "dispatch-ambiguous" ? (
        <DrawerFooter className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button className="h-11" size="lg" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </DrawerFooter>
      ) : null}
    </>
  );
}

function InstructionView({ instruction }: { instruction: Instruction }) {
  if (instruction.kind === "redirect") {
    return (
      <a className={buttonVariants()} href={instruction.url} rel="noreferrer">
        Continue to payment
      </a>
    );
  }
  if (instruction.kind === "bank-transfer") {
    return (
      <section>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">{instruction.rail} transfer</h4>
          {instruction.bank ? (
            <p className="text-sm">Bank: {instruction.bank}</p>
          ) : null}
          {instruction.accountName ? (
            <p className="text-sm">Name: {instruction.accountName}</p>
          ) : null}
          <dl>
            <CopyDefinitionRow
              label="Account"
              value={instruction.accountNumber}
              valueKind="account number"
            />
            {instruction.alias ? (
              <CopyDefinitionRow
                label="Alias"
                value={instruction.alias}
                valueKind="alias"
              />
            ) : null}
            {instruction.reference ? (
              <CopyDefinitionRow
                label="Reference"
                value={instruction.reference}
                valueKind="reference"
              />
            ) : null}
          </dl>
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
          <h4 className="text-sm font-medium">
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
        <h4 className="text-sm font-medium">{instruction.scheme}</h4>
        <dl>
          <CopyDefinitionRow
            label="Payment key"
            value={instruction.key}
            valueKind="payment key"
          />
        </dl>
        <MoneyLine
          value={`Pay exactly ${formatFiatAmount(instruction.amount, instruction.currency)}`}
        />
      </div>
    </section>
  );
}

function CopyDefinitionRow({
  label,
  value,
  valueKind,
}: {
  label: string;
  value: string;
  valueKind: string;
}) {
  return (
    <div className="grid items-start gap-1 border-b py-3 text-sm last:border-b-0 sm:grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 sm:text-right">
        <CopyableValue
          value={value}
          presentation="full"
          valueKind={valueKind}
          className="sm:justify-end"
        />
      </dd>
    </div>
  );
}

function MoneyLine({ value }: { value: string }) {
  return (
    <p className="text-sm tabular-nums">
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
