import {
  formatFiatAmount,
  formatPresentationDate,
  formatPresentationTokenAmount,
} from "@/shared/formatting";
import type { RegionId } from "@/config/regions";
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
  const quantity = `${sign}${formatActivityAmount(transfer, regionId)}`;
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

function formatActivityAmount(
  transfer: ActivityTransfer,
  regionId?: RegionId,
): string {
  if (transfer.tokenSymbol === null || transfer.tokenDecimals === null) {
    return `${transfer.amountBaseUnits} base units`;
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
