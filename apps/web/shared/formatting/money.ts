import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";

const canonicalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const decimalPattern = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;
const signedPercentPattern = /^([+\u2212-])?(\d+(?:\.\d+)?)\s*%$/;
const minimumPriceFractionDigits = 2;
const maximumTinyPriceFractionDigits = 8;
const maximumChartTinyFractionDigits = 12;
const minusSign = "−";

const NBSP = "\u00A0";
const anySpace = /[\s\u00A0\u2007\u2009\u202F]+/g;

/**
 * ICU builds disagree on the whitespace they emit (U+0020 vs U+00A0 vs U+202F)
 * and on joiners such as "at". Home owns these typographic choices so output is
 * byte-identical on every platform.
 */
function collapseSpaces(value: string, replacement: string): string {
  return value.replace(anySpace, replacement).trim();
}

/** Multi-character currency symbols (R$, Rp, US$) take one no-break space; single glyphs ($, €, £) none. */
function joinCurrencyPrefix(symbol: string, amount: string): string {
  const compact = collapseSpaces(symbol, "");
  if (!compact) return amount;
  return compact.length > 1 ? `${compact}${NBSP}${amount}` : `${compact}${amount}`;
}

function joinCurrencySuffix(amount: string, symbol: string): string {
  const compact = collapseSpaces(symbol, "");
  return compact ? `${amount}${NBSP}${compact}` : amount;
}

/** Token symbols keep their internal spacing ("vault shares"); only currency glyphs are compacted. */
function joinAmountAndSymbol(
  amount: string,
  symbol: string,
  useNoBreakSpace = false,
): string {
  const separator = useNoBreakSpace ? NBSP : " ";
  const label = collapseSpaces(symbol, separator);
  if (!label) return amount;
  return `${amount}${separator}${label}`;
}

const regionLocales = {
  GLOBAL: "en-US",
  AR: "es-AR",
  AU: "en-AU",
  AT: "de-AT",
  BE: "nl-BE",
  BR: "pt-BR",
  BG: "bg-BG",
  CA: "en-CA",
  CL: "es-CL",
  CO: "es-CO",
  HR: "hr-HR",
  CY: "el-CY",
  EE: "et-EE",
  FI: "fi-FI",
  FR: "fr-FR",
  DE: "de-DE",
  GR: "el-GR",
  ID: "id-ID",
  IE: "en-IE",
  IT: "it-IT",
  LV: "lv-LV",
  LT: "lt-LT",
  LU: "fr-LU",
  MY: "ms-MY",
  MT: "mt-MT",
  MX: "es-MX",
  NL: "nl-NL",
  NZ: "en-NZ",
  NG: "en-NG",
  PE: "es-PE",
  PT: "pt-PT",
  SG: "en-SG",
  SK: "sk-SK",
  SI: "sl-SI",
  ZA: "en-ZA",
  ES: "es-ES",
  CH: "de-CH",
  TR: "tr-TR",
  GB: "en-GB",
  US: "en-US",
} as const satisfies Record<RegionId, string>;

export const MONEY_CHANGE_COLOR_TOKENS = {
  positive: "var(--home-positive)",
  negative: "var(--home-negative)",
  neutral: "var(--home-muted)",
} as const;

export type MoneyChangeTone = keyof typeof MONEY_CHANGE_COLOR_TOKENS;
export type DecimalInput = number | string;
export type ExactScaleFactor = {
  atoms: string;
  scale: number;
};
export type MoneySignPolicy = "auto" | "always" | "never";
export type AtomicAmount = bigint | string;

export type PresentationMoneyMetadata = {
  regionId: RegionId;
  locale: string;
  currency: FiatCurrencyCode;
  currencyName: string;
  currencySymbol: string;
};

type Decimal = {
  negative: boolean;
  digits: string;
  scale: number;
};

export function presentationMoneyMetadata(
  regionId: RegionId = "GLOBAL",
): PresentationMoneyMetadata {
  const region = presentationRegions[regionId];
  const fallback = presentationRegions.US.currency;
  return {
    regionId,
    locale: regionLocales[regionId],
    currency: region.currency.code ?? fallback.code!,
    currencyName: region.currency.code ? region.currency.name : fallback.name,
    currencySymbol: region.currency.symbol ?? fallback.symbol!,
  };
}

