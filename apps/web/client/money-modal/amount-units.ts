import { presentationRegions, type RegionId } from "@/config/regions";
import type { ExactDecimal } from "@/shared/balances/types";
import { presentationCurrencyMetadata } from "@/shared/formatting";

const integerPattern = /^(?:0|[1-9]\d*)$/;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const prefixSymbols = new Set(["$", "£", "€", "₺", "₦"]);

export type MoneyAssetPrice = { currency: string; perUnit: ExactDecimal };
export type MoneyAmountUnit =
  | { kind: "fiat"; currency: string }
  | { kind: "convertible"; currency: string; perUnit: ExactDecimal }
  | { kind: "native" };
export type MoneyChipSet = "none" | "max" | "quick-local";

export function moneyAmountUnit(
  assetCashCurrency: string | null | undefined,
  displayCurrency: string | null | undefined,
  price?: MoneyAssetPrice | null,
): MoneyAmountUnit {
  const cash = assetCashCurrency?.trim().toUpperCase();
  const display = displayCurrency?.trim().toUpperCase();
  if (cash && display && cash === display) return { kind: "fiat", currency: display };
  const atoms = price?.perUnit?.atoms;
  const scale = price?.perUnit?.scale;
  if (!display || typeof price?.currency !== "string" || price.currency.trim().toUpperCase() !== display ||
    typeof atoms !== "string" || !/^\d+$/.test(atoms) ||
    typeof scale !== "number" || !Number.isSafeInteger(scale) || scale < 0 || BigInt(atoms) <= BigInt(0)) return { kind: "native" };
  let normalized = BigInt(atoms).toString();
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalized.endsWith("0")) {
    normalized = normalized.slice(0, -1);
    normalizedScale--;
  }
  return { kind: "convertible", currency: display, perUnit: { atoms: normalized, scale: normalizedScale } };
}

function decimalParts(value: string): { atoms: bigint; scale: number } {
  const [whole, fraction = ""] = value.split(".");
  return { atoms: BigInt(`${whole}${fraction}` || "0"), scale: fraction.length };
}

function decimalFromScaledAtoms(atoms: bigint, scale: number): string {
  const digits = atoms.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -scale)}.${fraction}` : digits.slice(0, -scale);
}

export function fiatToNative(fiat: string, perUnit: ExactDecimal, maxDecimals: number): string {
  if (fiat === "") return "";
  const { atoms, scale } = decimalParts(fiat);
  const nativeAtoms = atoms * BigInt(10) ** BigInt(perUnit.scale + maxDecimals) /
    (BigInt(perUnit.atoms) * BigInt(10) ** BigInt(scale));
  return decimalFromScaledAtoms(nativeAtoms, maxDecimals);
}

export function nativeToFiat(native: string, perUnit: ExactDecimal): string {
  if (native === "") return "";
  const { atoms, scale } = decimalParts(native);
  const cents = atoms * BigInt(perUnit.atoms) * BigInt(100) / BigInt(10) ** BigInt(scale + perUnit.scale);
  return `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function displayCurrencyForRegion(regionId: RegionId): string {
  return presentationRegions[regionId].currency.code ?? "USD";
}

export function formatChipLabel(units: 10 | 25, currency: string): string {
  const symbol = presentationCurrencyMetadata(currency).symbol;
  return prefixSymbols.has(symbol) ? `${symbol}${units}` : `${symbol} ${units}`;
}

export function formatPrimaryAmount(
  amount: string,
  unit: MoneyAmountUnit,
  nativeSymbol?: string,
): string {
  const figure = amount || "0"; // oxlint-disable-line home/no-amount-fallback -- a blank editable amount field intentionally presents its zero entry state
  if (unit.kind === "fiat" || unit.kind === "convertible") return formatLocalDisplay(figure, unit.currency);
  return nativeSymbol ? `${figure} ${nativeSymbol}` : figure;
}

export function formatPrimaryAmountUnit(
  unit: MoneyAmountUnit,
  nativeSymbol?: string,
): string | undefined {
  return unit.kind === "fiat" || unit.kind === "convertible" ? presentationCurrencyMetadata(unit.currency).name : nativeSymbol || undefined;
}

export function formatAvailableLine(
  availableLabel: string | undefined,
  unit: MoneyAmountUnit,
  nativeSymbol: string,
): string | undefined {
  if (!availableLabel) return undefined;
  const parsed = parseAvailableDecimal(availableLabel);
  if (!parsed) return availableLabel;
  return formatAvailableDecimal(parsed, unit, nativeSymbol) ?? availableLabel;
}

export function formatAvailableDecimal(
  decimal: string,
  unit: MoneyAmountUnit,
  nativeSymbol: string,
): string | undefined {
  if (!decimalPattern.test(decimal)) return undefined;
  if (unit.kind !== "fiat") return `${groupDecimal(decimal)} ${nativeSymbol} available`;
  return `${formatLocalDisplay(groupDecimal(decimal), unit.currency)} available`;
}

export function parseAvailableDecimal(label: string): string | null {
  const trimmed = label.trim().replace(/\s+available$/i, "");
  if (!trimmed || trimmed === "—" || trimmed === "Unavailable") return null;
  if (trimmed.startsWith("<")) return null;
  const match = /((?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*|0)(?:\.\d+)?)/.exec(trimmed);
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

export function amountExceedsCeiling(amount: string, ceiling: string | null | undefined): boolean {
  const normalized = amount.replace(/\.$/, "");
  if (!ceiling || !decimalPattern.test(ceiling) || !isAvailablePositive(normalized)) return false;
  return compareDecimal(normalized, ceiling) > 0;
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

function formatLocalDisplay(amount: string, currency: string): string {
  const symbol = presentationCurrencyMetadata(currency).symbol;
  return prefixSymbols.has(symbol) ? `${symbol}${amount}` : `${symbol} ${amount}`;
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
