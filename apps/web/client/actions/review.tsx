"use client";

import { useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MoneyTicker } from "@/components/money-ticker";
import { useAccountWallet } from "@/client/account/cdp-client";
import {
  formatPresentationDate,
  formatExactPresentationTokenAmount,
} from "@/shared/formatting";
import { useReactiveExpiry } from "./expiry";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";

export type MoneyActionReviewProps = {
  action: PreparedMoneyAction;
  onClose: () => void;
  onConfirmed: (result: OperationResult) => void;
  execute?: (action: PreparedMoneyAction) => Promise<OperationResult>;
};

export function MoneyActionReview(props: MoneyActionReviewProps) {
  return props.execute
    ? <MoneyActionReviewContent {...props} execute={props.execute} />
    : <ConnectedMoneyActionReview {...props} />;
}

function ConnectedMoneyActionReview(props: MoneyActionReviewProps) {
  const wallet = useAccountWallet();
  return <MoneyActionReviewContent {...props} execute={wallet.executeMoneyAction} />;
}

function MoneyActionReviewContent({
  action,
  onClose,
  onConfirmed,
  execute,
}: MoneyActionReviewProps & {
  execute: (action: PreparedMoneyAction) => Promise<OperationResult>;
}) {
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { expired, recheckExpired } = useReactiveExpiry(action.expiresAt);

  async function confirm() {
    if (pending) return;
    if (!attempted && recheckExpired()) {
      setError("This prepared action expired. Prepare and review a fresh action.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await execute(action);
      setAttempted(true);
      if (isTerminalStatus(result.status)) {
        setError(messageForStatus(result.status));
        return;
      }
      onConfirmed(result);
    } catch {
      setAttempted(true);
      setError("The dispatch outcome is unresolved. Retry recording this same action; a new dispatch will not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="surface-primary mx-auto mt-4 grid w-full max-w-3xl gap-4 rounded-xl border border-border border-t-primary border-t-3 p-4 sm:p-6"
      aria-labelledby={`money-action-${action.id}`}
    >
      <h3
        id={`money-action-${action.id}`}
        className="text-section-title font-semibold tracking-tight"
      >
        {action.title}
      </h3>
      <dl className="m-0 grid border-t border-foreground">
        {action.amounts.map((amount, index) => {
          const formattedAmount = formatExactPresentationTokenAmount(
            amount.amountBaseUnits,
            amount.decimals,
            amount.symbol,
          );
          return (
            <div
              className="text-metadata grid min-h-11 grid-cols-1 items-start gap-1 border-b border-border py-2 sm:grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)] sm:gap-3"
              key={`${amount.assetId}-${amount.direction}-${index}`}
            >
              <dt className="text-muted-foreground">
                {amount.maximum ? "Up to" : amount.direction === "spend" ? "You spend" : "You receive"}
              </dt>
              <dd className="m-0 overflow-wrap-anywhere font-medium sm:text-right">
                {amount.estimated ? "Estimated " : ""}
                <MoneyTicker className="inline-flex align-bottom" value={formattedAmount} />
              </dd>
            </div>
          );
        })}
        <ReviewRow label="Network">Base (8453)</ReviewRow>
        <ReviewRow label="Valid until">
          {formatPresentationDate(action.expiresAt, { style: "date-time-zone" })}
        </ReviewRow>
      </dl>
      {action.warnings.map((warning) => (
        <Alert
          className="text-metadata border-warning-border bg-warning-background text-foreground"
          role="status"
          key={warning}
        >
          <AlertDescription className="text-inherit">
            {presentReviewWarning(warning)}
          </AlertDescription>
        </Alert>
      ))}
      {expired && !attempted ? (
        <Alert className="text-metadata" variant="destructive" role="alert">
          <AlertDescription className="text-inherit">
            This prepared action expired. Prepare and review a fresh action.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert className="text-metadata" variant="destructive" role="alert">
          <AlertDescription className="text-inherit">{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-2">
        <Button className="min-h-11 w-full" variant="secondary" disabled={pending} onClick={onClose}>Back</Button>
        <Button
          className="min-h-11 w-full aria-busy:opacity-60"
          disabled={pending || (expired && !attempted)}
          aria-busy={pending}
          onClick={() => void confirm()}
        >
          {attempted ? "Retry" : action.kind === "trade" ? "Confirm trade" : "Confirm action"}
        </Button>
      </div>
    </section>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-metadata grid min-h-11 grid-cols-1 items-start gap-1 border-b border-border py-2 sm:grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 overflow-wrap-anywhere font-medium sm:text-right">{children}</dd>
    </div>
  );
}

function presentReviewWarning(warning: string): string {
  if (/wallet will show the Base network fee/i.test(warning)) {
    return "Base network fees apply and are finalized at submission.";
  }
  return warning.replace(/the final wallet review binds/i, "final confirmation binds");
}

function isTerminalStatus(status: OperationResult["status"]): boolean {
  return status === "rejected" || status === "failed";
}

function messageForStatus(status: OperationResult["status"]): string {
  switch (status) {
    case "rejected": return "The wallet request was rejected.";
    case "failed": return "The verified onchain receipt reported failure.";
    default: return "The action is pending.";
  }
}
