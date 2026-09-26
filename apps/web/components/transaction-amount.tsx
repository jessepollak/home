import { TransactionStatusMark } from "./transaction-status";
import type { TransactionAmountHeader } from "./transaction-explorer";

export function TransactionAmount({ amount, tone, status }: TransactionAmountHeader) {
  return (
    <dl className="flex min-w-0 flex-col items-center gap-2 text-center">
      <dt className="sr-only">Amount</dt>
      <dd className={`max-w-full wrap-anywhere text-balance text-center text-4xl font-semibold tabular-nums ${tone === "success" ? "text-market-gain" : "text-foreground"}`}>
        {amount}
      </dd>
      <dt className="sr-only">Status</dt>
      <dd><TransactionStatusMark status={status} presentation="badge" /></dd>
    </dl>
  );
}