export function presentationLocale(regionId: RegionId = "GLOBAL"): string {
  return presentationMoneyMetadata(regionId).locale;
}

export function presentationCurrencyMetadata(currency: string): {
  code: string;
  name: string;
  symbol: string;
  defaultRegionId: RegionId;
} {
  for (const regionId of Object.keys(presentationRegions) as RegionId[]) {
    const currencyPresentation = presentationRegions[regionId].currency;
    if (currencyPresentation.code === currency) {
      return {
        code: currency,
        name: currencyPresentation.name,
        symbol: currencyPresentation.symbol ?? currency,
        defaultRegionId: regionId,
      };
    }
  }
  return { code: currency, name: currency, symbol: currency, defaultRegionId: "GLOBAL" };
}

export function moneyChangeTone(
  value: string | number | null | undefined,
): MoneyChangeTone {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value === 0) return "neutral";
    return value > 0 ? "positive" : "negative";
  }
  const normalized = value?.trim() ?? "";
  if (normalized.startsWith("+")) return "positive";
  if (normalized.startsWith("-") || normalized.startsWith(minusSign)) {
    return "negative";
  }
  return "neutral";
}

/** Formats integer token base units without converting the amount to Number. */
export function formatTokenAmount(
  balanceBaseUnits: AtomicAmount,
  decimals: number,
  maximumFractionDigits = Math.min(6, decimals),
  regionId: RegionId = "GLOBAL",
): string {
  validateDecimals(decimals);
  if (
    !Number.isSafeInteger(maximumFractionDigits) ||
    maximumFractionDigits < 0 ||
    maximumFractionDigits > decimals
  ) {
    throw new TypeError(
      "maximumFractionDigits must be an integer from 0 through decimals.",
    );
  }

  const parsedBaseUnits = parseAtomicAmount(balanceBaseUnits);
  const negative = parsedBaseUnits < BigInt(0);
  const absolute = negative ? -parsedBaseUnits : parsedBaseUnits;
  if (absolute === BigInt(0)) return "0";

  const digits = absolute.toString(10);
  if (decimals === 0) {
    return applySign(localizeWhole(digits, regionId), negative, "auto");
  }

  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals);
  const visibleFraction = fraction
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, "");

  if (whole === "0" && visibleFraction === "") {
    const threshold = maximumFractionDigits === 0
      ? "1"
      : `0.${"0".repeat(maximumFractionDigits - 1)}1`;
    return applySign(`<${localizeCanonicalDecimal(threshold, regionId)}`, negative, "auto");
  }

  const amount = localizeCanonicalDecimal(
    `${whole}${visibleFraction ? `.${visibleFraction}` : ""}`,
    regionId,
  );
  return applySign(amount, negative, "auto");
}

export type PresentationAssetClass = "major" | "stable" | "meme";

export type PresentationTokenAmountOptions = {
  assetClass?: PresentationAssetClass;
  cashCurrency?: string | null;
  category?: "stock" | "crypto" | "meme";
  regionId?: RegionId;
  useNoBreakSpace?: boolean;
};

type FiatAmountOptions = {
  regionId?: RegionId;
  fractionDigits?: number;
  minimumFractionDigits?: number;
  sign?: MoneySignPolicy;
  markTiny?: boolean;
};

const majorSymbols = new Set([
  "ADA", "BTC", "CBADA", "CBBTC", "CBDOGE", "CBETH", "CBLTC", "CBSOL",
  "CBXRP", "DOGE", "ETH", "LTC", "SOL", "WETH", "XRP", "AAPLC", "GOOGLC",
  "METAC", "NVDAC",
]);
const stableSymbols = new Set(["DAI", "EURC", "IDRX", "USDBC", "USDC", "USDT"]);

export function presentationAssetClass(
  input: PresentationTokenAmountOptions & { symbol?: string } = {},
): PresentationAssetClass {
  if (input.assetClass) return input.assetClass;
  if (input.cashCurrency) return "stable";
  if (input.category === "meme") return "meme";
  if (input.category === "stock" || input.category === "crypto") return "major";
  const symbol = input.symbol?.trim().toUpperCase() ?? "";
  if (stableSymbols.has(symbol)) return "stable";
  if (majorSymbols.has(symbol)) return "major";
  return "meme";
}

