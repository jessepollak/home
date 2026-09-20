"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { amountTextFromBaseUnits, type MoveMoneyController } from "./move-money";
import {
  presentMovementReceipt,
  type ExplorationMovement,
  type ExplorationPositionView,
} from "./money-state";
import { FactList, MovementNotice, MovementStatusChip, type ExplorationFact } from "./parts";

/**
 * Shared move-money surface for the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * One implementation owns the states, validation, and interaction contract — amount →
 * review → pending → result with Back, Cancel, and a recovery path — while each direction
 * supplies its own structural grammar: whether choosing a destination is its own screen or
 * an inline choice, whether a step rail is visible, and whether the outcome reads as a
 * panel or a receipt.
 *
 * The flow states its facts exactly and never nudges: it does not pick a vault by rate,
 * does not describe a pending deposit as done, and offers no retry after an unknown
 * outcome.
 */

export type MoveMoneyGrammar = {
  /** `null` keeps the destination choice inline inside the amount step. */
  destination: { title: string; description: string | null; continueLabel: string } | null;
  amount: { title: string; description: string | null; label: string; continueLabel: string };
  review: {
    title: string;
    description: string | null;
    submitLabel: (amountLabel: string) => string;
  };
  pending: { title: string; description: string };
  result: {
    confirmedTitle: (amountLabel: string) => string;
    confirmedDescription: (destinationName: string) => string;
    failedTitle: string;
    failedDescription: string;
    unknownTitle: string;
    unknownDescription: string;
  };
  showStepRail: boolean;
  stepRailLabels: readonly [string, string, string];
  receipt: "panel" | "receipt";
  headingTag?: "h1" | "h2" | "h3";
  backLabel: string;
  cancelLabel: string;
  doneLabel: string;
  activityLabel: string;
};

