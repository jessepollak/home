import type { FiatCurrencyCode } from "@/config/regions";
import {
  canonicalUsdcAsset,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import {
  baseUnitsToFraction,
  exactDecimalToFraction,
  multiplyFractions,
  roundFractionPreservingPositive,
} from "@/shared/balances/math";
import type { ExactDecimal } from "@/shared/balances/types";

export const ACTIVITY_VALUATION_MAX_CLOSE_GAP_SECONDS = 86_400;
export const ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES = 15;
export const ACTIVITY_VALUATION_BAR_SECONDS =
  ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES * 60;
export const ACTIVITY_VALUATION_AMOUNT_SCALE = 18;

export const activityValuationCurrencies = [
  "ARS",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CLP",
  "COP",
  "EUR",
  "GBP",
  "IDR",
  "MXN",
  "MYR",
  "NGN",
  "NZD",
  "PEN",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
] as const satisfies readonly FiatCurrencyCode[];

export const activityValuationUnpricedReasons = [
  "unknown-token",
  "no-recent-close",
  "quote-unavailable",
  "fx-unavailable",
] as const;

export type ActivityValuationUnpricedReason =
  (typeof activityValuationUnpricedReasons)[number];

export type ActivityValuationClose = {
  provider: "Codex";
  closedAt: string;
  resolutionMinutes: typeof ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES;
  priceUsd: ExactDecimal;
};

export type ActivityValuationFx = {
  provider: "Coinbase";
  base: FiatCurrencyCode;
  quote: FiatCurrencyCode;
  date: string;
  rate: ExactDecimal;
  provisional: boolean;
};

export type ActivityPricedValuation = {
  status: "priced";
  currency: FiatCurrencyCode;
  amount: ExactDecimal;
  method: "peg" | "historical-close";
  peg: FiatCurrencyCode | null;
  close: ActivityValuationClose | null;
  fx: ActivityValuationFx | null;
};

export type ActivityUnpricedValuation = {
  status: "unpriced";
  currency: FiatCurrencyCode;
  reason: ActivityValuationUnpricedReason;
};

export type ActivityTransferValuation =
  | ActivityPricedValuation
  | ActivityUnpricedValuation;

const pegCurrencyByContract = new Map<string, FiatCurrencyCode>([
  [canonicalUsdcAsset.contractAddress.toLowerCase(), canonicalUsdcAsset.cashCurrency],
  ...Object.values(verifiedLocalCashAssets).map(
    (asset) => [asset.contractAddress.toLowerCase(), asset.cashCurrency] as const,
  ),
]);

export function activityPegCurrency(tokenAddress: string): FiatCurrencyCode | null {
  return pegCurrencyByContract.get(tokenAddress.toLowerCase()) ?? null;
}

export function isActivityValuationCurrency(value: unknown): value is FiatCurrencyCode {
  return (
    typeof value === "string" &&
    (activityValuationCurrencies as readonly string[]).includes(value)
  );
}

export function activityValuationDate(blockTimestamp: string): string {
  return new Date(blockTimestamp).toISOString().slice(0, 10);
}

export function computeActivityValuationAmount(input: {
  amountBaseUnits: string;
  tokenDecimals: number;
  unitPrice: ExactDecimal | null;
  fxRate: ExactDecimal | null;
}): ExactDecimal {
  const factors = [baseUnitsToFraction(input.amountBaseUnits, input.tokenDecimals)];
  if (input.unitPrice) factors.push(exactDecimalToFraction(input.unitPrice));
  if (input.fxRate) factors.push(exactDecimalToFraction(input.fxRate));
  return roundFractionPreservingPositive(
    multiplyFractions(...factors),
    ACTIVITY_VALUATION_AMOUNT_SCALE,
  );
}

export function unpricedActivityValuation(
  currency: FiatCurrencyCode,
  reason: ActivityValuationUnpricedReason,
): ActivityUnpricedValuation {
  return { status: "unpriced", currency, reason };
}

export function parseActivityTransferValuation(
  value: unknown,
  transfer: {
    tokenAddress: string;
    tokenDecimals: number | null;
    amountBaseUnits: string;
    blockTimestamp: string;
  },
  expectedCurrency: FiatCurrencyCode,
): ActivityTransferValuation {
  const fallback = unpricedActivityValuation(expectedCurrency, "quote-unavailable");
  if (!isRecord(value) || value.currency !== expectedCurrency) return fallback;

  if (value.status === "unpriced") {
    return typeof value.reason === "string" &&
      (activityValuationUnpricedReasons as readonly string[]).includes(value.reason)
      ? unpricedActivityValuation(
          expectedCurrency,
          value.reason as ActivityValuationUnpricedReason,
        )
      : fallback;
  }
  if (value.status !== "priced" || transfer.tokenDecimals === null) return fallback;

  const amount = readExactDecimal(value.amount);
  const fx = value.fx === null ? null : readFx(value.fx);
  if (!amount || fx === undefined) return fallback;
  if (fx && fx.date !== activityValuationDate(transfer.blockTimestamp)) return fallback;

  const pegCurrency = activityPegCurrency(transfer.tokenAddress);
  let unitPrice: ExactDecimal | null;
  let close: ActivityValuationClose | null = null;
  let peg: FiatCurrencyCode | null = null;
  if (value.method === "peg") {
    if (
      pegCurrency === null ||
      value.peg !== pegCurrency ||
      value.close !== null ||
      !fxMatches(fx, pegCurrency, expectedCurrency)
    ) {
      return fallback;
    }
    peg = pegCurrency;
    unitPrice = null;
  } else if (value.method === "historical-close") {
    const parsedClose = readClose(value.close, transfer.blockTimestamp);
    if (
      pegCurrency !== null ||
      value.peg !== null ||
      !parsedClose ||
      !fxMatches(fx, "USD", expectedCurrency)
    ) {
      return fallback;
    }
    close = parsedClose;
    unitPrice = parsedClose.priceUsd;
  } else {
    return fallback;
  }

  const expectedAmount = computeActivityValuationAmount({
    amountBaseUnits: transfer.amountBaseUnits,
    tokenDecimals: transfer.tokenDecimals,
    unitPrice,
    fxRate: fx?.rate ?? null,
  });
  if (expectedAmount.atoms !== amount.atoms || expectedAmount.scale !== amount.scale) {
    return fallback;
  }

  return {
    status: "priced",
    currency: expectedCurrency,
    amount,
    method: value.method,
    peg,
    close,
    fx,
  };
}

function fxMatches(
  fx: ActivityValuationFx | null,
  base: FiatCurrencyCode,
  quote: FiatCurrencyCode,
): boolean {
  if (base === quote) return fx === null;
  return fx !== null && fx.base === base && fx.quote === quote;
}

function readClose(
  value: unknown,
  blockTimestamp: string,
): ActivityValuationClose | null {
  if (
    !isRecord(value) ||
    value.provider !== "Codex" ||
    value.resolutionMinutes !== ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES ||
    typeof value.closedAt !== "string"
  ) {
    return null;
  }
  const closedAt = new Date(value.closedAt);
  const priceUsd = readExactDecimal(value.priceUsd);
  if (
    !Number.isFinite(closedAt.getTime()) ||
    closedAt.toISOString() !== value.closedAt ||
    !priceUsd ||
    priceUsd.atoms === "0"
  ) {
    return null;
  }
  const gapMs = new Date(blockTimestamp).getTime() - closedAt.getTime();
  if (gapMs < 0 || gapMs > ACTIVITY_VALUATION_MAX_CLOSE_GAP_SECONDS * 1_000) {
    return null;
  }
  return {
    provider: "Codex",
    closedAt: value.closedAt,
    resolutionMinutes: ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES,
    priceUsd,
  };
}

function readFx(value: unknown): ActivityValuationFx | null | undefined {
  if (
    !isRecord(value) ||
    value.provider !== "Coinbase" ||
    !isActivityValuationCurrency(value.base) ||
    !isActivityValuationCurrency(value.quote) ||
    value.base === value.quote ||
    typeof value.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    typeof value.provisional !== "boolean"
  ) {
    return undefined;
  }
  const rate = readExactDecimal(value.rate);
  if (!rate || rate.atoms === "0") return undefined;
  return {
    provider: "Coinbase",
    base: value.base,
    quote: value.quote,
    date: value.date,
    rate,
    provisional: value.provisional,
  };
}

function readExactDecimal(value: unknown): ExactDecimal | null {
  if (
    !isRecord(value) ||
    typeof value.atoms !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value.atoms) ||
    value.atoms.length > 200 ||
    !Number.isSafeInteger(value.scale) ||
    (value.scale as number) < 0 ||
    (value.scale as number) > 100
  ) {
    return null;
  }
  return { atoms: value.atoms, scale: value.scale as number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