export function formatPresentationTokenAmount(
  balanceBaseUnits: AtomicAmount,
  decimals: number,
  symbol: string,
  options: PresentationTokenAmountOptions = {},
): string {
  try {
    const parsedBaseUnits = parseAtomicAmount(balanceBaseUnits);
    const assetClass = presentationAssetClass({ ...options, symbol });
    const { maximumFractionDigits, minimumFractionDigits } =
      presentationFractionDigits(parsedBaseUnits, decimals, assetClass);
    const amount = padLocalizedFractionDigits(
      formatTokenAmount(
        parsedBaseUnits,
        decimals,
        maximumFractionDigits,
        options.regionId,
      ),
      minimumFractionDigits,
      options.regionId,
    );
    return joinAmountAndSymbol(amount, symbol, options.useNoBreakSpace);
  } catch {
    return "—";
  }
}

/** Formats all token precision for review and detail surfaces. */
export function formatExactTokenAmount(
  balanceBaseUnits: AtomicAmount,
  decimals: number,
  regionId: RegionId = "GLOBAL",
): string {
  return formatTokenAmount(balanceBaseUnits, decimals, decimals, regionId);
}

/** Formats unsigned token amounts and rejects malformed or negative input. */
export function formatUnsignedTokenAmount(
  balanceBaseUnits: AtomicAmount,
  decimals: number,
  regionId: RegionId = "GLOBAL",
): string {
  const parsed = parseUnsignedAtomicAmount(balanceBaseUnits);
  return formatExactTokenAmount(parsed, decimals, regionId);
}

export function formatExactPresentationTokenAmount(
  balanceBaseUnits: AtomicAmount,
  decimals: number,
  symbol: string,
  options: { regionId?: RegionId; useNoBreakSpace?: boolean } = {},
): string {
  return joinAmountAndSymbol(
    formatExactTokenAmount(balanceBaseUnits, decimals, options.regionId),
    symbol,
    options.useNoBreakSpace,
  );
}

/** Exact decimal formatting from atomic bigint units. */
export function formatDecimalAmount(
  atoms: bigint,
  decimals: number,
  options: {
    regionId?: RegionId;
    fractionDigits?: number;
    sign?: MoneySignPolicy;
    markTiny?: boolean;
  } = {},
): string {
  const fractionDigits = options.fractionDigits ?? 2;
  const regionId = options.regionId ?? "GLOBAL";
  const result = scaledDecimalResult(
    atoms,
    decimals,
    fractionDigits,
    options.markTiny,
  );
  const amount = `${result.tiny ? "<" : ""}${localizeCanonicalDecimal(
    result.canonical,
    regionId,
  )}`;
  return applySign(amount, result.negative, options.sign);
}

/** Exact fiat formatting from atomic bigint units or an exact decimal string. */
export function formatFiatAmount(
  atoms: bigint,
  decimals: number,
  currency: string,
  options?: FiatAmountOptions,
): string;
export function formatFiatAmount(
  value: string,
  currency: string,
  options?: FiatAmountOptions,
): string;
export function formatFiatAmount(
  value: bigint | string,
  decimalsOrCurrency: number | string,
  currencyOrOptions: string | FiatAmountOptions = {},
  maybeOptions: FiatAmountOptions = {},
): string {
  if (typeof value === "string") {
    const currency = decimalsOrCurrency as string;
    const options = currencyOrOptions as FiatAmountOptions;
    const decimal = parseDecimal(value);
    if (!decimal || decimal.negative) return "—";
    const fractionDigits = options.fractionDigits ?? 2;
    const minimumFractionDigits = options.minimumFractionDigits ?? fractionDigits;
    validateFractionRange(fractionDigits, minimumFractionDigits);
    const regionId = options.regionId ?? defaultRegionForCurrency(currency);
    const result = scaledDecimalResult(
      BigInt(decimal.digits),
      decimal.scale,
      fractionDigits,
      options.markTiny,
    );
    const canonical = trimCanonicalFraction(
      result.canonical,
      minimumFractionDigits,
    );
    return `${result.tiny ? "<" : ""}${formatCurrencyDecimal(
      canonical,
      currency,
      regionId,
    )}`;
  }

  const decimals = decimalsOrCurrency as number;
  const currency = currencyOrOptions as string;
  const options = maybeOptions;
  const fractionDigits = options.fractionDigits ?? 2;
  const minimumFractionDigits = options.minimumFractionDigits ?? fractionDigits;
  validateFractionRange(fractionDigits, minimumFractionDigits);
  const regionId = options.regionId ?? defaultRegionForCurrency(currency);
  const result = scaledDecimalResult(
    value,
    decimals,
    fractionDigits,
    options.markTiny,
  );
  const canonical = trimCanonicalFraction(
    result.canonical,
    minimumFractionDigits,
  );
  const label = `${result.tiny ? "<" : ""}${formatCurrencyDecimal(
    canonical,
    currency,
    regionId,
  )}`;
  return applySign(label, result.negative, options.sign);
}

