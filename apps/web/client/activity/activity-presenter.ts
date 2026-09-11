import { formatAddress, formatPresentationTokenAmount } from "@/shared/formatting";
import { formatBaseUnitAmount } from "@/client/portfolio/format";
import {
  condensedTransactionHash,
  transactionExplorerLink,
  type TransactionDetailRow,
  type TransactionDetails,
} from "@/components/transaction-explorer";
import type { ActivityDirection, ActivityTransfer } from "./types";

export type ActivityIconKey = "incoming" | "outgoing" | "self";

export type ActivityRowViewModel = {
  id: string;
  directionLabel: string;
  iconKey: ActivityIconKey;
  iconTone: ActivityDirection;
  sign: "+" | "−" | "";
  dateTime: string;
  fullDate: string;
  shortDate: string;
  value: string;
};

export type ActivityPresenterOptions = {
  timeZone: string;
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
  const fullDate = formatActivityDate(transfer.blockTimestamp, options.timeZone);

  return {
    id: transfer.id,
    directionLabel: direction.label,
    iconKey: direction.iconKey,
    iconTone: transfer.direction,
    sign: direction.sign,
    dateTime: transfer.blockTimestamp,
    fullDate,
    shortDate: formatActivityDateShort(
      transfer.blockTimestamp,
      options.timeZone,
    ),
    value: `${direction.sign}${formatActivityAmount(transfer, true)}`,
  };
}

export function presentActivityTransferDetails(
  transfer: ActivityTransfer,
  options: ActivityPresenterOptions,
): TransactionDetails {
  const direction = directionPresentation[transfer.direction];
  const fullDate = formatActivityDate(transfer.blockTimestamp, options.timeZone);
  const rows: TransactionDetailRow[] = [
    {
      label: "Amount",
      value: `${direction.sign}${formatActivityAmount(transfer, false)}`,
    },
    {
      label: "From",
      value: formatAddress(transfer.fromAddress),
      title: transfer.fromAddress,
    },
    {
      label: "To",
      value: formatAddress(transfer.toAddress),
      title: transfer.toAddress,
    },
    { label: "Token contract", value: formatAddress(transfer.tokenAddress), title: transfer.tokenAddress },
    { label: "Network", value: "Base (8453)" },
    { label: "Status", value: "Confirmed" },
    { label: "Date", value: fullDate },
    {
      label: "Transaction",
      value: condensedTransactionHash(transfer.transactionHash),
      title: transfer.transactionHash,
    },
    { label: "Block", value: transfer.blockNumber },
  ];

  return {
    title: `${direction.label} ${transfer.tokenSymbol ?? "unknown token"}`,
    rows,
    explorer: transactionExplorerLink(transfer.transactionHash),
  };
}

function formatActivityAmount(
  transfer: ActivityTransfer,
  presentation: boolean,
): string {
  if (transfer.tokenSymbol === null || transfer.tokenDecimals === null) {
    return `${transfer.amountBaseUnits} base units${presentation ? "" : " · unknown token"}`;
  }
  if (!presentation) {
    return `${formatBaseUnitAmount(
      transfer.amountBaseUnits,
      transfer.tokenDecimals,
    )} ${transfer.tokenSymbol}`;
  }
  return formatPresentationTokenAmount(
    transfer.amountBaseUnits,
    transfer.tokenDecimals,
    transfer.tokenSymbol,
    { cashCurrency: transfer.assetId === "usdc" ? "USD" : null },
  );
}

function formatActivityDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatActivityDateShort(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
