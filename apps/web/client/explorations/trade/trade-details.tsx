"use client";

import { moneyConfirmFromRow } from "@/client/money-modal";
import type { MoneyConfirmRow } from "@/client/money-modal/confirm-summary";
import { Card, CardContent } from "@/components/ui/card";
import { formatExactPresentationTokenAmount, formatPresentationDate } from "@/shared/formatting";
import { BASE_CHAIN_ID } from "@/shared/assets/base";
import { quoteAmount, type TradeQuote } from "./trade-fixtures";

export function TradeDetails({ quote, timeZone, id, reducedMotion }: { quote: TradeQuote; timeZone?: string; id: string; reducedMotion?: boolean }) {
  const rows: MoneyConfirmRow[] = [
    { label: "You pay", value: quoteAmount(quote, "spend") },
    { label: "Minimum received", value: quote.minimum },
    { label: "Rate", value: quote.rate },
    { label: "Max slippage", value: quote.maxSlippage },
    { label: "Quote valid until", value: formatPresentationDate(quote.action.expiresAt, { style: "quote-time", timeZone }) },
    { label: "Network fee", value: quote.action.networkFee?.payment === "usdc" ? `Up to ${formatExactPresentationTokenAmount(quote.action.networkFee.maxFeeBaseUnits, quote.action.networkFee.decimals, "USDC")}` : "—" },
    { label: "Network", value: quote.action.owner.chainId === BASE_CHAIN_ID ? "Base" : "—" },
    moneyConfirmFromRow(quote.action.owner),
  ];
  return <div id={id} className={reducedMotion ? undefined : "transition-opacity duration-120 starting:opacity-0 motion-reduce:transition-none"}>
    <Card variant="flush"><CardContent inset="list"><dl>
      {rows.map((row) => <div key={row.label} className={row.fullValue
        ? "grid items-start gap-1 px-3 py-3 text-sm sm:grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)] sm:gap-3"
        : "flex items-start justify-between gap-4 px-3 py-3 text-sm"}>
        <dt className="text-muted-foreground">{row.label}</dt>
        <dd className={row.fullValue ? "min-w-0 sm:text-end" : "min-w-0 text-end font-medium tabular-nums"}><bdi dir="ltr">{row.value}</bdi></dd>
      </div>)}
    </dl></CardContent></Card>
  </div>;
}