export function formatUsdStablecoinAmount(
  balanceBaseUnits: AtomicAmount,
  decimals = 6,
  regionId: RegionId = "GLOBAL",
): string {
  try {
    const atoms = parseUnsignedAtomicAmount(balanceBaseUnits);
    return formatFiatAmount(atoms, decimals, "USD", {
      fractionDigits: decimals,
      minimumFractionDigits: Math.min(2, decimals),
      regionId,
    });
  } catch {
    return "—";
  }
}

export function formatPresentationPercentage(
  value: number | null | undefined,
  regionId: RegionId = "GLOBAL",
): string {
  const formatted = formatPercentage(value, regionId);
  return formatted === "Unavailable" ? "—" : formatted;
}

export function formatWadPercent(
  raw: AtomicAmount,
  regionId: RegionId = "GLOBAL",
): string {
  const value = parseUnsignedAtomicAmount(raw) * BigInt(100);
  return `${formatDecimalAmount(value, 18, {
    fractionDigits: 2,
    markTiny: false,
    regionId,
  })}%`;
}

export function formatBasisPoints(
  raw: AtomicAmount,
  regionId: RegionId = "GLOBAL",
): string {
  return `${formatDecimalAmount(parseUnsignedAtomicAmount(raw), 2, {
    fractionDigits: 2,
    markTiny: false,
    regionId,
  })}%`;
}

export function formatHealthFactor(
  raw: AtomicAmount | null,
  regionId: RegionId = "GLOBAL",
): string {
  if (raw === null) return "No debt";
  return formatDecimalAmount(parseUnsignedAtomicAmount(raw), 18, {
    fractionDigits: 2,
    markTiny: false,
    regionId,
  });
}

/** Morpho oracle prices are loan-token units per collateral token at 34 decimals. */
export function formatOracleUsd(
  raw: AtomicAmount,
  regionId: RegionId = "GLOBAL",
): string {
  return formatFiatAmount(parseUnsignedAtomicAmount(raw), 34, "USD", {
    fractionDigits: 2,
    regionId,
  });
}

export function formatUsdPrice(
  value: DecimalInput,
  regionId: RegionId = "GLOBAL",
): string | null {
  return formatPresentationPrice(value, "USD", regionId);
}

export function formatPresentationPrice(
  value: DecimalInput,
  currency = "USD",
  regionId: RegionId = defaultRegionForCurrency(currency),
): string | null {
  const decimal = parseDecimal(value);
  if (!decimal) return null;
  if (decimal.digits === "0") {
    return formatCurrencyDecimal("0.00", currency, regionId);
  }

  const absoluteDecimal = { ...decimal, negative: false };
  if (isLessThan(absoluteDecimal, "0.01")) {
    if (isLessThan(absoluteDecimal, "0.00000001")) {
      const label = `<${formatCurrencyDecimal("0.00000001", currency, regionId)}`;
      return applySign(label, decimal.negative, "auto");
    }
    const fractionDigits = tinyFractionDigits(
      absoluteDecimal,
      maximumTinyPriceFractionDigits,
    );
    const amount = formatDecimal(decimal, fractionDigits, 0);
    return applySign(
      formatCurrencyDecimal(amount, currency, regionId),
      decimal.negative,
      "auto",
    );
  }

  const amount = formatDecimal(
    decimal,
    minimumPriceFractionDigits,
    minimumPriceFractionDigits,
  );
  return applySign(
    formatCurrencyDecimal(amount, currency, regionId),
    decimal.negative,
    "auto",
  );
}

