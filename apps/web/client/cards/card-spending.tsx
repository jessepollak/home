"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useReactiveExpiry } from "@/client/actions/expiry";
import { useMoneyActionOutcome } from "@/client/actions/money-action-outcome";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { ShimmerRows } from "@/client/home/panel-shared";
import { openPanelAfterClose, useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { MoneyAmountDisplay, MoneyConfirmSummary, moneyConfirmFromRow, MoneyConfirmFooter, MoneyModal, MoneyModalBody, MoneyModalFooter, MoneyModalHeader, MoneyModalStep, MoneyResult, MoneyResultFooter, isPositiveDecimalAmount } from "@/client/money-modal";
import { parseUsdcAmount } from "@/client/savings/format";
import { reportClientError } from "@/client/observability/client-reporter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { parseCardAllowanceMetadata, type CardAllowancePrepareParams, type CardSpendingResponse } from "@/shared/cards/allowance-contract";
import { formatAddress, formatPresentationDate, formatUsdStablecoinAmount } from "@/shared/formatting";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";

export type CardSpendingData =
  | { status: "loading" | "unavailable" | "not-configured" }
  | { status: "ready"; response: Extract<CardSpendingResponse, { status: "available" }> };

export type CardSpendingCommands = {
  prepare: (params: CardAllowancePrepareParams) => Promise<PreparedMoneyAction>;
  execute: AccountWalletClient["executeMoneyAction"];
  fetchOperations: AccountWalletClient["fetchOperations"];
};

type Preparation = { action: PreparedMoneyAction } | { error: unknown };
type Entry = ({ operation: "set" } | { operation: "revoke"; spender: `0x${string}`; preparation: Promise<Preparation> }) & { opener: HTMLElement };
type Submission = "submitted" | "ambiguous" | "failed";
const unavailableMessage = "Card spending limits are unavailable right now. Try again.";

export function cardSpendingData(query: { data?: CardSpendingResponse; isError: boolean }): CardSpendingData {
  if (query.isError || query.data?.status === "unavailable") return { status: "unavailable" };
  if (!query.data) return { status: "loading" };
  if (query.data.status === "not-configured") return { status: "not-configured" };
  return { status: "ready", response: query.data };
}

function limitLabel(baseUnits: string): string {
  if (BigInt(baseUnits) === BigInt(0)) return "Not set";
  if (BigInt(baseUnits) >= (BigInt(1) << BigInt(255))) return "Unlimited";
  return formatUsdStablecoinAmount(baseUnits);
}

export function CardSpending({ spending, variant, visible, canSet, commands, onRefresh }: {
  spending: CardSpendingData;
  variant: "full" | "revoke-only";
  visible: boolean;
  canSet: boolean;
  commands?: CardSpendingCommands;
  onRefresh?: () => void;
}) {
  const headingId = useId();
  const [entry, setEntry] = useState<Entry | null>(null);
  const ready = spending.status === "ready" ? spending.response : null;
  function revoke(spender: `0x${string}`, opener: HTMLElement) {
    if (!commands) return;
    const preparation = commands.prepare({ version: 1, operation: "revoke", spender }).then(
      (action): Preparation => ({ action }), (error: unknown): Preparation => ({ error }),
    );
    setEntry({ operation: "revoke", spender, preparation, opener });
  }
  const sectionVisible = visible && (variant === "full" || Boolean(ready && (BigInt(ready.allowanceBaseUnits) > BigInt(0) || ready.retired.some((item) => BigInt(item.allowanceBaseUnits) > BigInt(0)))));
  return <>{sectionVisible ? <section aria-labelledby={headingId} aria-busy={spending.status === "loading" || undefined}>
    <Card className="gap-3">
      <CardHeader><HomeSectionHeading id={headingId}>Spending</HomeSectionHeading></CardHeader>
      <CardContent inset="list">
        {spending.status === "loading" ? <ShimmerRows count={2} /> : null}
        {spending.status === "unavailable" ? <Item>
          <ItemContent><ItemTitle role="alert">Couldn&apos;t load your spending limit</ItemTitle></ItemContent>
          <ItemActions><Button variant="ghost" size="sm" disabled={!onRefresh} onClick={onRefresh}>Try again</Button></ItemActions>
        </Item> : null}
        {spending.status === "not-configured" ? <Item>
          <ItemContent><ItemTitle>Spending limit</ItemTitle><ItemDescription>Not available yet</ItemDescription></ItemContent>
          <ItemActions><Button variant="ghost" size="sm" disabled>Set limit</Button></ItemActions>
        </Item> : null}
        {ready ? <>
          {variant === "full" ? <>
          <Item><ItemContent><ItemTitle>Available to spend</ItemTitle><ItemDescription>{formatUsdStablecoinAmount(ready.availableBaseUnits)}</ItemDescription></ItemContent></Item>
          <Item>
            <ItemContent><ItemTitle>Spending limit</ItemTitle><ItemDescription>{limitLabel(ready.allowanceBaseUnits)}</ItemDescription>
              {!ready.setEnabled || !canSet ? <ItemDescription>Not available yet</ItemDescription> : null}
            </ItemContent>
            <ItemActions><Button variant="ghost" size="sm" disabled={!ready.setEnabled || !canSet || !commands} onClick={(event) => setEntry({ operation: "set", opener: event.currentTarget })}>
              {BigInt(ready.allowanceBaseUnits) === BigInt(0) ? "Set limit" : "Change"}
            </Button></ItemActions>
          </Item>
          </> : null}
          {BigInt(ready.allowanceBaseUnits) > BigInt(0) ? <Item>
            <ItemContent><ItemTitle>Turn off card spending</ItemTitle></ItemContent>
            <ItemActions><Button variant="ghost" size="sm" disabled={!commands} onClick={(event) => revoke(ready.spender, event.currentTarget)}>Turn off</Button></ItemActions>
          </Item> : null}
          {ready.retired.filter((item) => BigInt(item.allowanceBaseUnits) > BigInt(0)).map((item) => <Item key={item.spender}>
            <ItemContent><ItemTitle>Old card program</ItemTitle><ItemDescription>{limitLabel(item.allowanceBaseUnits)}</ItemDescription></ItemContent>
            <ItemActions><Button variant="ghost" size="sm" aria-label={`Remove old card program ${formatAddress(item.spender)}`} disabled={!commands} onClick={(event) => revoke(item.spender, event.currentTarget)}>Remove</Button></ItemActions>
          </Item>)}
        </> : null}
      </CardContent>
    </Card>
  </section> : null}
    {entry && commands ? <CardSpendingSheet entry={entry} commands={commands} onClosed={() => setEntry(null)} onRefresh={onRefresh} /> : null}
  </>;
}

function prepareErrorMessage(error: unknown, operation: CardAllowancePrepareParams["operation"]): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "CARD_ALLOWANCE_INVALID") return operation === "revoke" ? "This permission can't be removed here right now." : "Enter a lower limit.";
  if (code === "CARD_ALLOWANCE_UNCHANGED") return operation === "revoke" ? "This permission is already off." : "That's already your limit.";
  if (code === "CARD_ALLOWANCE_NOT_READY") return "An active card is required.";
  return unavailableMessage;
}

