import {
  formatAddress,
  formatExactPresentationTokenAmount,
  formatPresentationDate,
  formatPresentationTokenAmount,
} from "@/shared/formatting";
import type { RegionId } from "@/config/regions";
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
  regionId?: RegionId;
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
  const fullDate = formatPresentationDate(transfer.blockTimestamp, {
    regionId: options.regionId,
    timeZone: options.timeZone,
    style: "activity-full",
  });

  return {
    id: transfer.id,
    directionLabel: direction.label,
    iconKey: direction.iconKey,
    iconTone: transfer.direction,
    sign: direction.sign,
    dateTime: transfer.blockTimestamp,
    fullDate,
    shortDate: formatPresentationDate(transfer.blockTimestamp, {
      regionId: options.regionId,
      timeZone: options.timeZone,
      style: "activity-short",
    }),
    value: `${direction.sign}${formatActivityAmount(
      transfer,
      true,
      options.regionId,
    )}`,
  };
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
      label: "Amount",
      value: `${direction.sign}${formatActivityAmount(
        transfer,
        false,
        options.regionId,
      )}`,
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
  regionId?: RegionId,
): string {
  if (transfer.tokenSymbol === null || transfer.tokenDecimals === null) {
    return `${transfer.amountBaseUnits} base units${presentation ? "" : " · unknown token"}`;
  }
  if (!presentation) {
    return formatExactPresentationTokenAmount(
      transfer.amountBaseUnits,
      transfer.tokenDecimals,
      transfer.tokenSymbol,
      { regionId },
    );
  }
  return formatPresentationTokenAmount(
    BigInt(transfer.amountBaseUnits),
    transfer.tokenDecimals,
    transfer.tokenSymbol,
    {
      cashCurrency: transfer.assetId === "usdc" ? "USD" : null,
      regionId,
    },
  );
}
