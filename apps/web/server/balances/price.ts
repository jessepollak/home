import "server-only";

import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import {
  getCodexRawQuotes,
  type CodexRawQuoteInput,
} from "@/server/market-data/codex/raw-quotes";
import { getCoinbaseExchangeRates } from "./fx-coinbase";
import {
  BALANCES_PRICE_MAX_AGE_MS,
  type ExactDecimal,
  type Holding,
  type HoldingCashValue,
  type HoldingValue,
} from "@/shared/balances/types";
import {
  baseUnitsToFraction,
  divideFractions,
  exactDecimalToFraction,
  multiplyFractions,
  roundFractionPreservingPositive,
  type Fraction,
} from "@/shared/balances/math";
import type {
  FxQuote,
  NativeEthQuote,
  PriceQuote,
} from "@/shared/balances/quotes";
import type { BalancesRead, ReadHolding } from "./types";
import {
  getPriceObservationStore,
  type PriceObservation,
  type PriceObservationStore,
} from "./price-observation-store";

const PRICE_BATCH_SIZE = 25;
export const BALANCES_PRICE_CONCURRENCY = 4;
const LIQUIDITY_GATE = {
  numerator: BigInt(100_000),
  denominator: BigInt(1),
};
const VOLUME_GATE = {
  numerator: BigInt(10_000),
  denominator: BigInt(1),
};
const ZERO: Fraction = {
  numerator: BigInt(0),
  denominator: BigInt(1),
};

type ExchangeRates = Awaited<ReturnType<typeof getCoinbaseExchangeRates>>;
type Dependencies = {
  readPrices?: (
    inputs: readonly CodexRawQuoteInput[],
    options?: { freshnessMs?: number },
  ) => Promise<PriceQuote[]>;
  readExchangeRates?: () => Promise<ExchangeRates>;
  priceStore?: PriceObservationStore;
  now?: () => Date;
};

export function createBalancesPricer(dependencies: Dependencies = {}) {
  const readPrices = dependencies.readPrices ?? getCodexRawQuotes;
  const readExchangeRates = dependencies.readExchangeRates
    ?? getCoinbaseExchangeRates;
  const priceStore = dependencies.priceStore ?? getPriceObservationStore();
  const now = dependencies.now ?? (() => new Date());
  const lastWrittenAsOf = new Map<string, number>();

  return async function priceBalances(
    read: BalancesRead,
    region: RegionId,
  ): Promise<Holding[]> {
    const quoteCurrency = presentationRegions[region].currency.code;
    const registryInputs = uniqueInputs(
      read.holdings
        .filter((holding) =>
          holding.source === "registry" && holding.kind !== "native",
        )
        .map(pricingInput),
    );
    const discoveredInputs = uniqueInputs(
      read.holdings
        .filter((holding) =>
          (holding.source === "catalog" || holding.marketDataResolved === true) &&
          positivePricingAmount(holding),
        )
        .map(pricingInput),
    );
    const inputBatches: CodexRawQuoteInput[][] = [];

    if (registryInputs.length > 0) {
      inputBatches.push(registryInputs);
    }
    for (
      let index = 0;
      index < discoveredInputs.length;
      index += PRICE_BATCH_SIZE
    ) {
      inputBatches.push(discoveredInputs.slice(index, index + PRICE_BATCH_SIZE));
    }
    const priceBatches = await mapWithConcurrency(
      inputBatches,
      BALANCES_PRICE_CONCURRENCY,
      (inputs) => readPriceBatch(readPrices, inputs),
    );

    let rates: ExchangeRates | null = null;
    if (read.holdings.some(positivePricingAmount)) {
      try {
        rates = await readExchangeRates();
      } catch {
        rates = null;
      }
    }

    const currentTime = now();
    const prices = await persistAndRestorePrices(
      priceBatches.flat(),
      priceStore,
      currentTime,
      lastWrittenAsOf,
    );
    return read.holdings.map((holding) =>
      priceHolding(holding, quoteCurrency, prices, rates, currentTime),
    );
  };
}

