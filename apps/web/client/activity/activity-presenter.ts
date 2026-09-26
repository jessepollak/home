import {
  formatAddress,
  formatFiatAmount,
  formatPresentationDate,
  formatPresentationTokenAmountParts,
  joinAmountAndSymbol,
} from "@/shared/formatting";
import type { RegionId } from "@/config/regions";
import {
  baseNetworkRow,
  condensedTransactionHash,
  transactionExplorerLink,
  type TransactionDetailRow,
  type TransactionDetails,
} from "@/components/transaction-explorer";
import type { ActivityDirection, ActivityTransfer } from "./types";
import type { ActivityPricedValuation } from "@/shared/activity/valuation";

export type ActivityIconKey = "incoming" | "outgoing" | "self";

export type ActivityRowViewModel = {
  id: string;
  directionLabel: string;
  iconKey: ActivityIconKey;
  sign: "+" | "−" | "";
  dateTime: string;
  valueTone: "success" | "default";
  fullDate: string;
  shortDate: string;
  value: string;
  valueContext: string | null;
  priced: boolean;
};

export type ActivityPresenterOptions = {
  regionId?: RegionId;
  timeZone?: string;
};

const directionPresentation = {
  incoming: {
    label: "Received",
    iconKey: "incoming",
    sign: "+",
  },
  outgoing: {
    label: "Sent",
    iconKey: "outgoing",
    sign: "−",
  },
  self: {
    label: "Self transfer",
    iconKey: "self",
    sign: "",
  },
} as const satisfies Record<
  ActivityDirection,
  { label: string; iconKey: ActivityIconKey; sign: "+" | "−" | "" }
>;

export function presentActivityTransferRow(
  transfer: ActivityTransfer,
  options: ActivityPresenterOptions,
): ActivityRowViewModel {
  const direction = directionPresentation[transfer.direction];
  const fullDate = formatPresentationDate(transfer.blockTimestamp, {
    regionId: options.regionId,
    timeZone: options.timeZone,
    style: "activity-full",
  });

  return {
    id: transfer.id,
    directionLabel: direction.label,
    iconKey: direction.iconKey,
    sign: direction.sign,
    dateTime: transfer.blockTimestamp,
    valueTone: transfer.direction === "incoming" ? "success" : "default",
    fullDate,
    shortDate: formatPresentationDate(transfer.blockTimestamp, {
      regionId: options.regionId,
      timeZone: options.timeZone,
      style: "activity-short",
    }),
    ...presentRowValue(transfer, direction.sign, options.regionId),
  };
}

function presentRowValue(
  transfer: ActivityTransfer,
  sign: string,
  regionId?: RegionId,
): Pick<ActivityRowViewModel, "value" | "valueContext" | "priced"> {
  const { amount, symbol } = formatActivityAmountParts(transfer, regionId);
  const quantity = joinAmountAndSymbol(`${sign}${amount}`, symbol);
  if (transfer.valuation.status !== "priced") {
    return { value: quantity, valueContext: null, priced: false };
  }
  return {
    value: `${sign}${formatValuationAmount(transfer.valuation, regionId)}`,
    valueContext: quantity,
    priced: true,
  };
}

export function formatValuationAmount(
  valuation: ActivityPricedValuation,
  regionId?: RegionId,
): string {
  return formatFiatAmount(
    BigInt(valuation.amount.atoms),
    valuation.amount.scale,
    valuation.currency,
    { fractionDigits: 2, markTiny: true, regionId },
  );
}

export function presentActivityTransferDetails(
  transfer: ActivityTransfer,
  options: ActivityPresenterOptions,
): TransactionDetails {
  const direction = directionPresentation[transfer.direction];
  const fullDate = formatPresentationDate(transfer.blockTimestamp, {
    regionId: options.regionId,
    timeZone: options.timeZone,
    style: "activity-full",
  });
  const rows: TransactionDetailRow[] = [
    {
      label: "Value",
      value: transfer.valuation.status === "priced"
        ? `${direction.sign}${formatValuationAmount(transfer.valuation, options.regionId)}`
        : "Unknown",
    },
    {
      label: "From",
      value: transfer.fromAddress,
      display: formatAddress(transfer.fromAddress),
    },
    ...(transfer.direction === "incoming" ? [] : [{
      label: "To",
      value: transfer.toAddress,
      display: formatAddress(transfer.toAddress),
    }]),
    {
      label: "Token contract",
      value: transfer.tokenAddress,
      display: formatAddress(transfer.tokenAddress),
    },
    baseNetworkRow(),
    { label: "Date", value: fullDate },
    {
      label: "Transaction",
      value: transfer.transactionHash,
      display: condensedTransactionHash(transfer.transactionHash),
    },
  ];

  const { amount, symbol } = formatActivityAmountParts(transfer, options.regionId);
  return {
    title: `${direction.label} ${transfer.tokenSymbol ?? "unknown token"}`,
    header: {
      amount: `${direction.sign}${amount}`,
      unit: symbol,
      tone: transfer.direction === "incoming" ? "success" : "default",
      status: { label: "Confirmed", tone: "success" },
    },
    rows,
    explorer: transactionExplorerLink(transfer.transactionHash),
  };
}

function formatActivityAmountParts(
  transfer: ActivityTransfer,
  regionId?: RegionId,
): { amount: string; symbol: string } {
  if (transfer.tokenSymbol === null || transfer.tokenDecimals === null) {
    return { amount: transfer.amountBaseUnits, symbol: "base units" };
  }
  return formatPresentationTokenAmountParts(
    BigInt(transfer.amountBaseUnits),
    transfer.tokenDecimals,
    transfer.tokenSymbol,
    {
      cashCurrency: transfer.assetId === "usdc" ? "USD" : null,
      regionId,
    },
  );
}
