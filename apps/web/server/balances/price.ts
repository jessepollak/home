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
export const BALANCES_PRICE_REFRESH_MS = 60_000;
const LIQUIDITY_GATE = {
  numerator: BigInt(25_000),
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
  schedule?: (task: Promise<unknown> | (() => Promise<unknown>)) => void;
};

export function createBalancesPricer(
  dependencies: Dependencies = {},
): (read: BalancesRead, region: RegionId) => Promise<Holding[]> {
  const readPrices = dependencies.readPrices ?? getCodexRawQuotes;
  const readExchangeRates = dependencies.readExchangeRates
    ?? getCoinbaseExchangeRates;
  const priceStore = dependencies.priceStore ?? getPriceObservationStore();
  const now = dependencies.now ?? (() => new Date());
  const schedule = dependencies.schedule ?? ((task) => {
    void (typeof task === "function" ? task() : task);
  });
  const lastWrittenFetchedAt = new Map<string, number>();
  const refreshing = new Set<string>();

  const priceRead = async (
    read: BalancesRead,
    region: RegionId,
  ): Promise<Holding[]> => {
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
    const inputs = uniqueInputs([...registryInputs, ...discoveredInputs]);
    const ratesRequest: Promise<ExchangeRates | null> = read.holdings.some(positivePricingAmount)
      ? readExchangeRates().catch(() => null)
      : Promise.resolve(null);
    const storedRequest = priceStore.getMany(inputs.map(({ assetKey }) => assetKey))
      .catch(() => [] as PriceObservation[]);
    const [stored, rates] = await Promise.all([storedRequest, ratesRequest]);
    const currentTime = now();
    const storedByKey = new Map(stored.map((observation) => [observation.assetKey, observation]));
    const missing = inputs.filter(({ assetKey }) => !storedByKey.has(assetKey));
    const foreground = await fetchPriceInputs(readPrices, missing);
    await persistPrices(foreground, priceStore, lastWrittenFetchedAt);

    const expiring = inputs.filter(({ assetKey }) => {
      const observation = storedByKey.get(assetKey);
      return observation && currentTime.getTime() - Date.parse(observation.fetchedAt) > BALANCES_PRICE_REFRESH_MS;
    });
    schedulePriceRefresh(expiring);
    const foregroundByKey = new Map(foreground.map((price) => [price.assetKey, price]));
    const prices = inputs.map((input) => foregroundByKey.get(input.assetKey)
      ?? quoteFromObservation(storedByKey.get(input.assetKey)!, currentTime));
    return read.holdings.map((holding) =>
      priceHolding(holding, quoteCurrency, prices, rates, currentTime),
    );
  };

  function schedulePriceRefresh(inputs: readonly CodexRawQuoteInput[]): void {
    const pending = inputs.filter(({ assetKey }) => !refreshing.has(assetKey));
    if (pending.length === 0) return;
    for (const { assetKey } of pending) refreshing.add(assetKey);
    const task = async () => {
      try {
        const prices = await fetchPriceInputs(readPrices, pending);
        await persistPrices(prices, priceStore, lastWrittenFetchedAt);
      } catch {
        // Background price refresh never changes the cached response.
      } finally {
        for (const { assetKey } of pending) refreshing.delete(assetKey);
      }
    };
    try { schedule(task); } catch {
      for (const { assetKey } of pending) refreshing.delete(assetKey);
    }
  }

  return priceRead;
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
    !meetsGate(holding.liquidityUsd, LIQUIDITY_GATE)
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

async function fetchPriceInputs(
  readPrices: NonNullable<Dependencies["readPrices"]>,
  inputs: readonly CodexRawQuoteInput[],
): Promise<PriceQuote[]> {
  const batches: CodexRawQuoteInput[][] = [];
  for (let index = 0; index < inputs.length; index += PRICE_BATCH_SIZE) {
    batches.push(inputs.slice(index, index + PRICE_BATCH_SIZE));
  }
  return (await mapWithConcurrency(
    batches,
    BALANCES_PRICE_CONCURRENCY,
    (batch) => readPriceBatch(readPrices, batch),
  )).flat();
}

async function persistPrices(
  prices: readonly PriceQuote[],
  store: PriceObservationStore,
  lastWrittenFetchedAt: Map<string, number>,
): Promise<void> {
  const byKey = new Map<string, PriceObservation>();
  for (const price of prices) {
    if (price.status !== "fresh" || !price.unitPrice || !price.source.asOf) continue;
    const fetchedAtMs = Date.parse(price.source.fetchedAt);
    if (!Number.isFinite(fetchedAtMs) ||
      fetchedAtMs <= (lastWrittenFetchedAt.get(price.assetKey) ?? Number.NEGATIVE_INFINITY)) continue;
    const observation = {
      assetKey: price.assetKey,
      unitPrice: price.unitPrice,
      asOf: price.source.asOf,
      fetchedAt: price.source.fetchedAt,
    };
    const existing = byKey.get(price.assetKey);
    if (!existing || Date.parse(observation.asOf) > Date.parse(existing.asOf) ||
      (observation.asOf === existing.asOf && fetchedAtMs > Date.parse(existing.fetchedAt))) {
      byKey.set(price.assetKey, observation);
    }
  }
  const observations = [...byKey.values()];
  if (observations.length === 0) return;
  try {
    await store.putMany(observations);
    for (const observation of observations) {
      lastWrittenFetchedAt.set(observation.assetKey, Date.parse(observation.fetchedAt));
    }
  } catch {
    // Persistence is best effort and never changes the price response.
  }
}

function quoteFromObservation(
  observation: PriceObservation,
  currentTime: Date,
): PriceQuote {
  const stale = currentTime.getTime() - Date.parse(observation.asOf) > BALANCES_PRICE_MAX_AGE_MS;
  const address = observation.assetKey.split(":").at(-1) as `0x${string}`;
  return {
    assetKey: observation.assetKey as `eip155:8453/erc20:${string}`,
    contractAddress: address,
    quoteCurrency: "USD",
    unitPrice: observation.unitPrice,
    sourceValue: null,
    status: stale ? "stale" : "fresh",
    source: {
      provider: "Codex",
      method: "Stored price observation",
      fetchedAt: observation.fetchedAt,
      asOf: observation.asOf,
      timeBasis: "provider-as-of",
    },
  };
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
