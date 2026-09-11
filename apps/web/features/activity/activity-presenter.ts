import { formatPresentationTokenAmount } from "@/features/formatting";
import type {
  ActivityAsset,
  ActivityDirection,
  ActivityTransfer,
} from "./types";

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
  explorer: {
    href: string;
    label: string;
    title: string;
  };
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
  asset: ActivityAsset | undefined,
  options: ActivityPresenterOptions,
): ActivityRowViewModel {
  if (!asset || asset.id !== transfer.assetId) {
    throw new TypeError("Activity transfer asset metadata is unavailable.");
  }

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
    value: `${direction.sign}${formatPresentationTokenAmount(
      transfer.amountBaseUnits,
      asset.decimals,
      asset.symbol,
      { cashCurrency: asset.symbol === "USDC" ? "USD" : null },
    )}`,
    explorer: {
      href: `https://basescan.org/tx/${transfer.transactionHash}`,
      label: `View ${direction.label.toLowerCase()} ${asset.symbol} transfer on BaseScan`,
      title: "View on BaseScan",
    },
  };
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
