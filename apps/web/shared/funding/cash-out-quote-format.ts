import { formatFiatAmount, formatPresentationTokenAmount } from "@/shared/formatting";
import type { CashoutFee, CashoutQuote } from "./cash-out-quote";

let isoCurrencies: ReadonlySet<string> | null = null;

function isIsoCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (typeof Intl.supportedValuesOf !== "function") return false;
  isoCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
  return isoCurrencies.has(code);
}

function formatCashoutAmount(amount: string, currency: string): string {
  if (isIsoCurrency(currency)) return formatFiatAmount(amount, currency);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(amount);
  if (!match) return "—";
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return formatPresentationTokenAmount(`${match[1]}${fraction}`.replace(/^0+(?=\d)/, ""), fraction.length, currency);
}

export function formatCashoutReceive(receive: CashoutQuote["receive"], platformLabel: string): string {
  return `${receive.approximate ? "≈ " : ""}${formatCashoutAmount(receive.amount, receive.currency)} to ${platformLabel}`;
}

export function formatCashoutFee(fee: CashoutFee | null): string {
  if (fee === null) return "Not quoted";
  if (/^0(?:\.0+)?$/.test(fee.amount)) return "None";
  return formatCashoutAmount(fee.amount, fee.currency);
}

export function formatCashoutRate(rate: CashoutQuote["rate"]): string | null {
  if (rate === null) return null;
  const [whole, fraction = ""] = rate.value.split(".");
  const rounded = BigInt(whole) * BigInt(10000) + BigInt((fraction + "0000").slice(0, 4)) +
    (Number(fraction[4] ?? "0") >= 5 ? BigInt(1) : BigInt(0));
  const remainder = rounded % BigInt(10000);
  const value = `${rounded / BigInt(10000)}${remainder === BigInt(0) ? "" : `.${String(remainder).padStart(4, "0").replace(/0+$/, "")}`}`;
  return `1 ${rate.from} = ${rounded === BigInt(0) ? "<0.0001" : value} ${rate.to}`;
}
