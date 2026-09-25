"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupOption } from "@/components/ui/radio-group";
import { MoneyTicker } from "@/components/money-ticker";
import { CopyableValue } from "@/components/copyable-value";
import { isTerminalFundingOrderState as terminal, shouldPollFundingOrder } from "./order-polling";
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
} from "@/client/money-modal";
import {
  browserHomeQueryClient,
  ownerQueryKey,
  ownerQueryMeta,
  publicQueryKey,
  useHomeQuery,
  useHomeQueryClient,
} from "@/client/query/query-client";
import type { FundingBinding } from "@/shared/funding/contracts/providers";
import {
  readQuoteDraft,
  type QuoteDraft,
} from "@/shared/funding/contracts/quotes";
import { readFundingProviderCustomer, readVerificationHandoff, type FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import {
  readFundingOrder,
  type FundingOrderSummary,
  type Instruction,
} from "@/shared/funding/contracts/order";
import {
  FUNDING_ORDER_RESOLUTION_VERSION,
  readResolveFundingOrderResponse,
} from "@/shared/funding/contracts/order-resolution";

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
  initialCustomer,
}: {
  binding: FundingBinding;
  fetchAccountResource: AccountFetch;
  queryOwnerKey?: string | null;
  titleId: string;
  onBack: () => void;
  onClose: () => void;
  onOpenRedirect: (url: string) => void;
  initialOrder?: FundingOrderSummary | null;
  initialCustomer?: FundingProviderCustomerSummary | null;
}) {
  const paymentMethodTitleId = useId();
  const [method, setMethod] = useState(binding.paymentMethods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [customer, setCustomer] = useState<FundingProviderCustomerSummary | null>(initialCustomer ?? null);
  const [order, setOrder] = useState<FundingOrderSummary | null>(
    initialOrder ?? null,
  );
  const [showInstructions, setShowInstructions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolvingAmbiguous, setResolvingAmbiguous] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [clearedOrderId, setClearedOrderId] = useState<string | null>(null);
  const [confirmationAttempted, setConfirmationAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedRedirectOrderRef = useRef<string | null>(
    initialOrder?.id ?? null,
  );

  function changeAmount(value: string) {
    setAmount(value);
  }

  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const orderQueryKey = order
    ? queryOwnerKey
      ? ownerQueryKey(queryOwnerKey, "funding-order", order.id)
      : publicQueryKey("funding-order-isolated", order.id)
    : publicQueryKey("funding-order-disabled");
  const orderQuery = useHomeQuery({
    queryKey: orderQueryKey,
    enabled: shouldPollFundingOrder(order),
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
        },
      });
      const parsed = readQuoteDraft(value);
      if (!parsed) throw new Error("quote");
      setDraft(parsed);
    } catch (error) {
      setError(quoteErrorCopy(error));
    } finally {
      setBusy(false);
    }
  }

  async function startVerification() {
    if (busy || !binding.customerSetup) return;
    setBusy(true); setError(null);
    try {
      const value = await fetchAccountResource("/api/funding/provider-customers/verification", { method: "POST", body: { providerId: binding.providerId, region: binding.region, email } });
      const next = readFundingProviderCustomer(value);
      if (next) setCustomer(next);
      const handoff = readVerificationHandoff(value);
      if (!handoff) throw new Error("handoff");
      onOpenRedirect(handoff);
    } catch { setError("Verification could not be started. Home will not repeat an uncertain provider request."); }
    finally { setBusy(false); }
  }

  async function resolveAmbiguousOrder() {
    if (!currentOrder || currentOrder.state !== "dispatch-ambiguous" || resolvingAmbiguous) return;
    setResolvingAmbiguous(true);
    setResolutionError(null);
    try {
      const value = await fetchAccountResource(
        `/api/funding/orders/${currentOrder.id}/resolve`,
        {
          method: "POST",
          body: { version: FUNDING_ORDER_RESOLUTION_VERSION },
        },
      );
      const resolved = readResolveFundingOrderResponse(value);
      if (!resolved) throw new Error("resolution");
      setClearedOrderId(resolved.order.id);
      setOrder(resolved.order);
      queryClient.setQueryData(orderQueryKey, resolved.order);
      if (queryOwnerKey) {
        void queryClient.invalidateQueries({
          queryKey: ownerQueryKey(queryOwnerKey, "funding-open-order", binding.region),
          refetchType: "all",
        });
      }
    } catch (resolveFailure) {
      setResolutionError(resolveAmbiguousErrorCopy(resolveFailure));
    } finally {
      setResolvingAmbiguous(false);
    }
  }

  async function confirmOrder() {
    if (busy || !draft) return;
    setBusy(true);
    setConfirmationAttempted(true);
    setError(null);
    try {
      const value = await fetchAccountResource("/api/funding/orders", {
        method: "POST",
        body: { quoteToken: draft.quoteToken },
      });
      const next = readFundingOrder(value);
      if (!next) throw new Error("order");
      setOrder(next);
      if (
        queryOwnerKey &&
        (next.state === "dispatch-ambiguous" || !terminal(next.state, next.sandbox))
      ) {
        queryClient.setQueryData(
          ownerQueryKey(queryOwnerKey, "funding-open-order", binding.region),
          { order: next },
        );
      }
    } catch (orderError) {
      setError(confirmOrderErrorCopy(orderError));
    } finally {
      setBusy(false);
    }
  }

  if (currentOrder?.instructions?.kind === "redirect") {
    return <><MoneyModalHeader title={`Deposit ${binding.currency}`} titleId={titleId} onBack={onBack} onClose={onClose} closeLabel="Close add money" /><OrderStatus binding={binding} order={currentOrder} /></>;
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
          onBack={onBack}
          onClose={onClose}
          closeLabel="Close add money"
        />
        <OrderStatus
          binding={binding}
          order={currentOrder}
          onRefetch={orderQuery.refetch}
          cleared={currentOrder.id === clearedOrderId && currentOrder.state === "cancelled"}
          {...(currentOrder.state === "dispatch-ambiguous"
            ? {
                onResolve: () => void resolveAmbiguousOrder(),
                resolving: resolvingAmbiguous,
                resolutionError,
              }
            : {})}
        />
      </>
    );
  }
  if (binding.customerSetup && customer?.state !== "verified") {
    const pendingStarted = customer?.state === "pending" && Boolean(customer.verificationStartedAt);
    const reserving = customer?.state === "reserving";
    const ambiguous = customer?.state === "dispatch-ambiguous";
    const rejected = customer?.state === "rejected";
    const blocked = reserving || ambiguous || rejected;
    return <>
      <MoneyModalHeader title={`Set up ${binding.displayName}`} titleId={titleId} onBack={onBack} onClose={onClose} closeLabel="Close add money" />
      <MoneyModalBody hasFooter={!pendingStarted && !blocked} className="gap-4 pt-4">
        {pendingStarted ? <FundingNotice tone="neutral">Verification is pending. Return here after Ripio completes its review. Home will not issue another hosted link automatically.</FundingNotice> : null}
        {reserving ? <FundingNotice tone="neutral">Provider setup is still being created. Home will not start another request.</FundingNotice> : null}
        {ambiguous ? <FundingNotice tone="error" role="alert">Home could not confirm the provider setup result. Do not try again until the operator reconciles it.</FundingNotice> : null}
        {rejected ? <FundingNotice tone="error" role="alert">The provider rejected this setup. Home will not retry it automatically. Ask the operator to reconcile the provider result before restarting setup.</FundingNotice> : null}
        {!pendingStarted && !blocked ? <Field>
          <FieldLabel htmlFor="funding-customer-email">Email</FieldLabel>
          <Input
            id="funding-customer-email"
            type="email"
            value={email}
            required
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </Field> : null}
        {error ? <FundingNotice tone="error" role="alert">{error}</FundingNotice> : null}
      </MoneyModalBody>
      {!pendingStarted && !blocked ? <MoneyModalFooter primaryLabel={busy ? "Working…" : "Continue to Ripio verification"} primaryDisabled={busy || !email.trim()} onPrimary={() => void startVerification()} secondaryLabel="Back" onSecondary={onBack} /> : null}
    </>;
  }
  if (draft) {
    return (
      <>
        <MoneyModalHeader title={`Deposit ${binding.currency}`} titleId={titleId} onBack={() => setDraft(null)} backDisabled={confirmationAttempted} onClose={onClose} closeLabel="Close add money" />
        <QuoteReview binding={binding} draft={draft} busy={busy} error={error} onConfirm={() => void confirmOrder()} />
      </>
    );
  }

  const quoteDisabled = busy || !positiveDecimal(amount);
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
          <div className="grid gap-3">
            <FieldTitle id={paymentMethodTitleId}>Payment method</FieldTitle>
            <RadioGroup aria-labelledby={paymentMethodTitleId} value={method} onValueChange={setMethod}>
              {binding.paymentMethods.map((item) => (
                <RadioGroupOption key={item.id} value={item.id} label={item.label} />
              ))}
            </RadioGroup>
          </div>
        ) : null}
        <MoneyAmountDisplay
          amount={amount}
          maxDecimals={2}
          disabled={busy}
          onAmountChange={changeAmount}
          onSubmit={quoteDisabled ? undefined : () => void requestQuote()}
          assetId={binding.currency.toLocaleLowerCase()}
          assetLabel={binding.currency}
          assetControl="header"
          pricing={{ status: "unpriced" }}
          nativeSymbol={binding.currency}
          fiatCurrency={binding.currency}
        >
          {error ? (
            <FundingNotice tone="error" role="alert">
              {error}
            </FundingNotice>
          ) : null}
        </MoneyAmountDisplay>
      </MoneyModalBody>
      <MoneyModalFooter
        primaryLabel={busy ? "Getting quote…" : "Review quote"}
        primaryDisabled={quoteDisabled}
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
  binding,
  order,
  onRefetch,
  onResolve,
  resolving = false,
  resolutionError = null,
  cleared = false,
}: {
  binding: FundingBinding;
  order: FundingOrderSummary;
  onRefetch?: () => Promise<unknown>;
  onResolve?: () => void;
  resolving?: boolean;
  resolutionError?: string | null;
  cleared?: boolean;
}) {
  const copy = cleared
    ? {
        title: "Order cleared",
        body: "Home closed this deposit attempt without sending another request. You can start a new deposit.",
      }
    : stateCopy(order.state, order.sandbox);
  return (
    <>
      <MoneyModalBody hasFooter={Boolean(onResolve)} className="gap-4 pt-4">
        <h3 className="text-lg font-semibold">{copy.title}</h3>
        {order.sandbox ? <SandboxBadge /> : null}
        {copy.body ? <FundingNotice>{copy.body}</FundingNotice> : null}
        <SettledAmounts binding={binding} order={order} />
        {order.instructions &&
        (order.instructions.kind !== "embed" || order.state === "awaiting-payment") ? (
          <InstructionView
            instruction={order.instructions}
            onRefetch={onRefetch}
          />
        ) : null}
        {resolutionError ? (
          <FundingNotice tone="error" role="alert">
            {resolutionError}
          </FundingNotice>
        ) : null}
      </MoneyModalBody>
      {onResolve ? (
        <MoneyModalFooter
          primaryLabel={resolving ? "Clearing old order…" : "Clear old order"}
          primaryDisabled={resolving}
          onPrimary={onResolve}
        />
      ) : null}
    </>
  );
}