export function formatChartPrice(
  value: DecimalInput,
  options: { regionId?: RegionId; currency?: string } = {},
): string {
  const regionId = options.regionId ?? "GLOBAL";
  const currency = options.currency ?? "USD";
  const decimal = parseDecimal(value);
  if (!decimal) return "—";
  const absolute = { ...decimal, negative: false };

  if (!isLessThan(absolute, "1000")) {
    return formatCompactPrice(decimal, currency, regionId);
  }

  let maximumFractionDigits = 6;
  let minimumFractionDigits = 0;
  if (!isLessThan(absolute, "1")) {
    maximumFractionDigits = 2;
    minimumFractionDigits = 2;
  } else if (isLessThan(absolute, "0.001") && decimal.digits !== "0") {
    maximumFractionDigits = tinyFractionDigits(
      absolute,
      maximumChartTinyFractionDigits,
    );
  }
  const amount = formatDecimal(decimal, maximumFractionDigits, minimumFractionDigits);
  return applySign(
    formatCurrencyDecimal(amount, currency, regionId),
    decimal.negative,
    "auto",
  );
}

export function formatPercentage(
  value: number | null | undefined,
  regionId: RegionId = "GLOBAL",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Unavailable";
  }
  return normalizeMinus(
    new Intl.NumberFormat(presentationLocale(regionId), {
      style: "percent",
      minimumFractionDigits: value === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value),
  );
}

export function formatSignedPercentChange(
  value: string | number | null | undefined,
  regionId: RegionId = "GLOBAL",
): string | null {
  if (value === null || value === undefined) return null;
  let percent: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    percent = value;
  } else {
    const match = signedPercentPattern.exec(value.trim());
    if (!match) return null;
    const absolute = Number(match[2]);
    if (!Number.isFinite(absolute)) return null;
    percent = match[1] === "-" || match[1] === minusSign ? -absolute : absolute;
  }

  const formatted = new Intl.NumberFormat(presentationLocale(regionId), {
    style: "percent",
    signDisplay: "always",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(percent / 100);
  return normalizeMinus(formatted);
}

export type PresentationDateStyle =
  | "activity-full"
  | "activity-short"
  | "date-time-zone"
  | "chart-time"
  | "chart-weekday"
  | "chart-date";

export function formatPresentationDate(
  value: string | number | Date,
  options: {
    regionId?: RegionId;
    timeZone?: string;
    style: PresentationDateStyle;
  },
): string {
  const locale = presentationLocale(options.regionId);
  const zone = options.timeZone ? { timeZone: options.timeZone } : {};
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const part = (formatOptions: Intl.DateTimeFormatOptions) =>
    collapseSpaces(new Intl.DateTimeFormat(locale, { ...formatOptions, ...zone }).format(date), " ");
  const dateParts: Record<PresentationDateStyle, Intl.DateTimeFormatOptions | null> = {
    "activity-full": { month: "short", day: "numeric", year: "numeric" },
    "activity-short": { month: "short", day: "numeric" },
    "date-time-zone": { month: "short", day: "numeric", year: "numeric" },
    "chart-time": null,
    "chart-weekday": { weekday: "short" },
    "chart-date": { month: "short", day: "numeric" },
  };
  const timeParts: Record<PresentationDateStyle, Intl.DateTimeFormatOptions | null> = {
    "activity-full": { hour: "numeric", minute: "2-digit" },
    "activity-short": { hour: "numeric", minute: "2-digit" },
    "date-time-zone": { hour: "numeric", minute: "2-digit", timeZoneName: "short" },
    "chart-time": { hour: "numeric", minute: "2-digit" },
    "chart-weekday": null,
    "chart-date": null,
  };
  const dateOptions = dateParts[options.style];
  const timeOptions = timeParts[options.style];
  const pieces = [dateOptions ? part(dateOptions) : null, timeOptions ? part(timeOptions) : null]
    .filter((piece): piece is string => Boolean(piece));
  return pieces.join(", ");
}

export function scaleDecimalByExact(
  value: DecimalInput,
  factor: ExactScaleFactor,
): string | null {
  const decimal = parseDecimal(value);
  if (!decimal) return null;
  if (!canonicalIntegerPattern.test(factor.atoms)) return null;
  if (
    !Number.isSafeInteger(factor.scale) ||
    factor.scale < 0 ||
    factor.scale > 10_000
  ) {
    return null;
  }
  if (decimal.digits === "0" || factor.atoms === "0") return "0";

  const digits = (BigInt(decimal.digits) * BigInt(factor.atoms)).toString();
  const scale = decimal.scale + factor.scale;
  const padded = digits.padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : padded.slice(0, -scale);
  const fraction = scale === 0 ? "" : padded.slice(-scale).replace(/0+$/, "");
  const amount = fraction ? `${whole}.${fraction}` : whole;
  return decimal.negative ? `-${amount}` : amount;
}

function defaultRegionForCurrency(currency: string): RegionId {
  return presentationCurrencyMetadata(currency).defaultRegionId;
}

function parseAtomicAmount(value: AtomicAmount): bigint {
  if (typeof value === "bigint") return value;
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError("amount must be a canonical decimal integer.");
  }
  return BigInt(value);
}

