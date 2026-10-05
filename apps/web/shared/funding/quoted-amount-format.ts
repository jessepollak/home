import { approvedCashCurrencies, currencyRecordById } from "@/shared/currencies/registry";
import { formatExactPresentationCashAmount, formatExactPresentationTokenAmount, formatFiatAmount, formatPresentationTokenAmount, presentationCurrencyMetadata } from "@/shared/formatting";
import type { FiatPresentation } from "@/shared/formatting/money";
import type { FundingBinding } from "./contracts/providers";

const cashCurrenciesBySymbol = new Map(approvedCashCurrencies().map((record) => [record.symbol, record.displayCurrency]));
let isoCurrencies: ReadonlySet<string> | null = null;

function isIsoCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (typeof Intl.supportedValuesOf !== "function") return false;
  isoCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
  return isoCurrencies.has(code);
}

export function formatOnrampReceive(amountAtomic: string, asset: Pick<FundingBinding, "assetId" | "assetDecimals" | "assetSymbol">): string {
  const record = currencyRecordById(asset.assetId);
  if (record?.lifecycle === "active" && record.cash.state === "approved") {
    return formatExactPresentationCashAmount(amountAtomic, asset.assetDecimals, record.displayCurrency,
      presentationCurrencyMetadata(record.displayCurrency).defaultRegionId);
  }
  return formatExactPresentationTokenAmount(amountAtomic, asset.assetDecimals, asset.assetSymbol, { useNoBreakSpace: true });
}

export function formatOnrampFee(amount: string, currency: string): string {
  const cashCurrency = cashCurrenciesBySymbol.get(currency);
  if (!cashCurrency) return formatQuotedAmount(amount, currency, { currencyNative: true });
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(amount);
  if (!match) return "—";
  const fractionDigits = Math.max(2, match[2]?.length ?? 0);
  if (fractionDigits > 20) return "—";
  return formatFiatAmount(amount, cashCurrency, { currencyNative: true, fractionDigits, minimumFractionDigits: 2 });
}

export function formatQuotedAmount(amount: string, currency: string, presentation: FiatPresentation): string {
  if (isIsoCurrency(currency)) return formatFiatAmount(amount, currency, presentation);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(amount);
  if (!match) return "—";
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return formatPresentationTokenAmount(`${match[1]}${fraction}`.replace(/^0+(?=\d)/, ""), fraction.length, currency, { regionId: presentation.regionId });
}