export const priceBalances = createBalancesPricer();

function priceHolding(
  holding: ReadHolding,
  quoteCurrency: FiatCurrencyCode | null,
  prices: readonly PriceQuote[],
  rates: ExchangeRates | null,
  currentTime: Date,
): Holding {
  const base: Omit<Holding, "value"> = {
    key: holding.key,
    id: holding.id,
    kind: holding.kind,
    source: holding.source,
    name: holding.name,
    symbol: holding.symbol,
    decimals: holding.decimals,
    contractAddress: holding.contractAddress,
    cashCurrency: holding.cashCurrency,
    ...(holding.imageUrl ? { imageUrl: holding.imageUrl } : {}),
    ...(holding.underlying ? { underlying: holding.underlying } : {}),
    balance: holding.balance,
    ...(holding.underlyingBalance
      ? { underlyingBalance: holding.underlyingBalance }
      : {}),
  };

  if (holding.balance.status === "unavailable") {
    return {
      ...base,
      value: { status: "unavailable" },
      ...(holding.cashCurrency
        ? { cashValue: { status: "unavailable" } as HoldingCashValue }
        : {}),
    };
  }
  if (quoteCurrency === null) {
    return {
      ...base,
      value: {
        status: "unpriced",
        reason: "no-quote-currency",
      },
      ...(holding.cashCurrency
        ? { cashValue: priceCash(holding, prices, rates) }
        : {}),
    };
  }
  if (holding.source === "wallet" && holding.marketDataResolved !== true) {
    return {
      ...base,
      value: {
        status: "unpriced",
        reason: "below-market-gate",
      },
    };
  }

  const valuation = valueFraction(
    holding,
    quoteCurrency,
    prices,
    rates,
    currentTime,
  );
  const value: HoldingValue = valuation.fraction
    ? {
        status: "priced",
        currency: quoteCurrency,
        amount: roundFractionPreservingPositive(valuation.fraction),
        asOf: valuation.asOf,
      }
    : {
        status: "unpriced",
        reason: valuation.reason,
      };

  return {
    ...base,
    value,
    ...(holding.cashCurrency
      ? { cashValue: priceCash(holding, prices, rates) }
      : {}),
  };
}

function valueFraction(
  holding: ReadHolding,
  currency: FiatCurrencyCode,
  prices: readonly PriceQuote[],
  rates: ExchangeRates | null,
  currentTime: Date,
): {
  fraction: Fraction | null;
  reason:
    | "price-unavailable"
    | "price-stale"
    | "fx-unavailable"
    | "below-market-gate";
  asOf: string;
} {
  const amount = holding.kind === "vault-share"
    ? holding.underlyingBalance
    : holding.balance;
  const decimals = holding.kind === "vault-share"
    ? holding.underlying!.decimals
    : holding.decimals;
  if (amount?.status !== "ready") {
    return failed("price-unavailable", currentTime);
  }

  const quantity = baseUnitsToFraction(amount.baseUnits, decimals);
  if (quantity.numerator === BigInt(0)) {
    return {
      fraction: ZERO,
      reason: "price-unavailable",
      asOf: currentTime.toISOString(),
    };
  }

  const fx = findFx(rates, currency);
  if (!fx) {
    return failed("fx-unavailable", currentTime);
  }
  const fxFraction = exactDecimalToFraction(fx.quoteUnitsPerUsd!);

  if (holding.kind === "native") {
    const native = rates?.nativeEthQuote ?? null;
    if (native?.status !== "fresh" || !native.assetUnitsPerUsd) {
      return failed("price-unavailable", currentTime);
    }
    return {
      fraction: multiplyFractions(
        divideFractions(
          quantity,
          exactDecimalToFraction(native.assetUnitsPerUsd),
        ),
        fxFraction,
      ),
      reason: "price-unavailable",
      asOf: quoteAsOf(native),
    };
  }

  const pricingKey = holding.kind === "vault-share"
    ? holding.underlying!.key
    : holding.key;
  const price = prices.find(
    (candidate) => candidate.assetKey === pricingKey,
  );
  if (price?.status === "stale") {
    return failed("price-stale", currentTime);
  }
  if (price?.status !== "fresh" || !price.unitPrice) {
    return failed("price-unavailable", currentTime);
  }
  if (
    (holding.source === "catalog" || holding.source === "wallet") &&
    (
      !meetsGate(holding.liquidityUsd, LIQUIDITY_GATE) ||
      !meetsGate(holding.volume24Usd, VOLUME_GATE)
    )
  ) {
    return failed("below-market-gate", currentTime);
  }

  return {
    fraction: multiplyFractions(
      quantity,
      exactDecimalToFraction(price.unitPrice),
      fxFraction,
    ),
    reason: "price-unavailable",
    asOf: quoteAsOf(price),
  };
}

