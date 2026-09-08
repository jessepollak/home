"use client";

import { useState } from "react";
import { useAccountWallet } from "@/features/account/cdp-client";
import { formatBaseUnitAmount } from "@/features/portfolio";
import { decodeMoneyActionApproval } from "./approval";
import type { OperationResult, PreparedMoneyAction } from "./types";
import styles from "./review.module.css";

export type MoneyActionReviewProps = {
  action: PreparedMoneyAction;
  onClose: () => void;
  onConfirmed: (result: OperationResult) => void;
  execute?: (action: PreparedMoneyAction) => Promise<OperationResult>;
  recovering?: boolean;
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
  recovering = false,
}: MoneyActionReviewProps & {
  execute: (action: PreparedMoneyAction) => Promise<OperationResult>;
}) {
  const [pending, setPending] = useState(false);
  const [unresolved, setUnresolved] = useState(recovering);
  const [error, setError] = useState<string | null>(() =>
    recovering
      ? "The existing submission is unresolved. Check its status; do not submit it again."
      : null,
  );
  const [expired] = useState(() => Date.parse(action.expiresAt) <= Date.now());
  const checkOnly = expired || unresolved;

  async function confirm() {
    if (pending) return;
    setPending(true);
    if (!checkOnly) setError(null);
    try {
      const result = await execute(action);
      if (result.status === "confirmed") {
        setUnresolved(false);
        onConfirmed(result);
        return;
      }
      if (isTerminalStatus(result.status)) {
        setUnresolved(false);
        setError(messageForStatus(result.status));
        return;
      }
      setUnresolved(true);
      setError(messageForStatus(result.status));
    } catch {
      setUnresolved(true);
      setError("The existing submission is unresolved. Check its status; do not submit it again.");
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
              {formatBaseUnitAmount(amount.amountBaseUnits, amount.decimals)} {amount.symbol}
            </dd>
          </div>
        ))}
        {action.calls.map((call, index) => {
          const approval = decodeMoneyActionApproval(call);
          return approval ? (
            <div className={styles.row} key={`${call.to}-${index}`}>
              <dt>Exact approval</dt>
              <dd>
                Token {approval.token}; spender {approval.spender}; cap {approval.amountBaseUnits} base units ({approval.assetId})
              </dd>
            </div>
          ) : (
            <div className={styles.row} key={`${call.to}-${index}`}>
              <dt>{action.calls.length === 1 ? "Target" : `Target ${index + 1}`}</dt>
              <dd>{call.to}</dd>
            </div>
          );
        })}
        <div className={styles.row}>
          <dt>Network</dt>
          <dd>Base (8453)</dd>
        </div>
        <div className={styles.row}>
          <dt>Valid until</dt>
          <dd>{new Date(action.expiresAt).toLocaleTimeString()}</dd>
        </div>
      </dl>
      {action.warnings.map((warning) => (
        <p className={styles.warning} key={warning}>{presentReviewWarning(warning)}</p>
      ))}
      {expired ? <p className={styles.error} role="alert">This prepared action expired. Prepare and review a fresh action.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" disabled={pending} onClick={onClose}>Back</button>
        <button type="button" disabled={pending} onClick={() => void confirm()}>
          {pending
            ? "Checking submission…"
            : checkOnly
              ? expired && !unresolved
                ? "Check action status"
                : "Check status"
              : action.kind === "swap"
                ? "Confirm swap"
                : "Confirm action"}
        </button>
      </div>
    </section>
  );
}

function presentReviewWarning(warning: string): string {
  if (/wallet will show the Base network fee/i.test(warning)) {
    return "Base network fees apply and are finalized at submission.";
  }
  return warning.replace(
    /the final wallet review binds/i,
    "final confirmation binds",
  );
}

function isTerminalStatus(status: OperationResult["status"]): boolean {
  return status === "rejected" || status === "expired" || status === "failed";
}

function messageForStatus(status: OperationResult["status"]): string {
  switch (status) {
    case "rejected": return "The wallet request was rejected.";
    case "expired": return "This prepared action expired. Prepare a fresh action.";
    case "failed": return "The verified onchain receipt reported failure.";
    default: return "The existing submission is still unresolved. Checking again will not resubmit it.";
  }
}