function parseUnsignedAtomicAmount(value: AtomicAmount): bigint {
  const parsed = parseAtomicAmount(value);
  if (parsed < BigInt(0)) {
    throw new TypeError("amount must not be negative.");
  }
  return parsed;
}

function validateDecimals(decimals: number): void {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TypeError("decimals must be an integer from 0 through 255.");
  }
}

function validateFractionDigits(fractionDigits: number): void {
  if (
    !Number.isSafeInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 20
  ) {
    throw new TypeError("fractionDigits must be an integer from 0 through 20.");
  }
}

function validateFractionRange(
  fractionDigits: number,
  minimumFractionDigits: number,
): void {
  validateFractionDigits(fractionDigits);
  validateFractionDigits(minimumFractionDigits);
  if (minimumFractionDigits > fractionDigits) {
    throw new TypeError("minimumFractionDigits must not exceed fractionDigits.");
  }
}

function scaledDecimalResult(
  atoms: bigint,
  decimals: number,
  fractionDigits: number,
  markTiny = true,
): { negative: boolean; tiny: boolean; canonical: string } {
  validateDecimals(decimals);
  validateFractionDigits(fractionDigits);
  const negative = atoms < BigInt(0);
  const absolute = negative ? -atoms : atoms;
  const rounded = roundAtoms(absolute, decimals, fractionDigits);
  if (markTiny && absolute > BigInt(0) && rounded === BigInt(0)) {
    return {
      negative,
      tiny: true,
      canonical: fractionDigits === 0
        ? "1"
        : `0.${"0".repeat(fractionDigits - 1)}1`,
    };
  }
  return {
    negative,
    tiny: false,
    canonical: decimalFromScaledInteger(
      rounded,
      fractionDigits,
      fractionDigits,
    ),
  };
}

function roundAtoms(atoms: bigint, scale: number, targetScale: number): bigint {
  if (scale <= targetScale) {
    return atoms * BigInt(10) ** BigInt(targetScale - scale);
  }
  const divisor = BigInt(10) ** BigInt(scale - targetScale);
  const quotient = atoms / divisor;
  const remainder = atoms % divisor;
  const doubled = remainder * BigInt(2);
  return doubled > divisor ||
    (doubled === divisor && quotient % BigInt(2) === BigInt(1))
    ? quotient + BigInt(1)
    : quotient;
}

