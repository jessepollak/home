"use client";

import { CircleQuestionMark, HandCoins, X } from "lucide-react";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { ActivityRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { RegionId } from "@/config/regions";
import { getDirectPortfolioAssets } from "@/config/portfolio-assets";
import {
  formatPresentationDate,
  formatPresentationTokenAmount,
} from "@/shared/formatting";
import {
  labelForOperationStatus,
  primaryOperationAmount,
  titleForOperation,
} from "./operation-details";

const portfolioAssetKeyById: ReadonlyMap<string, string> = new Map(
  getDirectPortfolioAssets().flatMap((asset) => [
    [asset.id, asset.assetKey],
    [asset.assetKey, asset.assetKey],
  ]),
);

export function OperationActivityRow({
  operation,
  regionId,
  onActivate,
}: {
  operation: RecentMoneyActionOperation;
  regionId: RegionId;
  onActivate: () => void;
}) {
  const amount = primaryOperationAmount(operation);
  const status = labelForOperationStatus(operation.status);
  const date = formatPresentationDate(operation.updatedAt, { style: "activity-short", regionId });
  const value = amount
    ? `${amount.direction === "spend" ? "−" : "+"}${amount.estimated ? "~" : ""}${formatPresentationTokenAmount(
        amount.amountBaseUnits,
        amount.decimals,
        amount.symbol,
        { cashCurrency: amount.symbol === "USDC" ? "USD" : null, regionId },
      )}`
    : null;
  const failed = operation.status === "failed";
  const title = titleForOperation(operation);
  const icon = failed
    ? <X className="size-4" />
    : operation.status === "unknown"
      ? <CircleQuestionMark className="size-4" />
      : operation.action.kind === "borrow" || operation.action.kind === "repay"
        ? <GlyphMark size="sm"><HandCoins /></GlyphMark>
        : (
            <CurrencyMark
              assetKey={amount ? portfolioAssetKeyById.get(amount.assetId.toLowerCase()) : null}
              symbol={amount?.symbol ?? "?"}
              size="sm"
            />
          );

  return (
    <ActivityRow
      icon={icon}
      iconTone={failed ? "outlined" : operation.status === "unknown" ? "neutral" : "mark"}
      label={title}
      context={<><time dateTime={operation.updatedAt}>{date}</time> · {status}</>}
      value={value ? <MoneyTicker value={value} /> : status}
      valueTone={failed
        ? "error"
        : operation.status === "unknown"
          ? "muted"
          : amount?.direction === "receive"
            ? "success"
            : "default"}
      onActivate={onActivate}
      activateLabel={`View ${title} transaction details`}
    />
  );
}