export function MoveMoneyFlow({
  flow,
  position,
  grammar,
  onExit,
  onOpenActivity,
}: {
  flow: MoveMoneyController;
  /** The position as it stands now, so outcome screens state real resulting balances. */
  position: ExplorationPositionView;
  grammar: MoveMoneyGrammar;
  onExit: () => void;
  onOpenActivity?: () => void;
}) {
  const titleId = `${useId()}-move-title`;
  const amountId = `${useId()}-move-amount`;
  const errorId = `${amountId}-error`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const headingTag = grammar.headingTag ?? "h2";

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [flow.step]);

  const destinationBlock = (
    <ul className="grid list-none gap-2 p-0">
      {flow.destinations.map((vault) => {
        const selected = vault.vaultAddress.toLowerCase() === (flow.destinationId ?? "").toLowerCase();
        const savedCopy = vault.funded ? `${vault.amountLabel} saved` : "Nothing saved yet";
        return (
          <li key={vault.vaultAddress}>
            <Item variant="outline" className="min-h-14">
              <ItemContent className="min-w-0">
                <ItemTitle>{vault.name}</ItemTitle>
                <ItemDescription lines={1}>
                  {vault.apyLabel ? `${vault.apyLabel} · ${savedCopy}` : `Rate unavailable · ${savedCopy}`}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="shrink-0">
                <Button
                  variant={selected ? "secondary" : "outline"}
                  size="lg"
                  className="h-11"
                  aria-pressed={selected}
                  aria-label={`Choose ${vault.name}`}
                  onClick={() => flow.selectDestination(vault.vaultAddress)}
                >
                  {selected ? "Chosen" : "Choose"}
                </Button>
              </ItemActions>
            </Item>
          </li>
        );
      })}
    </ul>
  );

  const isReceipt = grammar.receipt === "receipt";

  /**
   * The receipt tone is a different object, not a differently framed panel: it carries the
   * recorded time, the transaction reference, the status word, and the resulting balances,
   * which is what a dated receipt is for.
   */
  const receiptBlock = (movement: ExplorationMovement) => {
    const receipt = presentMovementReceipt(movement, flow.regionId);
    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">Receipt</p>
        <FactList
          label="Receipt facts"
          facts={[
            { label: "Time", value: receipt.timeLabel },
            { label: "Reference", value: receipt.referenceLabel },
            { label: "Amount", value: receipt.amountLabel },
            { label: "To", value: receipt.destinationName },
            { label: "Network", value: "Base (8453)" },
            { label: "Status", value: receipt.statusLabel },
          ]}
        />
      </div>
    );
  };

  const balanceFacts = (): ExplorationFact[] => [
    { label: "Available to use now", value: position.availableLabel ?? "Unavailable" },
    { label: "Saved now", value: position.savedLabel ?? "Unavailable" },
    { label: "Net position", value: position.netPositionLabel ?? "Incomplete" },
  ];

  const balancesBlock = () => {
    const facts = <FactList label="Resulting balances" facts={balanceFacts()} />;
    if (!isReceipt) return facts;
    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">Resulting balances</p>
        {facts}
      </div>
    );
  };

  const outcomeAmountLabel = flow.amountLabel;
  const outcomeStatus = flow.movement?.status ?? "unknown";
  const outcomeTitle = outcomeStatus === "confirmed"
    ? grammar.result.confirmedTitle(outcomeAmountLabel ?? "your deposit")
    : outcomeStatus === "pending"
      ? grammar.pending.title
      : outcomeStatus === "failed"
        ? grammar.result.failedTitle
        : grammar.result.unknownTitle;
  const outcomeDescription = outcomeStatus === "confirmed"
    ? grammar.result.confirmedDescription(flow.movement?.vaultName ?? flow.destination?.name ?? "your vault")
    : outcomeStatus === "pending"
      ? grammar.pending.description
      : outcomeStatus === "failed"
        ? grammar.result.failedDescription
        : grammar.result.unknownDescription;

  const statusHeader = (status: ExplorationMovement["status"]) =>
    isReceipt ? null : (
      <div className="flex flex-wrap items-center gap-2">
        <MovementStatusChip status={status} />
      </div>
    );

  const stepContent = (() => {
    if (flow.step === "destination" && grammar.destination) {
      if (flow.destinations.length === 0) {
        return (
          <>
            <MovementNotice
              title="Vault list is unavailable right now"
              description="No destination can be chosen until the vault list loads. Nothing has moved."
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-11" onClick={onExit}>
                {grammar.cancelLabel}
              </Button>
            </div>
          </>
        );
      }
      return (
        <>
          <p className="text-sm text-muted-foreground">{grammar.destination.description}</p>
          {destinationBlock}
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11 w-full"
              disabled={flow.destinationId === null}
              onClick={flow.continueFromDestination}
            >
              {grammar.destination.continueLabel}
            </Button>
            <Button variant="ghost" size="lg" className="h-11" onClick={onExit}>
              {grammar.cancelLabel}
            </Button>
          </div>
        </>
      );
    }

    if (flow.step === "amount") {
      return (
        <>
          {grammar.amount.description ? (
            <p className="text-sm text-muted-foreground">{grammar.amount.description}</p>
          ) : null}
          {grammar.destination === null ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium">To</p>
              {flow.destinations.length === 0 ? (
                <MovementNotice
                  title="Vault list is unavailable right now"
                  description="No destination can be chosen until the vault list loads. Nothing has moved."
                />
              ) : (
                destinationBlock
              )}
              {flow.destinationError ? (
                <p role="status" className="text-sm text-destructive">
                  {flow.destinationError}
                </p>
              ) : null}
            </div>
          ) : null}
          {grammar.destination !== null && flow.destination ? (
            <p className="text-sm text-muted-foreground">
              {`Into ${flow.destination.name}${
                flow.destination.apyLabel ? ` · ${flow.destination.apyLabel}` : ""
              }`}
            </p>
          ) : null}
          <Field data-invalid={flow.amountError ? true : undefined}>
            <FieldLabel htmlFor={amountId}>{grammar.amount.label}</FieldLabel>
            <Input
              ref={amountInputRef}
              id={amountId}
              variant="touch"
              inputMode="decimal"
              autoComplete="off"
              value={flow.amountText}
              aria-invalid={flow.amountError ? true : undefined}
              aria-describedby={flow.amountError ? errorId : undefined}
              // The owned Input writes through React's native input event; `onChange`
              // (and the wrapper's `onValueChange`) does not reach a controlled field
              // inside this composition, and `onInput` is the contract the production
              // Input callers use.
              onInput={(event) => flow.setAmountText(event.currentTarget.value)}
              onBlur={flow.markAmountTouched}
            />
            {flow.amountError ? (
              <FieldError id={errorId}>{flow.amountError}</FieldError>
            ) : (
              <FieldDescription>
                Available to use {flow.availableLabel ?? "unavailable"}
              </FieldDescription>
            )}
          </Field>
          {flow.quickAmounts.length > 0 ? (
            <div role="group" aria-label="Amount shortcuts" className="flex flex-wrap gap-2">
              {flow.quickAmounts.map((quick) => (
                <Button
                  key={quick.baseUnits}
                  variant="outline"
                  className="h-11"
                  onClick={() => flow.setAmountText(amountTextFromBaseUnits(quick.baseUnits))}
                >
                  {quick.label}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11 w-full"
              onClick={() => {
                if (flow.amountBaseUnits === null) {
                  // A rejected or empty amount puts the person back in the field that needs
                  // an answer instead of leaving them on a button that appears to do nothing.
                  flow.continueFromAmount();
                  amountInputRef.current?.focus();
                  return;
                }
                flow.continueFromAmount();
              }}
            >
              {grammar.amount.continueLabel}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-11"
              onClick={() => {
                if (!flow.back()) onExit();
              }}
            >
              {grammar.backLabel}
            </Button>
          </div>
        </>
      );
    }

    if (flow.step === "review" && flow.destination) {
      const reviewFacts: ExplorationFact[] = [
        { label: "Amount", value: flow.amountLabel ?? "—" },
        { label: "From", value: `Available to use ${flow.availableLabel ?? "unavailable"}` },
        {
          label: "To",
          value: flow.destination.name,
          detail: flow.destination.apyLabel ?? "Rate unavailable",
        },
        { label: "Network", value: "Base (8453)" },
      ];
      if (position.netPositionLabel) {
        reviewFacts.push({
          label: "Net position after",
          value: `${position.netPositionLabel} · unchanged`,
        });
      }
      return (
        <>
          {grammar.review.description ? (
            <p className="text-sm text-muted-foreground">{grammar.review.description}</p>
          ) : null}
          <FactList
            label={isReceipt ? "Receipt draft facts" : "Deposit review facts"}
            facts={reviewFacts}
          />
          <div className="flex flex-wrap gap-2">
            <Button className="h-11 w-full" onClick={flow.submit}>
              {grammar.review.submitLabel(flow.amountLabel ?? "—")}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-11"
              onClick={() => {
                flow.back();
              }}
            >
              {grammar.backLabel}
            </Button>
          </div>
        </>
      );
    }

    if (flow.step === "pending") {
      const destinationName = flow.movement?.vaultName ?? flow.destination?.name ?? "—";
      return (
        <>
          {statusHeader("pending")}
          <p role="status" className="text-sm text-muted-foreground">
            {grammar.pending.description}
          </p>
          {isReceipt && flow.movement ? receiptBlock(flow.movement) : null}
          {isReceipt ? (
            balancesBlock()
          ) : (
            <FactList
              label="Deposit in flight facts"
              facts={[
                { label: "Amount", value: flow.amountLabel ?? "—" },
                { label: "To", value: destinationName },
                {
                  label: "Available to use",
                  value: `${flow.availableLabel ?? "Unavailable"} · not moved`,
                },
              ]}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={onExit}>
              {grammar.cancelLabel}
            </Button>
          </div>
        </>
      );
    }

    if (flow.step === "result") {
      const status = outcomeStatus;
      const destinationName = flow.movement?.vaultName ?? flow.destination?.name ?? "your vault";
      return (
        <>
          {statusHeader(status)}
          <p role="status" className="text-sm text-muted-foreground">
            {outcomeDescription}
          </p>
          {isReceipt && flow.movement ? receiptBlock(flow.movement) : null}
          {isReceipt ? (
            balancesBlock()
          ) : (
            <FactList
              label="Balance facts"
              facts={[
                { label: "Amount", value: outcomeAmountLabel ?? "—" },
                { label: "To", value: destinationName },
                ...balanceFacts(),
              ]}
            />
          )}
          {/* Recovery and closing actions sit outside the notice: they are decisions, not
              part of the outcome being reported. */}
          <div className="flex flex-wrap gap-2">
            {status === "failed" ? (
              <Button variant="secondary" className="h-11" onClick={flow.restart}>
                Try again
              </Button>
            ) : null}
            {status === "unknown" && onOpenActivity ? (
              <Button variant="secondary" className="h-11" onClick={onOpenActivity}>
                {grammar.activityLabel}
              </Button>
            ) : null}
            <Button variant="outline" className="h-11" onClick={onExit}>
              {grammar.doneLabel}
            </Button>
          </div>
        </>
      );
    }

    return null;
  })();

  const stepRailIndex = flow.step === "review" ? 1 : flow.step === "pending" || flow.step === "result" ? 2 : 0;

  return (
    <section aria-labelledby={titleId}>
      {/* One panel surface per step keeps every fact, field, and label on the card
          background the theme's muted text is calibrated against. */}
      <Card>
        <CardContent>
          <div className="grid gap-4">
            {grammar.showStepRail ? (
              <ol
                aria-label="Deposit steps"
                className="flex flex-wrap list-none gap-x-4 gap-y-1 p-0 text-sm"
              >
                {grammar.stepRailLabels.map((label, index) => (
                  <li
                    key={label}
                    aria-current={index === stepRailIndex ? "step" : undefined}
                    className={index === stepRailIndex ? "font-medium" : "text-muted-foreground"}
                  >
                    {`${index + 1}. ${label}`}
                  </li>
                ))}
              </ol>
            ) : null}
            <FlowTitle tag={headingTag} id={titleId} headingRef={headingRef}>
              {flow.step === "destination" && grammar.destination
                ? grammar.destination.title
                : flow.step === "amount"
                  ? grammar.amount.title
                  : flow.step === "review"
                    ? grammar.review.title
                    : flow.step === "pending"
                      ? grammar.pending.title
                      : outcomeTitle}
            </FlowTitle>
            {stepContent}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function FlowTitle({
  tag,
  id,
  headingRef,
  children,
}: {
  tag: "h1" | "h2" | "h3";
  id: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  if (tag === "h1") {
    return (
      <h1
        id={id}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg leading-snug font-semibold outline-none"
      >
        {children}
      </h1>
    );
  }
  if (tag === "h3") {
    return (
      <h3
        id={id}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg leading-snug font-semibold outline-none"
      >
        {children}
      </h3>
    );
  }
  return (
    <h2
      id={id}
      ref={headingRef}
      tabIndex={-1}
      className="text-lg leading-snug font-semibold outline-none"
    >
      {children}
    </h2>
  );
}
