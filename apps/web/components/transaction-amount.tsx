"use client";

import { useAutoFitAmountText } from "@/client/money-modal/amount";
import { TransactionStatusMark } from "./transaction-status";
import type { TransactionAmountHeader } from "./transaction-explorer";

export function TransactionAmount({ amount, unit, tone, status }: TransactionAmountHeader) {
  const { containerRef, sizerRef, fontSize, overflows } = useAutoFitAmountText<HTMLElement>(amount, { minRem: 1.5 });

  return (
    <>
      <dl className="flex min-w-0 flex-col items-center gap-2 text-center">
        <dt className="sr-only">Amount</dt>
        <dd ref={containerRef} className={`w-full min-w-0 max-w-full text-center text-4xl font-semibold tabular-nums ${tone === "success" ? "text-market-gain" : "text-foreground"}`} style={fontSize === undefined ? undefined : { fontSize }}>
          <bdi dir="ltr" className="inline-flex max-w-full flex-wrap items-baseline justify-center gap-x-2">
            <span
              data-slot="transaction-amount-scroll"
              className="min-w-0 max-w-full overflow-x-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              tabIndex={overflows ? 0 : undefined}
              role={overflows ? "region" : undefined}
              aria-label={overflows ? `${amount}${unit ? ` ${unit}` : ""}` : undefined}
            ><span data-slot="transaction-amount-number" className="whitespace-nowrap">{amount}</span></span>
            {unit ? <>{" "}<span data-slot="transaction-amount-unit" className="wrap-anywhere">{unit}</span></> : null}
          </bdi>
        </dd>
        <dt className="sr-only">Status</dt>
        <dd><TransactionStatusMark status={status} presentation="badge" /></dd>
      </dl>
      <span ref={sizerRef} className="pointer-events-none absolute invisible whitespace-nowrap text-4xl font-semibold tabular-nums" aria-hidden="true">{amount}</span>
    </>
  );
}
