"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  MoneyAssetPicker,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
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
  titleId,
  onBack,
  onClose,
  onOpenRedirect,
  initialOrder,
}: {
  binding: FundingBinding;
  fetchAccountResource: AccountFetch;
  queryOwnerKey?: string | null;
  titleId: string;
  onBack: () => void;
  onClose: () => void;
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
    enabled: shouldPollFundingOrder(order),
    // The created order is authoritative for the first poll interval; the
    // provider is polled from then on (matches the previous setInterval cadence).
    initialData: order ?? undefined,
    initialDataUpdatedAt: () => Date.now(),
    staleTime: 4_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const current = query.state.data as FundingOrderSummary | undefined;
      return shouldPollFundingOrder(current) ? 4_000 : false;
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
    return <><MoneyModalHeader title={`Deposit ${binding.currency}`} titleId={titleId} onBack={onBack} onClose={onClose} closeLabel="Close add money" /><OrderStatus order={currentOrder} /></>;
  }
  if (
    currentOrder?.instructions &&
    currentOrder.expectedTokenAmountAtomic &&
    !showInstructions &&
    !terminal(currentOrder.state, currentOrder.sandbox)
  ) {
    return (
      <>
        <MoneyModalHeader title={`Deposit ${binding.currency}`} titleId={titleId} onBack={onBack} onClose={onClose} closeLabel="Close add money" />
        <ProviderEconomicsReview binding={binding} order={currentOrder} onContinue={() => setShowInstructions(true)} />
      </>
    );
  }
  if (currentOrder) {
    return (
      <>
        <MoneyModalHeader
          title={`Deposit ${binding.currency}`}
          titleId={titleId}
          {...(currentOrder.state === "dispatch-ambiguous" ? {} : { onBack })}
          onClose={onClose}
          closeLabel="Close add money"
        />
        <OrderStatus order={currentOrder} onRefetch={orderQuery.refetch} />
      </>
    );
  }
  if (draft) {
    return (
      <>
        <MoneyModalHeader title={`Deposit ${binding.currency}`} titleId={titleId} onBack={() => setDraft(null)} backDisabled={confirmationAttempted} onClose={onClose} closeLabel="Close add money" />
        <QuoteReview binding={binding} draft={draft} busy={busy} error={error} onConfirm={() => void confirmOrder()} />
      </>
    );
  }

  const fieldsComplete = !binding.kyc?.fields?.some(
    (field) => !fields[field.name]?.trim(),
  );
  const amountAssetProps = {
    assetId: binding.currency.toLocaleLowerCase(),
    assetLabel: binding.currency,
    assetCurrency: binding.currency,
    locked: true,
  };
  return (
    <>
      <MoneyModalHeader title={`Deposit ${binding.currency}`} titleId={titleId} onClose={onClose} assetControl={<MoneyAssetPicker {...amountAssetProps} />} closeLabel="Close add money" />
      <MoneyModalBody hasFooter className="gap-4 pt-4">
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
          assetId={binding.currency.toLocaleLowerCase()}
          assetLabel={binding.currency}
          assetControl="header"
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
  error,
  onConfirm,
}: {
  binding: FundingBinding;
  draft: QuoteDraft;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
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
      <MoneyModalBody hasFooter className="gap-4 pt-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Review quote</h3>
            </CardTitle>
            {draft.sandbox ? <SandboxBadge /> : null}
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
  // The provider may reprice between quote and order; the created order's
  // instruction carries the fiat total the user will actually pay.
  const instruction = order.instructions;
  const pay =
    instruction && instruction.kind !== "redirect"
      ? formatFiatAmount(instruction.amount, instruction.currency)
      : null;
  return (
    <>
      <MoneyModalBody hasFooter className="gap-4 pt-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Review payment details</h3>
            </CardTitle>
            {order.sandbox ? <SandboxBadge /> : null}
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {pay ? <DefinitionRow label="You pay" value={pay} /> : null}
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
  onRefetch,
}: {
  order: FundingOrderSummary;
  onRefetch?: () => Promise<unknown>;
}) {
  const copy = stateCopy(order.state, order.sandbox);
  return (
    <>
      <MoneyModalBody hasFooter={false} className="gap-4 pt-4">
        <h3 className="text-lg font-semibold">{copy.title}</h3>
        {order.sandbox ? <SandboxBadge /> : null}
        {copy.body ? <FundingNotice>{copy.body}</FundingNotice> : null}
        {order.instructions &&
        (order.instructions.kind !== "embed" || order.state === "awaiting-payment") ? (
          <InstructionView
            instruction={order.instructions}
            onRefetch={onRefetch}
          />
        ) : null}
        {order.providerStatus ? (
          <p className="text-sm text-muted-foreground">
            Status: {order.providerStatus}
          </p>
        ) : null}
      </MoneyModalBody>

    </>
  );
}

