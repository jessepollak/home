import { presentationRegions, type RegionId } from "@/config/regions";
import { presentationCurrencySymbol } from "@/client/portfolio";

const integerPattern = /^(?:0|[1-9]\d*)$/;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const usdStableSymbols = new Set(["DAI", "USDBC", "USDC", "USDT"]);
const prefixSymbols = new Set(["$", "£", "€", "₺", "₦"]);

export type MoneyPrimaryUnit = "local" | "native";
export type MoneyChipSet = "none" | "max" | "quick-local";

export type ExactScaleFactor = {
  atoms: string;
  scale: number;
};

export type MoneyAssetPricing =
  | { status: "unpriced" }
  | {
      status: "priced";
      localCurrency: string;
      nativePerLocal: ExactScaleFactor;
    };

const identityFactor: ExactScaleFactor = { atoms: "1", scale: 0 };

export function isUsdStableSymbol(symbol: string): boolean {
  return usdStableSymbols.has(symbol.trim().toUpperCase());
}

export function isIdentityPricing(pricing: MoneyAssetPricing): boolean {
  return (
    pricing.status === "priced" &&
    pricing.nativePerLocal.atoms === "1" &&
    pricing.nativePerLocal.scale === 0
  );
}

/**
 * USD stables are priced 1:1 against USD. Other assets stay unpriced until a
 * real quote is passed in — do not invent a peg. Non-USD regions need FX that
 * amount-entry does not currently receive (Invest quote is scoped to Invest).
 */
export function moneyAssetPricing(
  assetSymbol: string,
  regionId: RegionId = "GLOBAL",
): MoneyAssetPricing {
  if (!isUsdStableSymbol(assetSymbol)) return { status: "unpriced" };
  const regionCurrency = presentationRegions[regionId].currency.code;
  if (regionCurrency && regionCurrency !== "USD") return { status: "unpriced" };
  return {
    status: "priced",
    localCurrency: "USD",
    nativePerLocal: identityFactor,
  };
}

export function resolvePrimaryUnit(
  pricing: MoneyAssetPricing,
  requested: MoneyPrimaryUnit,
): MoneyPrimaryUnit {
  return pricing.status === "priced" ? requested : "native";
}

export function formatChipLabel(units: 10 | 25, currency: string): string {
  const symbol = presentationCurrencySymbol(currency);
  return prefixSymbols.has(symbol) ? `${symbol}${units}` : `${symbol} ${units}`;
}

export function formatPrimaryAmount(
  amount: string,
  unit: MoneyPrimaryUnit,
  pricing: MoneyAssetPricing,
): string {
  const figure = amount || "0";
  if (unit === "native" || pricing.status === "unpriced") return figure;
  const symbol = presentationCurrencySymbol(pricing.localCurrency);
  return prefixSymbols.has(symbol) ? `${symbol}${figure}` : `${figure} ${symbol}`;
}

export function formatSecondaryAmount(
  nativeAmount: string,
  unit: MoneyPrimaryUnit,
  pricing: MoneyAssetPricing,
  nativeSymbol: string,
): string {
  const normalized = normalizeDecimal(nativeAmount);
  const display = padFraction(normalized, 2);
  if (unit === "local") {
    return `${display} ${nativeSymbol}`;
  }
  if (pricing.status === "unpriced") return `${display} ${nativeSymbol}`;
  return formatLocalDisplay(display, pricing.localCurrency);
}

export function formatAvailableLine(
  availableLabel: string | undefined,
  unit: MoneyPrimaryUnit,
  pricing: MoneyAssetPricing,
  nativeSymbol: string,
): string | undefined {
  if (!availableLabel) return undefined;
  const parsed = parseAvailableDecimal(availableLabel);
  if (!parsed) return availableLabel;
  if (unit === "native") {
    return `${groupDecimal(parsed)} ${nativeSymbol} available`;
  }
  if (pricing.status === "unpriced") return availableLabel;
  return `${formatLocalDisplay(groupDecimal(parsed), pricing.localCurrency)} available`;
}

export function parseAvailableDecimal(label: string): string | null {
  const trimmed = label.trim().replace(/\s+available$/i, "");
  if (!trimmed || trimmed === "—" || trimmed === "Unavailable") return null;
  if (trimmed.startsWith("<")) return null;
  const match = /((?:0|[1-9]\d{0,2}(?:,\d{3})*)(?:\.\d+)?)/.exec(trimmed);
  if (!match) return null;
  const decimal = match[1].replace(/,/g, "");
  return decimalPattern.test(decimal) ? decimal : null;
}

export function isAvailablePositive(amount: string | null | undefined): boolean {
  if (!amount || !decimalPattern.test(amount)) return false;
  return compareDecimal(amount, "0") > 0;
}

export function clampDecimal(amount: string, maximum: string | null | undefined): string {
  if (!maximum || !decimalPattern.test(maximum) || !decimalPattern.test(amount)) {
    return amount;
  }
  return compareDecimal(amount, maximum) > 0 ? maximum : amount;
}

export function decimalFromBaseUnits(baseUnits: string, decimals: number): string | null {
  if (!integerPattern.test(baseUnits)) return null;
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) return null;
  if (decimals === 0) return baseUnits;
  const padded = baseUnits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function convertDisplayAmount(
  amount: string,
  from: MoneyPrimaryUnit,
  to: MoneyPrimaryUnit,
  pricing: MoneyAssetPricing,
): string {
  if (from === to) return amount;
  if (pricing.status === "unpriced" || isIdentityPricing(pricing)) return amount;
  const normalized = normalizeDecimal(amount);
  if (!decimalPattern.test(normalized)) return amount;
  return from === "local"
    ? scaleDecimal(normalized, pricing.nativePerLocal)
    : scaleDecimal(normalized, invertScale(pricing.nativePerLocal));
}

function formatLocalDisplay(amount: string, currency: string): string {
  const symbol = presentationCurrencySymbol(currency);
  return prefixSymbols.has(symbol) ? `${symbol}${amount}` : `${symbol} ${amount}`;
}

function normalizeDecimal(amount: string): string {
  const trimmed = amount.trim().replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

function padFraction(amount: string, minFraction: number): string {
  if (!decimalPattern.test(amount)) return amount;
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length >= minFraction) return amount;
  return `${whole}.${fraction.padEnd(minFraction, "0")}`;
}

function groupDecimal(amount: string): string {
  const [whole, fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const b = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  return a < b ? -1 : a > b ? 1 : 0;
}

function scaleDecimal(amount: string, factor: ExactScaleFactor): string {
  if (!integerPattern.test(factor.atoms)) return amount;
  const [whole, fraction = ""] = amount.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const scale = fraction.length + factor.scale;
  const product = (BigInt(digits) * BigInt(factor.atoms)).toString();
  if (scale === 0) return product;
  const padded = product.padStart(scale + 1, "0");
  const nextWhole = padded.slice(0, -scale);
  const nextFraction = padded.slice(-scale).replace(/0+$/, "");
  return nextFraction ? `${nextWhole}.${nextFraction}` : nextWhole;
}

function invertScale(factor: ExactScaleFactor): ExactScaleFactor {
  if (factor.atoms === "0") return factor;
  const places = factor.atoms.length + factor.scale;
  const inverted = (BigInt(10) ** BigInt(places) / BigInt(factor.atoms)).toString();
  return { atoms: inverted, scale: places - factor.scale };
}