function parseDecimal(value: DecimalInput): Decimal | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = String(value);
  }
  if (value !== value.trim()) return null;
  const match = decimalPattern.exec(value);
  if (!match) return null;

  const negative = match[1] === "-";
  let digits = `${match[2]}${match[3] ?? ""}`.replace(/^0+/, "") || "0";
  let scale = (match[3]?.length ?? 0) - Number(match[4] ?? "0");
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 10_000) return null;
  if (digits === "0") return { negative: false, digits: "0", scale: 0 };
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  return { negative, digits, scale };
}

function isLessThan(decimal: Decimal, comparison: string): boolean {
  const other = parseDecimal(comparison);
  if (!other) throw new Error("Invalid comparison decimal.");
  const scale = Math.max(decimal.scale, other.scale);
  const left = BigInt(decimal.digits) * BigInt(10) ** BigInt(scale - decimal.scale);
  const right = BigInt(other.digits) * BigInt(10) ** BigInt(scale - other.scale);
  return left < right;
}

function tinyFractionDigits(decimal: Decimal, maximum: number): number {
  const fraction = decimalFraction(decimal);
  const firstSignificant = fraction.search(/[1-9]/);
  return Math.min(firstSignificant + 4, maximum);
}

function decimalFraction(decimal: Decimal): string {
  if (decimal.scale === 0) return "";
  return decimal.digits.padStart(decimal.scale + 1, "0").slice(-decimal.scale);
}

function formatDecimal(
  decimal: Decimal,
  fractionDigits: number,
  minimumFractionDigits: number,
): string {
  const rounded = roundDigits(decimal.digits, decimal.scale, fractionDigits);
  return decimalFromScaledInteger(
    BigInt(rounded),
    fractionDigits,
    minimumFractionDigits,
  );
}

