import { formatPercentage } from "@/shared/formatting";
import { BASE_USDC_DECIMALS } from "@/shared/savings/config";

const canonicalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;

export function formatUsdcUsd(amountBaseUnits: string): string {
  if (!canonicalIntegerPattern.test(amountBaseUnits)) return "—";
  const padded = amountBaseUnits.padStart(BASE_USDC_DECIMALS + 1, "0");
  const whole = padded.slice(0, -BASE_USDC_DECIMALS) || "0";
  const fraction = padded.slice(-BASE_USDC_DECIMALS).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!fraction) return `$${grouped}.00`;
  if (fraction.length <= 2) return `$${grouped}.${fraction.padEnd(2, "0")}`;
  return `$${grouped}.${fraction}`;
}

export function formatApy(value: number | null | undefined): string {
  const formatted = formatPercentage(value);
  return formatted === "Unavailable" ? "—" : formatted;
}

export function shortVaultLabel(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function parseUsdcAmount(value: string): string {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value.trim().replace(/\.$/, ""));
  if (!match) {
    throw new Error("Enter a positive USDC amount using decimal digits only.");
  }
  const fraction = match[2] ?? "";
  if (fraction.length > BASE_USDC_DECIMALS) {
    throw new Error("USDC supports at most 6 decimal places.");
  }
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const raw = BigInt(`${whole}${fraction.padEnd(BASE_USDC_DECIMALS, "0")}`);
  if (raw <= BigInt(0)) {
    throw new Error("Enter a positive USDC amount.");
  }
  return raw.toString(10);
}

export function readUsdcBaseUnits(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || !canonicalIntegerPattern.test(value)) {
    return null;
  }
  return BigInt(value);
}
