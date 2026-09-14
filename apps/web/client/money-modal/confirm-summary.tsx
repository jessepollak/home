"use client";

import { MoneyTicker } from "@/components/money-ticker";
import type { ReactNode } from "react";

export type MoneyConfirmRow = { label: string; value: ReactNode; fullValue?: boolean };

export function MoneyConfirmSummary({ amount, lead, rows }: { amount: string; lead: string; rows: readonly MoneyConfirmRow[] }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <div className="text-4xl font-semibold tabular-nums"><MoneyTicker value={amount} /></div>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      <dl>
        {rows.map((row) => (
          <div
            className={row.fullValue
              ? "grid items-start gap-1 border-b py-3 text-sm last:border-b-0 sm:grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)] sm:gap-3"
              : "flex items-start justify-between gap-4 border-b py-3 text-sm last:border-b-0"}
            key={row.label}
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={row.fullValue ? "min-w-0 sm:text-right" : "min-w-0 text-right font-medium tabular-nums"}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
