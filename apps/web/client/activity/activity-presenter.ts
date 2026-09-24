import {
  formatAddress,
  formatExactPresentationTokenAmount,
  formatFiatAmount,
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
import type {
  ActivityPricedValuation,
  ActivityValuationUnpricedReason,
} from "@/shared/activity/valuation";
import type { ExactDecimal } from "@/shared/balances/types";

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

const unpricedReasonLabels = {
  "unknown-token": "Not priced · token details unavailable",
  "no-recent-close": "Not priced · no market close within 1 hour before transfer",
  "quote-unavailable": "Not priced · market data unavailable",
  "fx-unavailable": "Not priced · exchange rate unavailable",
} as const satisfies Record<ActivityValuationUnpricedReason, string>;

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
  const quantity = `${sign}${formatActivityAmount(transfer, true, regionId)}`;
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
      label: "Amount",
      value: `${direction.sign}${formatActivityAmount(
        transfer,
        false,
        options.regionId,
      )}`,
    },
    ...presentValuationDetails(transfer, direction.sign, options),
    {
      label: "From",
      value: transfer.fromAddress,
      display: formatAddress(transfer.fromAddress),
    },
    {
      label: "To",
      value: transfer.toAddress,
      display: formatAddress(transfer.toAddress),
    },
    {
      label: "Token contract",
      value: transfer.tokenAddress,
      display: formatAddress(transfer.tokenAddress),
    },
    { label: "Network", value: "Base (8453)" },
    { label: "Status", value: "Confirmed" },
    { label: "Date", value: fullDate },
    {
      label: "Transaction",
      value: transfer.transactionHash,
      display: condensedTransactionHash(transfer.transactionHash),
    },
    { label: "Block", value: transfer.blockNumber },
  ];

  return {
    title: `${direction.label} ${transfer.tokenSymbol ?? "unknown token"}`,
    rows,
    explorer: transactionExplorerLink(transfer.transactionHash),
  };
}

function presentValuationDetails(
  transfer: ActivityTransfer,
  sign: string,
  options: ActivityPresenterOptions,
): TransactionDetailRow[] {
  const valuation = transfer.valuation;
  if (valuation.status !== "priced") {
    return [{ label: "Value", value: unpricedReasonLabels[valuation.reason] }];
  }
  const symbol = transfer.tokenSymbol ?? "token";
  const rows: TransactionDetailRow[] = [
    { label: "Value", value: `${sign}${formatValuationAmount(valuation, options.regionId)}` },
  ];
  if (valuation.method === "peg" && valuation.peg) {
    rows.push({
      label: "Valuation",
      value: `Stablecoin peg · 1 ${symbol} = 1 ${valuation.peg}`,
    });
  }
  if (valuation.close) {
    rows.push(
      {
        label: "Valuation",
        value: `Historical close · ${valuation.close.provider} ${valuation.close.resolutionMinutes}-minute USD bar`,
      },
      {
        label: "Quote time",
        value: formatPresentationDate(valuation.close.closedAt, {
          regionId: options.regionId,
          timeZone: options.timeZone,
          style: "activity-full",
        }),
      },
      {
        label: "Unit price",
        value: `${formatFiatAmount(
          BigInt(valuation.close.priceUsd.atoms),
          valuation.close.priceUsd.scale,
          "USD",
          {
            fractionDigits: Math.max(2, Math.min(valuation.close.priceUsd.scale, 10)),
            minimumFractionDigits: 2,
            markTiny: true,
            regionId: options.regionId,
          },
        )} per ${symbol}`,
      },
    );
  }
  if (valuation.fx) {
    rows.push({
      label: "Exchange rate",
      value: `1 ${valuation.fx.base} = ${trimRate(valuation.fx.rate)} ${valuation.fx.quote} · ${valuation.fx.provider} daily rate ${valuation.fx.date} UTC${valuation.fx.provisional ? " (provisional until the UTC day closes)" : ""}`,
    });
  }
  return rows;
}

function exactDecimalString(value: ExactDecimal): string {
  if (value.scale === 0) return value.atoms;
  const padded = value.atoms.padStart(value.scale + 1, "0");
  const whole = padded.slice(0, -value.scale);
  const fraction = padded.slice(-value.scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function trimRate(value: ExactDecimal): string {
  const [whole, fraction = ""] = exactDecimalString(value).split(".");
  const significant = fraction.slice(0, whole === "0" ? 10 : 6).replace(/0+$/, "");
  return significant ? `${whole}.${significant}` : whole!;
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
