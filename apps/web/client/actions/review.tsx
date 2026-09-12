"use client";

import { useState } from "react";
import { useAccountWallet } from "@/client/account/cdp-client";
import {
  formatPresentationDate,
  formatPresentationTokenAmount,
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
    <section className={styles.review} aria-labelledby={`money-action-${action.id}`}>
      <h3 id={`money-action-${action.id}`}>{action.title}</h3>
      <dl className={styles.rows}>
        {action.amounts.map((amount, index) => (
          <div className={styles.row} key={`${amount.assetId}-${amount.direction}-${index}`}>
            <dt>{amount.maximum ? "Up to" : amount.direction === "spend" ? "You spend" : "You receive"}</dt>
            <dd>
              {amount.estimated ? "Estimated " : ""}
              {formatPresentationTokenAmount(
                amount.amountBaseUnits,
                amount.decimals,
                amount.symbol,
                { cashCurrency: amount.symbol === "USDC" ? "USD" : null },
              )}
            </dd>
          </div>
        ))}
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
        <p className={styles.warning} key={warning}>{presentReviewWarning(warning)}</p>
      ))}
      {expired && !attempted ? <p className={styles.error} role="alert">This prepared action expired. Prepare and review a fresh action.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" disabled={pending} onClick={onClose}>Back</button>
        <button type="button" disabled={pending || (expired && !attempted)} onClick={() => void confirm()}>
          {pending ? "Submitting…" : attempted ? "Retry" : action.kind === "trade" ? "Confirm trade" : "Confirm action"}
        </button>
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