function priceCash(
  holding: ReadHolding,
  prices: readonly PriceQuote[],
  rates: ExchangeRates | null,
): HoldingCashValue {
  if (holding.balance.status === "unavailable") {
    return { status: "unavailable" };
  }

  const quantity = baseUnitsToFraction(
    holding.balance.baseUnits,
    holding.decimals,
  );
  if (quantity.numerator === BigInt(0)) {
    return {
      status: "priced",
      currency: holding.cashCurrency!,
      amount: roundFractionPreservingPositive(ZERO),
    };
  }

  const price = prices.find(
    (candidate) => candidate.assetKey === holding.key,
  );
  if (price?.status === "stale") {
    return {
      status: "unpriced",
      reason: "price-stale",
    };
  }
  if (price?.status !== "fresh" || !price.unitPrice) {
    return {
      status: "unpriced",
      reason: "price-unavailable",
    };
  }

  const fx = findFx(rates, holding.cashCurrency!);
  if (!fx) {
    return {
      status: "unpriced",
      reason: "fx-unavailable",
    };
  }

  return {
    status: "priced",
    currency: holding.cashCurrency!,
    amount: roundFractionPreservingPositive(multiplyFractions(
      quantity,
      exactDecimalToFraction(price.unitPrice),
      exactDecimalToFraction(fx.quoteUnitsPerUsd!),
    )),
  };
}

function pricingInput(holding: ReadHolding): CodexRawQuoteInput {
  const key = holding.kind === "vault-share"
    ? holding.underlying!.key
    : holding.key;
  const address = holding.kind === "vault-share"
    ? holding.underlying!.key.split(":").at(-1)!
    : holding.contractAddress!;
  return {
    assetKey: key as `eip155:8453/erc20:${string}`,
    address: address as `0x${string}`,
    networkId: 8453,
  };
}

function uniqueInputs(
  inputs: readonly CodexRawQuoteInput[],
): CodexRawQuoteInput[] {
  const byKey = new Map<string, CodexRawQuoteInput>();
  for (const input of inputs) {
    byKey.set(input.assetKey, input);
  }
  return [...byKey.values()];
}

