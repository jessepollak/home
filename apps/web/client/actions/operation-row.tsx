"use client";

import { ArrowDown, ArrowUp, CircleQuestionMark, X } from "lucide-react";
import { ActivityRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import {
  formatPresentationDate,
  formatPresentationTokenAmount,
} from "@/shared/formatting";
import {
  labelForOperationStatus,
  primaryOperationAmount,
} from "./operation-details";

export function OperationActivityRow({
  operation,
  onActivate,
}: {
  operation: RecentMoneyActionOperation;
  onActivate: () => void;
}) {
  const amount = primaryOperationAmount(operation);
  const status = labelForOperationStatus(operation.status);
  const date = formatPresentationDate(operation.updatedAt, { style: "activity-short" });
  const value = amount
    ? `${amount.direction === "spend" ? "−" : "+"}${amount.estimated ? "~" : ""}${formatPresentationTokenAmount(
        amount.amountBaseUnits,
        amount.decimals,
        amount.symbol,
        { cashCurrency: amount.symbol === "USDC" ? "USD" : null },
      )}`
    : null;
  const icon = operation.status === "failed"
    ? <X className="size-4" />
    : operation.status === "unknown"
      ? <CircleQuestionMark className="size-4" />
      : amount?.direction === "receive"
        ? <ArrowDown className="size-4" />
        : <ArrowUp className="size-4" />;

  return (
    <ActivityRow
      icon={icon}
      iconTone={operation.status === "failed" ? "outlined" : amount?.direction === "receive" ? "incoming" : "outgoing"}
      label={operation.action.title}
      context={<><time dateTime={operation.updatedAt}>{date}</time> · {status}</>}
      value={value ? <MoneyTicker value={value} /> : status}
      valueTone={operation.status === "failed" ? "error" : operation.status === "unknown" ? "muted" : "default"}
      onActivate={onActivate}
      activateLabel={`View ${operation.action.title} transaction details`}
    />
  );
}
