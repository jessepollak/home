import type { FiatCurrencyCode } from "@/config/regions";
import { parseExactDecimal } from "@/shared/portfolio/valuation-math";
import type { FxQuote, NativeEthQuote, ValuationSource } from "@/shared/portfolio/valuation-types";

export const COINBASE_EXCHANGE_RATES_URL =
  "https://api.coinbase.com/v2/exchange-rates?currency=USD" as const;
export const COINBASE_FX_CACHE_MS = 60_000;
export const COINBASE_FX_TIMEOUT_MS = 6_000;

export const supportedFiatCurrencies = [
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

type FetchLike = typeof fetch;
type ExchangeRatesSnapshot = {
  fetchedAt: string;
  quotes: FxQuote[];
  nativeEthQuote: NativeEthQuote;
};

export class CoinbaseExchangeRatesError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CoinbaseExchangeRatesError";
  }
}

export function createCoinbaseExchangeRatesReader(options: {
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? COINBASE_FX_TIMEOUT_MS;
  let cache: { storedAt: number; value: ExchangeRatesSnapshot } | null = null;
  let inFlight: Promise<ExchangeRatesSnapshot> | null = null;

  return async function readExchangeRates(): Promise<ExchangeRatesSnapshot> {
    const currentTime = now().getTime();
    if (!Number.isFinite(currentTime)) {
      throw new CoinbaseExchangeRatesError("The exchange-rate fetch time is invalid.");
    }
    if (cache && currentTime - cache.storedAt <= COINBASE_FX_CACHE_MS) {
      return cache.value;
    }
    if (inFlight) return inFlight;

    inFlight = fetchRates({ fetchImpl, now, timeoutMs });
    try {
      const value = await inFlight;
      cache = { storedAt: now().getTime(), value };
      return value;
    } finally {
      inFlight = null;
    }
  };
}

const sharedReader = createCoinbaseExchangeRatesReader();

export function getCoinbaseExchangeRates(): Promise<ExchangeRatesSnapshot> {
  return sharedReader();
}

async function fetchRates({
  fetchImpl,
  now,
  timeoutMs,
}: {
  fetchImpl: FetchLike;
  now: () => Date;
  timeoutMs: number;
}): Promise<ExchangeRatesSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(COINBASE_EXCHANGE_RATES_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CoinbaseExchangeRatesError(
        `Coinbase exchange rates returned HTTP ${response.status}.`,
      );
    }
    const payload: unknown = await response.json();
    const rates = readRates(payload);
    const fetchedAt = now();
    if (Number.isNaN(fetchedAt.getTime())) {
      throw new CoinbaseExchangeRatesError("The exchange-rate fetch time is invalid.");
    }
    const source: ValuationSource = {
      provider: "Coinbase Exchange Rates",
      method: "USD exchange rates",
      fetchedAt: fetchedAt.toISOString(),
      asOf: null,
      timeBasis: "retrieved-at",
    };
    const quotes = supportedFiatCurrencies.map((currency) =>
      normalizeFiatQuote(currency, rates[currency], source),
    );
    const nativeEthQuote = normalizeEthQuote(rates.ETH, source);
    return { fetchedAt: fetchedAt.toISOString(), quotes, nativeEthQuote };
  } catch (error) {
    if (error instanceof CoinbaseExchangeRatesError) throw error;
    throw new CoinbaseExchangeRatesError(
      controller.signal.aborted
        ? "Coinbase exchange rates timed out."
        : "Coinbase exchange rates request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readRates(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data) || value.data.currency !== "USD") {
    throw new CoinbaseExchangeRatesError("Coinbase returned an invalid base currency.");
  }
  if (!isRecord(value.data.rates)) {
    throw new CoinbaseExchangeRatesError("Coinbase returned an invalid rate set.");
  }
  return value.data.rates;
}

function normalizeFiatQuote(
  currency: FiatCurrencyCode,
  raw: unknown,
  source: ValuationSource,
): FxQuote {
  if (typeof raw !== "string") {
    return {
      baseCurrency: "USD",
      quoteCurrency: currency,
      quoteUnitsPerUsd: null,
      sourceValue: null,
      status: "missing",
      source,
    };
  }
  const exact = parseExactDecimal(raw);
  if (!exact || BigInt(exact.atoms) === BigInt(0)) {
    return {
      baseCurrency: "USD",
      quoteCurrency: currency,
      quoteUnitsPerUsd: null,
      sourceValue: raw,
      status: "invalid",
      source,
    };
  }
  return {
    baseCurrency: "USD",
    quoteCurrency: currency,
    quoteUnitsPerUsd: exact,
    sourceValue: raw,
    status: "fresh",
    source,
  };
}

function normalizeEthQuote(
  raw: unknown,
  source: ValuationSource,
): NativeEthQuote {
  if (typeof raw !== "string") {
    return {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: null,
      sourceValue: null,
      status: "missing",
      source,
    };
  }
  const exact = parseExactDecimal(raw);
  if (!exact || BigInt(exact.atoms) === BigInt(0)) {
    return {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: null,
      sourceValue: raw,
      status: "invalid",
      source,
    };
  }
  return {
    baseCurrency: "USD",
    assetSymbol: "ETH",
    assetUnitsPerUsd: exact,
    sourceValue: raw,
    status: "fresh",
    source,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
