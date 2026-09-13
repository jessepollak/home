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
import type {
  ExactDecimal,
  Holding,
  HoldingCashValue,
  HoldingValue,
} from "@/shared/balances/types";
import {
  baseUnitsToFraction,
  divideFractions,
  exactDecimalToFraction,
  multiplyFractions,
  roundFractionPreservingPositive,
  type Fraction,
} from "@/shared/portfolio/valuation-math";
import type {
  FxQuote,
  NativeEthQuote,
  PriceQuote,
} from "@/shared/portfolio/valuation-types";
import type { BalancesRead, ReadHolding } from "./types";

const PRICE_BATCH_SIZE = 25;
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
  readPrices?: (inputs: readonly CodexRawQuoteInput[]) => Promise<PriceQuote[]>;
  readExchangeRates?: () => Promise<ExchangeRates>;
};

export function createBalancesPricer(dependencies: Dependencies = {}) {
  const readPrices = dependencies.readPrices ?? getCodexRawQuotes;
  const readExchangeRates = dependencies.readExchangeRates
    ?? getCoinbaseExchangeRates;

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
    const catalogInputs = uniqueInputs(
      read.holdings
        .filter((holding) =>
          holding.source === "catalog" && positivePricingAmount(holding),
        )
        .map(pricingInput),
    );
    const priceBatches: PriceQuote[][] = [];

    if (registryInputs.length > 0) {
      priceBatches.push(await readPriceBatch(readPrices, registryInputs));
    }
    for (
      let index = 0;
      index < catalogInputs.length;
      index += PRICE_BATCH_SIZE
    ) {
      priceBatches.push(await readPriceBatch(
        readPrices,
        catalogInputs.slice(index, index + PRICE_BATCH_SIZE),
      ));
    }

    let rates: ExchangeRates | null = null;
    if (read.holdings.some(positivePricingAmount)) {
      try {
        rates = await readExchangeRates();
      } catch {
        rates = null;
      }
    }

    const prices = priceBatches.flat();
    return read.holdings.map((holding) =>
      priceHolding(holding, quoteCurrency, prices, rates),
    );
  };
}

export const priceBalances = createBalancesPricer();

function priceHolding(
  holding: ReadHolding,
  quoteCurrency: FiatCurrencyCode | null,
  prices: readonly PriceQuote[],
  rates: ExchangeRates | null,
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
  if (holding.source === "wallet") {
    return {
      ...base,
      value: {
        status: "unpriced",
        reason: "below-market-gate",
      },
    };
  }

  const valuation = valueFraction(holding, quoteCurrency, prices, rates);
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
    return failed("price-unavailable");
  }

  const quantity = baseUnitsToFraction(amount.baseUnits, decimals);
  if (quantity.numerator === BigInt(0)) {
    return {
      fraction: ZERO,
      reason: "price-unavailable",
      asOf: new Date().toISOString(),
    };
  }

  const fx = findFx(rates, currency);
  if (!fx) {
    return failed("fx-unavailable");
  }
  const fxFraction = exactDecimalToFraction(fx.quoteUnitsPerUsd!);

  if (holding.kind === "native") {
    const native = rates?.nativeEthQuote ?? null;
    if (native?.status !== "fresh" || !native.assetUnitsPerUsd) {
      return failed("price-unavailable");
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
    return failed("price-stale");
  }
  if (price?.status !== "fresh" || !price.unitPrice) {
    return failed("price-unavailable");
  }
  if (
    holding.source === "catalog" &&
    (
      !meetsGate(holding.liquidityUsd, LIQUIDITY_GATE) ||
      !meetsGate(holding.volume24Usd, VOLUME_GATE)
    )
  ) {
    return failed("below-market-gate");
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

async function readPriceBatch(
  readPrices: NonNullable<Dependencies["readPrices"]>,
  inputs: readonly CodexRawQuoteInput[],
): Promise<PriceQuote[]> {
  try {
    return await readPrices(inputs);
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
) {
  return {
    fraction: null,
    reason,
    asOf: new Date().toISOString(),
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