async function persistAndRestorePrices(
  prices: readonly PriceQuote[],
  store: PriceObservationStore,
  currentTime: Date,
  lastWrittenAsOf: Map<string, number>,
): Promise<PriceQuote[]> {
  const byKey = new Map<string, { observation: PriceObservation; asOfMs: number }>();
  for (const price of prices) {
    if (price.status !== "fresh" || !price.unitPrice || !price.source.asOf) continue;
    const asOfMs = Date.parse(price.source.asOf);
    if (!Number.isFinite(asOfMs) || asOfMs <= (lastWrittenAsOf.get(price.assetKey) ?? Number.NEGATIVE_INFINITY)) continue;
    const existing = byKey.get(price.assetKey);
    if (existing && existing.asOfMs >= asOfMs) continue;
    byKey.set(price.assetKey, {
      asOfMs,
      observation: {
        assetKey: price.assetKey,
        unitPrice: price.unitPrice,
        asOf: price.source.asOf,
        fetchedAt: price.source.fetchedAt,
      },
    });
  }
  const pending = [...byKey.values()];
  if (pending.length > 0) {
    try {
      await store.putMany(pending.map(({ observation }) => observation));
      for (const { observation, asOfMs } of pending) {
        lastWrittenAsOf.set(observation.assetKey, asOfMs);
      }
    } catch {
      // Persistence is a best-effort cross-instance fallback, never a read failure.
    }
  }

  const fallbackKeys = prices.flatMap((price) =>
    price.status === "fresh" ? [] : [price.assetKey]);
  if (fallbackKeys.length === 0) return [...prices];

  let stored: PriceObservation[];
  try {
    stored = await store.getMany(fallbackKeys);
  } catch {
    return [...prices];
  }
  const storedByKey = new Map(stored.flatMap((observation) => {
    const asOfMs = Date.parse(observation.asOf);
    return Number.isFinite(asOfMs) &&
        currentTime.getTime() - asOfMs <= BALANCES_PRICE_MAX_AGE_MS
      ? [[observation.assetKey, observation] as const]
      : [];
  }));

  return prices.map((price) => {
    if (price.status === "fresh") return price;
    const observation = storedByKey.get(price.assetKey);
    if (!observation) return price;
    return {
      ...price,
      unitPrice: observation.unitPrice,
      status: "fresh",
      source: {
        provider: "Codex",
        method: "Stored price observation",
        fetchedAt: observation.fetchedAt,
        asOf: observation.asOf,
        timeBasis: "provider-as-of",
      },
    };
  });
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await map(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function readPriceBatch(
  readPrices: NonNullable<Dependencies["readPrices"]>,
  inputs: readonly CodexRawQuoteInput[],
): Promise<PriceQuote[]> {
  try {
    return await readPrices(inputs, {
      freshnessMs: BALANCES_PRICE_MAX_AGE_MS,
    });
  } catch {
    return unavailablePrices(inputs);
  }
}

function positivePricingAmount(holding: ReadHolding): boolean {
  const amount = holding.kind === "vault-share"
    ? holding.underlyingBalance
    : holding.balance;
  return (
    amount?.status === "ready" &&
    BigInt(amount.baseUnits) > BigInt(0)
  );
}

function findFx(
  rates: ExchangeRates | null,
  currency: FiatCurrencyCode,
): FxQuote | null {
  const fx = rates?.quotes.find(
    (quote) => quote.quoteCurrency === currency,
  ) ?? null;
  return fx?.status === "fresh" && fx.quoteUnitsPerUsd ? fx : null;
}

function meetsGate(
  decimal: ExactDecimal | undefined,
  threshold: Fraction,
): boolean {
  if (!decimal) {
    return false;
  }
  const value = exactDecimalToFraction(decimal);
  return (
    value.numerator * threshold.denominator >=
    threshold.numerator * value.denominator
  );
}

function failed(
  reason:
    | "price-unavailable"
    | "price-stale"
    | "fx-unavailable"
    | "below-market-gate",
  currentTime: Date,
) {
  return {
    fraction: null,
    reason,
    asOf: currentTime.toISOString(),
  } as const;
}

function quoteAsOf(quote: PriceQuote | NativeEthQuote): string {
  return quote.source.asOf ?? quote.source.fetchedAt;
}

function unavailablePrices(
  inputs: readonly CodexRawQuoteInput[],
): PriceQuote[] {
  const fetchedAt = new Date().toISOString();
  return inputs.map((input) => ({
    ...input,
    contractAddress: input.address,
    quoteCurrency: "USD",
    unitPrice: null,
    sourceValue: null,
    status: "unavailable",
    source: {
      provider: "Codex",
      method: "Exact-contract token prices",
      fetchedAt,
      asOf: null,
      timeBasis: "retrieved-at",
    },
  }));
}
