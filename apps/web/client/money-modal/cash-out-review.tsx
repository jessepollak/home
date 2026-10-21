"use client";

import { CircleAlertIcon } from "lucide-react";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { PayoutDestination } from "@/components/payout-destination";
import { Alert, AlertDescription, AlertIcon } from "@/components/ui/alert";
import { formatExactPresentationTokenAmount } from "@/shared/formatting";
import { formatCashoutArrival, type CashoutQuote } from "@/shared/funding/cash-out-quote";
import { formatCashoutFee, formatCashoutRate, formatCashoutReceive } from "@/shared/funding/cash-out-quote-format";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { MoneyConfirmSummary, type MoneyConfirmRow } from "./confirm-summary";
import { moneyConfirmFacts } from "./confirm-facts";

export function CashOutReview({ action, amount, quote, providerName, platform, platformLabel, canonicalHandle, onEdit, notice }: {
  action: PreparedMoneyAction;
  amount: string;
  quote: CashoutQuote;
  providerName: string;
  platform: string;
  platformLabel: string;
  canonicalHandle: string;
  onEdit: () => void;
  notice?: { tone: "neutral" | "error"; text: string } | null;
}) {
  const regionId = usePresentationRegionId();
  const spend = action.amounts.find((item) => item.direction === "spend");
  const facts = moneyConfirmFacts(action);
  const providerNetwork = quote.fees.network && formatCashoutFee(quote.fees.network, regionId) !== "None" ? quote.fees.network : null;
  const operator = quote.fees.operator && formatCashoutFee(quote.fees.operator, regionId) !== "None" ? quote.fees.operator : null;
  const rate = formatCashoutRate(quote.rate);
  const rows: MoneyConfirmRow[] = [
    ...(spend ? [{ label: "You send", value: <bdi dir="ltr">{formatExactPresentationTokenAmount(spend.amountBaseUnits, spend.decimals, spend.symbol, { regionId })}</bdi> }] : []),
    { label: `${providerName} fee`, value: <bdi dir="ltr">{formatCashoutFee(quote.fees.provider, regionId)}</bdi> },
    ...(providerNetwork ? [{ label: "Provider network fee", value: <bdi dir="ltr">{formatCashoutFee(providerNetwork, regionId)}</bdi> }] : []),
    ...(operator ? [{ label: "Service fee", value: <bdi dir="ltr">{formatCashoutFee(operator, regionId)}</bdi> }] : []),
    ...(rate ? [{ label: "Rate", value: <bdi dir="ltr">{rate}</bdi> }] : []),
    { label: "You receive", value: <bdi>{formatCashoutReceive(quote.receive, platformLabel, regionId)}</bdi> },
    { label: "Arrives", value: formatCashoutArrival(quote.arrival) },
  ];
  const estimate = quote.receive.approximate
    ? quote.arrival.source === "observed" ? "The amount you receive and arrival time are estimates, not guaranteed." : "The amount you receive is an estimate, not guaranteed."
    : quote.arrival.source === "observed" ? "The arrival time is an estimate, not guaranteed." : null;
  return <>
    {facts ? <MoneyConfirmSummary
      facts={facts}
      amount={amount}
      lead={`You're cashing out with ${providerName}`}
      destination={<PayoutDestination platform={platform} label={platformLabel} destination={canonicalHandle} onEdit={onEdit} />}
      rows={rows}
      details={[{ label: "Provider", value: providerName }]}
    /> : null}
    {notice ? <Alert variant={notice.tone === "error" ? "destructive" : "default"} role={notice.tone === "error" ? "alert" : "status"}>
      {notice.tone === "error" ? <AlertIcon><CircleAlertIcon /></AlertIcon> : null}
      <AlertDescription>{notice.text}</AlertDescription>
    </Alert> : null}
    {estimate ? <p className="text-center text-sm text-muted-foreground">{estimate}</p> : null}
  </>;
}
