"use client";

import { useAutoFitAmountText } from "@/client/money-modal/amount";
import { MoneyTicker } from "@/components/money-ticker";
import { Card, CardContent } from "@/components/ui/card";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { formatFiatAmount } from "@/shared/formatting";

export function TradeSummary({ amount, lead, receive, action }: { amount: string; lead: string; receive: string; action: PreparedMoneyAction }) {
  const { containerRef, sizerRef, fontSize } = useAutoFitAmountText(amount);
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <label ref={containerRef} data-trade-amount className="block w-full min-w-0 overflow-hidden whitespace-nowrap text-4xl font-semibold tabular-nums" style={fontSize === undefined ? undefined : { fontSize }}>
          <bdi dir="ltr"><MoneyTicker value={amount} animated={false} reserveDigits={false} /></bdi>
        </label>
        <span ref={sizerRef} className="pointer-events-none absolute invisible whitespace-nowrap text-4xl font-semibold tabular-nums" aria-hidden="true">{amount}</span>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      <Card variant="flush"><CardContent inset="list"><dl>
        <div className="flex items-start justify-between gap-4 px-3 py-3 text-sm">
          <dt className="text-muted-foreground">You get</dt>
          <dd className="min-w-0 text-end font-medium tabular-nums"><bdi dir="ltr">≈ {receive}</bdi></dd>
        </div>
        <div className="flex items-start justify-between gap-4 px-3 py-3 text-sm">
          <dt className="text-muted-foreground">Network fee</dt>
          <dd className="min-w-0 text-end font-medium tabular-nums"><bdi dir="ltr">{action.networkFee?.payment === "usdc" ? `Up to ${formatFiatAmount(BigInt(action.networkFee.maxFeeBaseUnits), action.networkFee.decimals, "USD", { fractionDigits: 2 })}` : "—"}</bdi></dd>
        </div>
      </dl></CardContent></Card>
    </div>
  );
}
