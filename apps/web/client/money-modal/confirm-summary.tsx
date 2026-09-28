"use client";

import { AddressText } from "@/components/address-text";
import { splitMoneyTickerValue } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";
import { useId, useState, type ReactNode } from "react";
import { useAutoFitAmountText } from "./amount";
import { NetworkFeeReview } from "./network-fee-review";

export type MoneyConfirmRow = { label: string; value: ReactNode; fullValue?: boolean };

export function moneyConfirmFromRow(owner: MoneyActionOwner): MoneyConfirmRow {
  return { label: "From", value: <AddressText address={owner.address} className="justify-end" /> };
}

export function MoneyConfirmSummary({ amount, lead, rows, details, action, destination }: { amount: string; lead: string; rows: readonly MoneyConfirmRow[]; details?: readonly MoneyConfirmRow[]; action?: PreparedMoneyAction | null; destination?: ReactNode }) {
  const { containerRef, sizerRef, fontSize, overflows } = useAutoFitAmountText<HTMLDivElement>(amount, { minRem: 1.5 });
  const { prefix, numeric, suffix } = splitMoneyTickerValue(amount);
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const reviewRows: readonly MoneyConfirmRow[] = action?.networkFee?.payment === "usdc"
    ? [...rows, { label: "Network fee", value: <NetworkFeeReview fee={action.networkFee} /> }]
    : rows;
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <div className="relative min-w-0">
          <div
            ref={containerRef}
            data-slot="confirm-amount"
            className="min-w-0 px-4 text-center text-4xl font-semibold tabular-nums"
            style={fontSize === undefined ? undefined : { fontSize }}
          >
            <bdi dir="ltr" className={overflows ? "block min-w-0" : "whitespace-nowrap"}>
              {overflows ? (
                <>
                  <span data-slot="confirm-amount-number" className="block min-w-0 wrap-anywhere">
                    {prefix}{Array.from(numeric).map((character, index) => (
                      // oxlint-disable-next-line react/no-array-index-key -- Character position is the identity of each amount segment.
                      <span key={index}>{character}{/[.,'\u00a0\u2019\u202f]/u.test(character) ? <wbr /> : null}</span>
                    ))}
                  </span>
                  {suffix ? <span data-slot="confirm-amount-unit" className="block min-w-0 wrap-anywhere">{suffix}</span> : null}
                </>
              ) : amount}
            </bdi>
          </div>
          <span className="pointer-events-none absolute size-0 overflow-hidden" aria-hidden="true">
            <span ref={sizerRef} className="inline-block whitespace-nowrap text-4xl font-semibold tabular-nums">{amount}</span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      {destination}
      <div className={details?.length ? "space-y-4" : undefined}>
        <ConfirmRows rows={reviewRows} />
        {details?.length ? <>
          <Button variant="ghost" size="touch" className="w-full" aria-expanded={detailsOpen} aria-controls={detailsOpen ? detailsId : undefined}
            onClick={() => setDetailsOpen(!detailsOpen)}>
            Details {detailsOpen ? <ChevronUp data-icon="inline-end" aria-hidden="true" /> : <ChevronDown data-icon="inline-end" aria-hidden="true" />}
          </Button>
          {detailsOpen ? <ConfirmRows id={detailsId} rows={details} /> : null}
        </> : null}
      </div>
    </div>
  );
}

function ConfirmRows({ rows, id }: { rows: readonly MoneyConfirmRow[]; id?: string }) {
  return <Card variant="flush"><CardContent inset="list"><dl id={id}>
    {rows.map((row) => <div
      className={row.fullValue
        ? "grid items-start gap-1 px-3 py-3 text-sm sm:grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)] sm:gap-3"
        : "flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-3 text-sm"}
      key={row.label}
    >
      <dt className="min-w-0 wrap-break-word text-muted-foreground">{row.label}</dt>
      <dd className={row.fullValue ? "min-w-0 wrap-break-word sm:text-end" : "ms-auto min-w-0 wrap-break-word text-end font-medium tabular-nums"}>
        {row.value}
      </dd>
    </div>)}
  </dl></CardContent></Card>;
}