function trimCanonicalFraction(
  value: string,
  minimumFractionDigits: number,
): string {
  const [whole, initialFraction = ""] = value.split(".");
  let fraction = initialFraction;
  while (fraction.length > minimumFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  return fraction ? `${whole}.${fraction}` : whole;
}

function decimalFromScaledInteger(
  value: bigint,
  scale: number,
  minimumFractionDigits: number,
): string {
  const digits = value.toString(10).padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, -scale) || "0";
  let fraction = scale === 0 ? "" : digits.slice(-scale);
  while (fraction.length > minimumFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function roundDigits(digits: string, scale: number, fractionDigits: number): string {
  if (scale <= fractionDigits) {
    return `${digits}${"0".repeat(fractionDigits - scale)}`;
  }
  const divisor = BigInt(10) ** BigInt(scale - fractionDigits);
  return ((BigInt(digits) + divisor / BigInt(2)) / divisor).toString();
}

function localizeWhole(value: string, regionId: RegionId): string {
  return new Intl.NumberFormat(presentationLocale(regionId), {
    maximumFractionDigits: 0,
  }).format(BigInt(value));
}

function localizeCanonicalDecimal(value: string, regionId: RegionId): string {
  const [whole = "0", fraction] = value.split(".");
  const grouped = localizeWhole(whole, regionId);
  if (fraction === undefined) return grouped;
  const decimalSeparator = new Intl.NumberFormat(presentationLocale(regionId))
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";
  return `${grouped}${decimalSeparator}${localizeDigits(fraction, regionId)}`;
}

function localizeDigits(value: string, regionId: RegionId): string {
  const digitFormatter = new Intl.NumberFormat(presentationLocale(regionId), {
    useGrouping: false,
  });
  const digits = Array.from({ length: 10 }, (_, digit) => digitFormatter.format(digit));
  return value.replace(/\d/g, (digit) => digits[Number(digit)]!);
}

function formatCurrencyDecimal(
  amount: string,
  currency: string,
  regionId: RegionId,
): string {
  const localizedAmount = localizeCanonicalDecimal(amount, regionId);
  const parts = new Intl.NumberFormat(presentationLocale(regionId), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(BigInt(0));
  const numericTypes = new Set<Intl.NumberFormatPartTypes>([
    "integer", "group", "decimal", "fraction",
  ]);
  const firstNumeric = parts.findIndex((part) => numericTypes.has(part.type));
  let lastNumeric = firstNumeric;
  while (lastNumeric + 1 < parts.length && numericTypes.has(parts[lastNumeric + 1]!.type)) {
    lastNumeric += 1;
  }
  const prefix = parts.slice(0, firstNumeric).map((part) => part.value).join("");
  const suffix = parts.slice(lastNumeric + 1).map((part) => part.value).join("");
  return joinCurrencySuffix(joinCurrencyPrefix(prefix, localizedAmount), suffix);
}

function formatCompactPrice(
  decimal: Decimal,
  currency: string,
  regionId: RegionId,
): string {
  const exponents = [15, 12, 9, 6, 3];
  const exponent = exponents.find((candidate) =>
    !isLessThan({ ...decimal, negative: false }, `1e${candidate}`)
  ) ?? 3;
  const scaled = { ...decimal, scale: decimal.scale + exponent };
  const amount = formatDecimal(scaled, 2, 2);
  const compactParts = new Intl.NumberFormat(presentationLocale(regionId), {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 0,
  }).formatToParts(BigInt(10) ** BigInt(exponent));
  const compactIndex = compactParts.findIndex((part) => part.type === "compact");
  const lastNumericIndex = compactParts.findLastIndex((part) =>
    part.type === "integer" || part.type === "group" ||
    part.type === "decimal" || part.type === "fraction"
  );
  const rawSuffix = compactIndex < 0 || lastNumericIndex < 0
    ? ""
    : collapseSpaces(compactParts.slice(lastNumericIndex + 1).map((part) => part.value).join(""), "");
  const suffix = rawSuffix.length > 1 ? `${NBSP}${rawSuffix}` : rawSuffix;
  const label = `${formatCurrencyDecimal(amount, currency, regionId)}${suffix}`;
  return applySign(label, decimal.negative, "auto");
}

function applySign(
  value: string,
  negative: boolean,
  policy: MoneySignPolicy = "auto",
): string {
  if (policy === "never") return value;
  if (negative) return `${minusSign}${value}`;
  return policy === "always" ? `+${value}` : value;
}

function normalizeMinus(value: string): string {
  return collapseSpaces(value.replace(/-/g, minusSign), NBSP);
}

function presentationFractionDigits(
  balanceBaseUnits: bigint,
  decimals: number,
  assetClass: PresentationAssetClass,
): { maximumFractionDigits: number; minimumFractionDigits: number } {
  validateDecimals(decimals);
  const absolute = balanceBaseUnits < BigInt(0) ? -balanceBaseUnits : balanceBaseUnits;
  if (assetClass === "stable") {
    const digits = Math.min(2, decimals);
    return { maximumFractionDigits: digits, minimumFractionDigits: digits };
  }
  if (assetClass === "meme") {
    if (amountMeetsThreshold(absolute, decimals, "1")) {
      return { maximumFractionDigits: 0, minimumFractionDigits: 0 };
    }
    return { maximumFractionDigits: Math.min(6, decimals), minimumFractionDigits: 0 };
  }
  if (amountMeetsThreshold(absolute, decimals, "0.01")) {
    const digits = Math.min(4, decimals);
    return { maximumFractionDigits: digits, minimumFractionDigits: digits };
  }
  return { maximumFractionDigits: Math.min(6, decimals), minimumFractionDigits: 0 };
}

function amountMeetsThreshold(
  balanceBaseUnits: bigint,
  decimals: number,
  threshold: string,
): boolean {
  return !isLessThan(
    { negative: false, digits: balanceBaseUnits.toString(10), scale: decimals },
    threshold,
  );
}

function padLocalizedFractionDigits(
  value: string,
  minimumFractionDigits: number,
  regionId: RegionId = "GLOBAL",
): string {
  if (minimumFractionDigits === 0 || value.includes("<")) return value;
  const decimalSeparator = new Intl.NumberFormat(presentationLocale(regionId))
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";
  const sign = value.startsWith(minusSign) ? minusSign : "";
  const unsigned = sign ? value.slice(sign.length) : value;
  const [whole, fraction = ""] = unsigned.split(decimalSeparator);
  if (fraction.length >= minimumFractionDigits) return value;
  const zeros = localizeDigits(
    "0".repeat(minimumFractionDigits - fraction.length),
    regionId,
  );
  return `${sign}${whole}${decimalSeparator}${fraction}${zeros}`;
}