function SettledAmounts({
  binding,
  order,
}: {
  binding: FundingBinding;
  order: FundingOrderSummary;
}) {
  const fees = order.fees ?? [];
  if (!fees.length || !order.expectedTokenAmountAtomic) return null;
  const regionId = presentationCurrencyMetadata(
    binding.currency,
  ).defaultRegionId;
  const receive = formatPresentationTokenAmount(
    order.expectedTokenAmountAtomic,
    binding.assetDecimals,
    binding.assetSymbol,
    { regionId, useNoBreakSpace: true },
  );
  return (
    <dl>
      <DefinitionRow label="Receive" value={receive} />
      {fees.map((fee, index) => (
        <DefinitionRow
          key={`${fee.label}:${index}`}
          label={fee.label}
          value={formatFiatAmount(fee.amount, fee.currency)}
        />
      ))}
    </dl>
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
      body: "Home is waiting to learn whether the provider created this deposit, and will not send it again. You can clear this order 24 hours after its quote expires.",
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
function confirmOrderErrorCopy(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
  if (code === "AMBIGUOUS_ORDER_OPEN") {
    return "Home is still waiting on an earlier deposit. Close and reopen Add money to resume it; no new provider request was created.";
  }
  if (code === "ORDER_STATE_CHANGED") {
    return "This deposit changed while Home was confirming it. Close and reopen Add money to check the existing order before trying again.";
  }
  return "Home could not confirm the order response. Retry to recover this same order; no new quote or provider request will be created.";
}

function quoteErrorCopy(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error.code === "QUOTE_BELOW_MINIMUM" || error.code === "QUOTE_DECLINED") &&
      "serverMessage" in error && typeof error.serverMessage === "string" && error.serverMessage.length <= 200) {
      return error.serverMessage;
    }
    if (error.code === "QUOTE_UNAVAILABLE") return "Quotes are unavailable right now. Try again shortly.";
  }
  return "This quote could not be created. Try again.";
}

function resolveAmbiguousErrorCopy(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "serverMessage" in error &&
    typeof error.serverMessage === "string"
  ) return error.serverMessage;
  return "This order cannot be cleared yet. Home waits 24 hours after its quote expires.";
}

function positiveDecimal(value: string) {
  return /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) && /[1-9]/.test(value);
}
