"use client";

import { Button, Heading, StatusMessage } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import { useState } from "react";
import { useAccountWallet } from "@/client/account/cdp-client";
import {
  formatPresentationDate,
  formatExactPresentationTokenAmount,
} from "@/shared/formatting";
import { useReactiveExpiry } from "./expiry";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import styles from "./review.module.css";

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
    <section className={`${styles.review} surface-primary`} aria-labelledby={`money-action-${action.id}`}>
      <Heading id={`money-action-${action.id}`} level={3} textStyle="section-title" className={styles.title}>
        {action.title}
      </Heading>
      <dl className={styles.rows}>
        {action.amounts.map((amount, index) => {
          const formattedAmount = formatExactPresentationTokenAmount(
            amount.amountBaseUnits,
            amount.decimals,
            amount.symbol,
          );
          return (
            <div className={styles.row} key={`${amount.assetId}-${amount.direction}-${index}`}>
              <dt>{amount.maximum ? "Up to" : amount.direction === "spend" ? "You spend" : "You receive"}</dt>
              <dd>
                {amount.estimated ? "Estimated " : ""}
                <MoneyTicker value={formattedAmount} />
              </dd>
            </div>
          );
        })}
        <div className={styles.row}>
          <dt>Network</dt>
          <dd>Base (8453)</dd>
        </div>
        <div className={styles.row}>
          <dt>Valid until</dt>
          <dd>{formatPresentationDate(action.expiresAt, { style: "date-time-zone" })}</dd>
        </div>
      </dl>
      {action.warnings.map((warning) => (
        <StatusMessage className={styles.warning} tone="warning" key={warning}>
          {presentReviewWarning(warning)}
        </StatusMessage>
      ))}
      {expired && !attempted ? (
        <StatusMessage className={styles.error} tone="error" role="alert">
          This prepared action expired. Prepare and review a fresh action.
        </StatusMessage>
      ) : null}
      {error ? <StatusMessage className={styles.error} tone="error" role="alert">{error}</StatusMessage> : null}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={pending} onClick={onClose}>Back</Button>
        <Button
          disabled={pending || (expired && !attempted)}
          loading={pending}
          onClick={() => void confirm()}
        >
          {pending ? "Submitting…" : attempted ? "Retry" : action.kind === "trade" ? "Confirm trade" : "Confirm action"}
        </Button>
      </div>
    </section>
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