function CardSpendingSheet({ entry, commands, onClosed, onRefresh }: {
  entry: Entry;
  commands: CardSpendingCommands;
  onClosed: () => void;
  onRefresh?: () => void;
}) {
  const titleId = useId();
  const routing = useOptionalHomeShellRouting();
  const [open, setOpen] = useState(true);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"amount" | "confirm" | "pending" | "result">("amount");
  const [preparing, setPreparing] = useState(entry.operation === "revoke");
  const [action, setAction] = useState<PreparedMoneyAction | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [staleSession, setStaleSession] = useState(false);
  const [serverExpiredActionId, setServerExpiredActionId] = useState<string | null>(null);
  const generation = useRef(0);
  const submitted = useRef(false);
  const running = useRef(entry.operation === "revoke");
  useLayoutEffect(() => () => { generation.current += 1; }, []);
  const { expired: clientExpired, recheckExpired } = useReactiveExpiry(action?.expiresAt ?? null);
  const expired = clientExpired || Boolean(action && serverExpiredActionId === action.id);
  const metadata = action ? parseCardAllowanceMetadata(action.metadata) : null;
  const validAmount = isPositiveDecimalAmount(amount) && (amount.replace(/\.$/, "").split(".")[1]?.length ?? 0) <= 6;
  const revoke = entry.operation === "revoke";

  const receivePreparation = useCallback(async (params: CardAllowancePrepareParams, promise: Promise<Preparation>, started: number) => {
    try {
      const result = await promise;
      if ("error" in result) throw result.error;
      const prepared = result.action;
      const review = parseCardAllowanceMetadata(prepared.metadata);
      if (prepared.kind !== "card-allowance" || !review ||
        (params.operation === "set" ? review.operation !== "set-allowance" || review.allowanceBaseUnits !== params.allowanceBaseUnits
          : review.operation !== "revoke-allowance" || review.spender !== params.spender.toLowerCase())) throw new Error("Invalid card allowance action");
      if (generation.current === started) { setAction(prepared); setServerExpiredActionId(null); setUnresolved(false); setStaleSession(false); setStep("confirm"); }
    } catch (caught) {
      void reportClientError({ name: caught instanceof Error ? caught.name : "Error", message: "Card allowance preparation failed", route: window.location.pathname });
      if (generation.current === started) setError(prepareErrorMessage(caught, params.operation));
    } finally {
      if (generation.current === started) { running.current = false; setPreparing(false); }
    }
  }, []);

  function prepare(params: CardAllowancePrepareParams) {
    if (running.current) return;
    running.current = true;
    const started = ++generation.current;
    setPreparing(true);
    setError(null);
    void receivePreparation(params, commands.prepare(params).then(
      (action): Preparation => ({ action }), (error: unknown): Preparation => ({ error }),
    ), started);
  }

  useEffect(() => {
    const started = generation.current;
    if (entry.operation === "revoke") void entry.preparation.then((result) => receivePreparation({ version: 1, operation: "revoke", spender: entry.spender }, Promise.resolve(result), started));
  }, [entry, receivePreparation]);

  function close() {
    generation.current += 1;
    setOpen(false);
    if (submitted.current) onRefresh?.();
  }

  function back() {
    if (revoke) { close(); return; }
    setAction(null);
    setUnresolved(false);
    setServerExpiredActionId(null);
    setError(null);
    setStep("amount");
  }

  async function confirm() {
    if (!action || !metadata || running.current || staleSession || step !== "confirm") return;
    if (expired || recheckExpired()) { setError("This spending change expired. Go back and continue again."); return; }
    running.current = true;
    const started = generation.current;
    setError(null);
    setUnresolved(false);
    setStep("pending");
    try {
      const result = await commands.execute(action);
      if (generation.current === started) {
        if (result.status === "rejected") { setError("The wallet request was rejected."); setStep("confirm"); }
        else { submitted.current = true; setSubmission(result.status === "failed" ? "failed" : "submitted"); setStep("result"); }
      }
    } catch (caught) {
      void reportClientError({ name: caught instanceof Error ? caught.name : "Error", message: "Card allowance submission failed", route: window.location.pathname });
      if (generation.current === started) {
        if (caught instanceof TransferExecutionError && (caught.reason === "submission-unknown" || caught.reason === "dispatch-unknown")) {
          submitted.current = true;
          setSubmission("ambiguous");
          setStep("result");
        } else {
          if (caught instanceof TransferExecutionError && caught.reason === "stale-session") {
            setStaleSession(true);
            setError("Your account changed. Sign in again and try again.");
          } else if (caught && typeof caught === "object" && "code" in caught && caught.code === "ACTION_EXPIRED") {
            setServerExpiredActionId(action.id);
          } else {
            submitted.current = true;
            setUnresolved(true);
            setError("The result is unresolved. Try again to record this same action; it won't be sent twice.");
          }
          setStep("confirm");
        }
      }
    } finally {
      if (generation.current === started) running.current = false;
    }
  }

  const lead = revoke ? "Turn off card spending" : "Set card spending limit";
  return <MoneyModal open={open} opener={entry.opener} labelledBy={titleId} pending={step === "pending"} onCancel={close} onClose={onClosed}>
    <MoneyModalStep step={step === "pending" ? "confirm" : step} depth={step === "amount" ? 0 : step === "result" ? 2 : 1}>
      <MoneyModalHeader title={step === "amount" ? lead : step === "result" ? "Card spending" : "Confirm"} titleId={titleId} closeLabel="Close spending limit" />
      {step === "result" && action && metadata && submission ? <CardSpendingResult action={action} submission={submission} commands={commands} onRefresh={onRefresh} onDone={close}
        onTryAgain={() => { setAction(null); setSubmission(null); setError(null); setStep("amount"); if (entry.operation === "revoke") void prepare({ version: 1, operation: "revoke", spender: entry.spender }); }}
        onViewActivity={() => openPanelAfterClose(routing, "activity", close)} /> : <>
        <MoneyModalBody hasFooter className="gap-4 pt-4">
          {step === "amount" ? revoke ? <div aria-busy={preparing || undefined}>{preparing ? <ShimmerRows count={2} /> : null}</div> : <MoneyAmountDisplay
            amount={amount} onAmountChange={setAmount} maxDecimals={6} readOnly={preparing} chipSet="none" unit={{ kind: "fiat", currency: "USD" }} nativeSymbol="USDC" assetId="usdc" assetLabel="USDC" assetLocked
            onSubmit={validAmount ? () => void prepare({ version: 1, operation: "set", allowanceBaseUnits: parseUsdcAmount(amount) }) : undefined} /> : null}
          {action && metadata && step !== "amount" ? <MoneyConfirmSummary action={action} lead={lead} amount={revoke ? "Removed" : formatUsdStablecoinAmount(metadata.allowanceBaseUnits)} rows={[
            moneyConfirmFromRow(action.owner),
            { label: "Spender", value: metadata.spender, fullValue: true },
            { label: "Purpose", value: "Card purchases from Cash" },
            { label: "Current limit", value: limitLabel(metadata.previousAllowanceBaseUnits) },
            ...(!revoke ? [{ label: "New limit", value: formatUsdStablecoinAmount(metadata.allowanceBaseUnits) }] : []),
            { label: "Network", value: "Base" },
            { label: "Valid until", value: formatPresentationDate(action.expiresAt, { style: "date-time-zone" }) },
          ]} /> : null}
          {action?.warnings[0] && step !== "amount" ? <Alert><AlertDescription>{action.warnings[0]}</AlertDescription></Alert> : null}
          {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {expired && step === "confirm" ? <Alert role="alert"><AlertDescription>This spending change expired. Go back and continue again.</AlertDescription></Alert> : null}
        </MoneyModalBody>
        {step === "amount" ? <MoneyModalFooter primaryLabel={revoke ? "Try again" : "Continue"} primaryLoading={preparing} primaryDisabled={preparing || (!revoke && !validAmount)} onPrimary={() => void prepare(entry.operation === "revoke" ? { version: 1, operation: "revoke", spender: entry.spender } : { version: 1, operation: "set", allowanceBaseUnits: parseUsdcAmount(amount) })} /> : null}
        {action && (step === "confirm" || step === "pending") ? <MoneyConfirmFooter action={action} actionExpired={expired} submitting={step === "pending"} primaryLabel={unresolved ? "Try again" : revoke ? "Turn off" : "Set limit"} primaryDisabled={!metadata || expired || staleSession} onPrimary={() => void confirm()} secondaryLabel="Back" onSecondary={back} /> : null}
      </>}
    </MoneyModalStep>
  </MoneyModal>;
}

function CardSpendingResult({ action, submission, commands, onRefresh, onDone, onTryAgain, onViewActivity }: {
  action: PreparedMoneyAction;
  submission: Submission;
  commands: CardSpendingCommands;
  onRefresh?: () => void;
  onDone: () => void;
  onTryAgain: () => void;
  onViewActivity: () => void;
}) {
  const { outcome } = useMoneyActionOutcome({ action, submission, fetchOperations: commands.fetchOperations });
  const refreshed = useRef(false);
  useEffect(() => {
    if ((outcome === "success" || outcome === "failed") && !refreshed.current) { refreshed.current = true; onRefresh?.(); }
  }, [outcome, onRefresh]);
  const metadata = parseCardAllowanceMetadata(action.metadata);
  return <>
    <MoneyModalBody hasFooter><MoneyResult kind="card-allowance" cardOperation={metadata?.operation} outcome={outcome} /></MoneyModalBody>
    <MoneyResultFooter outcome={outcome} onDone={onDone} onTryAgain={onTryAgain} onViewActivity={onViewActivity} />
  </>;
}