function InstructionView({
  instruction,
  onRefetch,
}: {
  instruction: Instruction;
  onRefetch?: () => Promise<unknown>;
}) {
  if (instruction.kind === "redirect") {
    return (
      <a className={buttonVariants()} href={instruction.url} rel="noreferrer">
        Continue to payment
      </a>
    );
  }
  if (instruction.kind === "embed") {
    return <EmbedInstruction instruction={instruction} onRefetch={onRefetch} />;
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

const EMBED_MESSAGE_EVENTS = new Set([
  "onramp_api.load_pending",
  "onramp_api.load_success",
  "onramp_api.load_error",
  "onramp_api.commit_success",
  "onramp_api.commit_error",
  "onramp_api.cancel",
  "onramp_api.polling_start",
  "onramp_api.polling_success",
  "onramp_api.polling_error",
  "onramp_api.verification_success",
  "onramp_api.upgrade_submit_success",
  "onramp_api.upgrade_approved",
  "onramp_api.session_error",
]);
const EMBED_REFETCH_EVENTS = new Set([
  "onramp_api.commit_success",
  "onramp_api.polling_success",
  "onramp_api.polling_error",
  "onramp_api.session_error",
  "onramp_api.commit_error",
]);

function EmbedInstruction({
  instruction,
  onRefetch,
}: {
  instruction: Extract<Instruction, { kind: "embed" }>;
  onRefetch?: () => Promise<unknown>;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const refetchingRef = useRef(false);
  const origin = safeHttpsOrigin(instruction.url);

  useEffect(() => {
    if (!origin || !onRefetch) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== origin ||
        event.source !== iframeRef.current?.contentWindow
      ) return;
      const eventName = readEmbedEventName(event.data);
      if (!eventName || !EMBED_REFETCH_EVENTS.has(eventName)) return;
      if (refetchingRef.current) return;
      refetchingRef.current = true;
      void Promise.resolve(onRefetch()).finally(() => {
        refetchingRef.current = false;
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onRefetch, origin]);

  if (!origin) return null;
  return (
    <section className="flex flex-col gap-3">
      <MoneyLine
        value={`Pay ${formatFiatAmount(instruction.amount, instruction.currency)} with Apple Pay`}
      />
      <iframe
        ref={iframeRef}
        src={instruction.url}
        title="Apple Pay"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        allow="payment"
        className="h-96 w-full border-0"
      />
    </section>
  );
}

function safeHttpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function readEmbedEventName(value: unknown): string | null {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const eventName = (payload as Record<string, unknown>).eventName;
  return typeof eventName === "string" && EMBED_MESSAGE_EVENTS.has(eventName)
    ? eventName
    : null;
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

function SandboxBadge() {
  return <Badge variant="outline">Sandbox — not a real deposit</Badge>;
}

function stateCopy(state: string, sandbox = false) {
  if (state === "received")
    return {
      title: "Money received",
      body: "The matching Base transfer was verified.",
    };
  if (state === "dispatch-ambiguous")
    return {
      title: "Don't try again yet",
      body: "Home could not confirm whether the provider created this deposit. It kept the original order and will not send it twice. Contact the operator before starting another deposit.",
    };
  if (state === "sent-unverified")
    return sandbox
      ? {
          title: "Sandbox complete — no real funds moved",
          body: null,
        }
      : {
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
export function shouldPollFundingOrder(
  order: Pick<FundingOrderSummary, "state" | "sandbox"> | null | undefined,
) {
  return Boolean(order && !terminal(order.state, order.sandbox));
}

function terminal(state: string, sandbox = false) {
  return (sandbox && state === "sent-unverified") || [
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
