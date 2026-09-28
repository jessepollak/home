import "server-only";

import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import { stockAssets, type InvestAsset } from "@/config/invest-assets";
import { emitServerEvent } from "@/server/observability/log";
import {
  getCodexRawQuotes,
  type CodexRawQuoteInput,
} from "@/server/market-data/codex/raw-quotes";
import {
  readCurrentTokenizedEquityReferences,
  tokenizedEquityFeeds,
  type TokenizedEquityFeed,
  type TokenizedEquityReference,
} from "@/server/market-data/tokenized-equity/reader";
import {
  BALANCES_PRICE_MAX_AGE_MS,
  type BalancesBorrow,
  type ExactDecimal,
  type Holding,
  type HoldingCashValue,
  type HoldingValue,
  type HoldingValueReference,
  type HoldingValueUnpricedReason,
} from "@/shared/balances/types";
import {
  baseUnitsToFraction,
  divideFractions,
  exactDecimalToFraction,
  multiplyFractions,
  roundFractionPreservingPositive,
  type Fraction,
} from "@/shared/balances/math";
import type { FxQuote, NativeEthQuote, PriceQuote } from "@/shared/balances/quotes";
import { assembleBorrow, borrowPricingPairs } from "./borrow";
import { getCoinbaseExchangeRates } from "./fx-coinbase";
import type { BalancesRead, ReadHolding } from "./types";
import {
  getPriceObservationStore,
  type PriceObservation,
  type PriceObservationStore,
  type ValuationAttempt,
  type ValuationAttemptStatus,
} from "./price-observation-store";

const PRICE_BATCH_SIZE = 25;
export const BALANCES_PRICE_CONCURRENCY = 4;
export const BALANCES_PRICE_REFRESH_MS = 60_000;
export const STOCK_REFERENCE_REFRESH_MS = 30_000;
export const STOCK_REFERENCE_MAX_AGE_MS = 5 * 60_000;
export const BALANCES_NEGATIVE_UNAVAILABLE_MS = 60_000;
export const BALANCES_NEGATIVE_LONG_MS = 15 * 60_000;
const LIQUIDITY_GATE = { numerator: BigInt(25_000), denominator: BigInt(1) };
const ZERO: Fraction = { numerator: BigInt(0), denominator: BigInt(1) };
const FX_PREFIX = "fx:USD:";

type ExchangeRates = Awaited<ReturnType<typeof getCoinbaseExchangeRates>>;
type StockHolding = { listing: InvestAsset["listing"]; reference?: TokenizedEquityReference };
type Valuation = { fraction: Fraction | null; reason: Exclude<HoldingValueUnpricedReason, "no-quote-currency">; asOf: string; reference?: HoldingValueReference };
export type ValuationMode = "cached" | "bootstrap";
export type PriceBalancesResult = {
  holdings: Holding[];
  borrow: BalancesBorrow;
  revalidating: boolean;
  durationMs: { store: number; codex: number; coinbase: number };
};
type Dependencies = {
  readPrices?: (inputs: readonly CodexRawQuoteInput[], options?: { freshnessMs?: number }) => Promise<PriceQuote[]>;
  readExchangeRates?: () => Promise<ExchangeRates>;
  stockAssets?: readonly InvestAsset[];
  readStockReferences?: (feeds: readonly TokenizedEquityFeed[]) => Promise<TokenizedEquityReference[]>;
  priceStore?: PriceObservationStore;
  now?: () => Date;
  nowMs?: () => number;
  schedule?: (task: Promise<unknown> | (() => Promise<unknown>)) => void;
};

type RefreshWork = {
  tokenInputs: CodexRawQuoteInput[];
  fxKeys: string[];
};

export function createBalancesPricer(dependencies: Dependencies = {}) {
  const readPrices = dependencies.readPrices ?? getCodexRawQuotes;
  const readExchangeRates = dependencies.readExchangeRates ?? getCoinbaseExchangeRates;
  const configuredStocks = dependencies.stockAssets ?? stockAssets;
  const stocksById = new Map(configuredStocks.filter((asset) => asset.category === "stock").map((asset) => [asset.id, asset]));
  const readStockReferences = dependencies.readStockReferences ?? readCurrentTokenizedEquityReferences;
  const priceStore = dependencies.priceStore ?? getPriceObservationStore();
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? (() => Date.now());
  const schedule = dependencies.schedule ?? ((task) => { void (typeof task === "function" ? task() : task); });
  const refreshing = new Set<string>();
  let stockReferences: { at: number; byId: Map<string, TokenizedEquityReference> } | null = null;
  let stockReferenceAttemptAt: number | null = null;
  let stockReferenceScheduled = false;
  let stockReferencePending: Promise<void> | null = null;
  const lastWrittenFetchedAt = new Map<string, number>();

  return async function priceRead(
    read: BalancesRead,
    region: RegionId,
    mode: ValuationMode = "bootstrap",
  ): Promise<PriceBalancesResult> {
    const startedStore = nowMs();
    const currentTime = now();
    const quoteCurrency = presentationRegions[region].currency.code;
    const borrowPairs = borrowPricingPairs(read.borrow);
    const pricingHoldings = [
      ...read.holdings,
      ...borrowPairs.flatMap((pair) => [pair.collateral, pair.debt]),
    ];
    const tokenInputs = pricingInputs(pricingHoldings, stocksById);
    const stockHoldings = read.holdings.filter((holding) => holding.source === "registry" && stocksById.has(holding.id) && positivePricingAmount(holding));
    const listedStockHoldings = stockHoldings.filter((holding) => stocksById.get(holding.id)?.listing !== "removed");
    const stockFeeds = quoteCurrency !== null && listedStockHoldings.length > 0
      ? tokenizedEquityFeeds(configuredStocks.filter((asset) => asset.category === "stock" && asset.listing !== "removed"))
      : [];
    const fxKeys = neededFxKeys(pricingHoldings, quoteCurrency);
    const allKeys = [...tokenInputs.map(({ assetKey }) => assetKey), ...fxKeys];
    let stored: PriceObservation[] = [];
    let attempts: ValuationAttempt[] = [];
    [stored, attempts] = await Promise.all([
      priceStore.getMany(allKeys).catch(() => []),
      priceStore.getAttempts?.(allKeys).catch(() => []) ?? Promise.resolve([]),
    ]);
    const durationMs = {
      store: Math.max(0, nowMs() - startedStore),
      codex: 0,
      coinbase: 0,
    };
    const storedByKey = new Map(stored.map((value) => [value.assetKey, value]));
    const attemptsByKey = new Map(attempts.map((value) => [value.assetKey, value]));
    const work = refreshWork(tokenInputs, fxKeys, storedByKey, attemptsByKey, currentTime);

    let bootstrapQuotes: PriceQuote[] = [];
    if (mode === "bootstrap") {
      const bootstrapWork = {
        tokenInputs: work.tokenInputs.filter(({ assetKey }) => !safeObservation(storedByKey.get(assetKey), currentTime)),
        fxKeys: work.fxKeys.filter((key) => !safeObservation(storedByKey.get(key), currentTime)),
      };
      if (bootstrapWork.tokenInputs.length > 0 || bootstrapWork.fxKeys.length > 0) {
        const provider = await runRefresh(bootstrapWork, currentTime, durationMs);
        bootstrapQuotes = provider.quotes;
        for (const observation of provider.observations) storedByKey.set(observation.assetKey, observation);
      }
      scheduleRefresh({
        tokenInputs: work.tokenInputs.filter(({ assetKey }) => !bootstrapWork.tokenInputs.some((input) => input.assetKey === assetKey)),
        fxKeys: work.fxKeys.filter((key) => !bootstrapWork.fxKeys.includes(key)),
      });
    } else if (work.tokenInputs.length > 0 || work.fxKeys.length > 0) {
      scheduleRefresh(work);
    }

    const referencesDue = stockFeeds.length > 0 && (stockReferenceAttemptAt === null || nowMs() - stockReferenceAttemptAt >= STOCK_REFERENCE_REFRESH_MS);
    if (stockFeeds.length > 0 && (referencesDue || stockReferencePending !== null)) {
      if (mode === "bootstrap") await startStockReferenceRead(stockFeeds, nowMs());
      else if (referencesDue) scheduleStockRefresh(stockFeeds, nowMs());
    }
    const usableReferences = stockFeeds.length > 0 && stockReferences !== null && nowMs() - stockReferences.at <= STOCK_REFERENCE_MAX_AGE_MS ? stockReferences.byId : null;
    const referencesById = usableReferences ?? new Map<string, TokenizedEquityReference>();
    const referencesDegraded = stockFeeds.length > 0 && listedStockHoldings.some((holding) => {
      const reference = referencesById.get(holding.id);
      return reference === undefined || reference.status === "unavailable";
    });

    const degradedKeys = allKeys.filter((key) => !safeObservation(storedByKey.get(key), currentTime));
    const revalidating = mode === "cached" && (degradedKeys.some((key) => refreshing.has(key)) || referencesDegraded);
    const prices = tokenInputs.map((input) => bootstrapQuotes.find(({ assetKey, status }) =>
      assetKey === input.assetKey && (status === "fresh" || status === "stale"))
      ?? quoteFromObservation(storedByKey.get(input.assetKey), input, currentTime));
    const rates = ratesFromObservations(fxKeys, storedByKey, currentTime);
    const holdings = read.holdings.map((holding) => {
      const asset = holding.source === "registry" ? stocksById.get(holding.id) : undefined;
      return priceHolding(holding, quoteCurrency, prices, rates, currentTime, asset ? { listing: asset.listing, reference: referencesById.get(asset.id) } : undefined);
    });
    const borrow = assembleBorrow(
      read.borrow,
      borrowPairs,
      (holding) => priceHolding(holding, quoteCurrency, prices, rates, currentTime),
    );
    return { holdings, borrow, revalidating, durationMs };
  };

  async function refreshStockReferences(feeds: readonly TokenizedEquityFeed[], attemptAt: number): Promise<void> {
    stockReferenceAttemptAt = attemptAt;
    try {
      const references = await readStockReferences(feeds);
      const usable = references.some((reference) => reference.status !== "unavailable");
      const previousUsable = stockReferences !== null && attemptAt - stockReferences.at <= STOCK_REFERENCE_MAX_AGE_MS;
      if (usable || !previousUsable) stockReferences = { at: attemptAt, byId: new Map(references.map((reference) => [reference.assetId, reference])) };
    } catch { // oxlint-disable-line home/no-silent-catch -- a failed reference read keeps the last good references only while they are still within their usable age, and the next pass retries
    }
  }

  function startStockReferenceRead(feeds: readonly TokenizedEquityFeed[], attemptAt: number): Promise<void> {
    if (stockReferencePending !== null) return stockReferencePending;
    const task: Promise<void> = refreshStockReferences(feeds, attemptAt).finally(() => {
      if (stockReferencePending === task) stockReferencePending = null;
    });
    stockReferencePending = task;
    return task;
  }

  function scheduleStockRefresh(feeds: readonly TokenizedEquityFeed[], attemptAt: number): void {
    if (stockReferencePending !== null || stockReferenceScheduled) return;
    stockReferenceScheduled = true;
    const run = () => {
      stockReferenceScheduled = false;
      return startStockReferenceRead(feeds, attemptAt);
    };
    try {
      schedule(run);
    } catch { // oxlint-disable-line home/no-silent-catch -- a synchronous schedule failure releases the scheduled flag so the next pass retries
      stockReferenceScheduled = false;
    }
  }

  function scheduleRefresh(work: RefreshWork): void {
    const tokenInputs = work.tokenInputs.filter(({ assetKey }) => !refreshing.has(assetKey));
    const fxKeys = work.fxKeys.filter((key) => !refreshing.has(key));
    if (tokenInputs.length === 0 && fxKeys.length === 0) return;
    const keys = [...tokenInputs.map(({ assetKey }) => assetKey), ...fxKeys];
    for (const key of keys) refreshing.add(key);
    const task = async () => {
      const durations = { store: 0, codex: 0, coinbase: 0 };
      let outcome: "ok" | "failed" = "ok";
      try { await runRefresh({ tokenInputs, fxKeys }, now(), durations); }
      catch { outcome = "failed"; }
      finally {
        for (const key of keys) refreshing.delete(key);
        emitServerEvent("balances-valuation", {
          route: "/api/balances",
          code: "VALUATION_BACKGROUND_REFRESH",
          outcome,
          provider: tokenInputs.length > 0 && fxKeys.length > 0 ? "codex-coinbase" : tokenInputs.length > 0 ? "codex" : "coinbase",
          durationMs: durations.store + durations.codex + durations.coinbase,
        });
      }
    };
    try {
      schedule(task);
    } catch { // oxlint-disable-line home/no-silent-catch -- a synchronous schedule failure releases every refresh key, but the ForOfStatement body is not traversed
      for (const key of keys) refreshing.delete(key);
    }
  }

  async function runRefresh(work: RefreshWork, attemptTime: Date, durations: PriceBalancesResult["durationMs"]) {
    const observations: PriceObservation[] = [];
    const attempts: ValuationAttempt[] = [];
    const providerQuotes: PriceQuote[] = [];
    if (work.tokenInputs.length > 0) {
      const started = nowMs();
      const quotes = await fetchPriceInputs(readPrices, work.tokenInputs);
      providerQuotes.push(...quotes);
      durations.codex += Math.max(0, nowMs() - started);
      for (const quote of quotes) {
        attempts.push({ assetKey: quote.assetKey, attemptAt: attemptTime.toISOString(), status: quote.status });
        const observation = observationFromPrice(quote);
        if (observation) observations.push(observation);
      }
    }
    if (work.fxKeys.length > 0) {
      const started = nowMs();
      let rates: ExchangeRates | null = null;
      try { rates = await readExchangeRates(); } catch { rates = null; }
      durations.coinbase += Math.max(0, nowMs() - started);
      const mapped = coinbaseOutcomes(work.fxKeys, rates, attemptTime);
      observations.push(...mapped.observations);
      attempts.push(...mapped.attempts);
    }
    const currentObservations = newestObservations(observations);
    const observationsToWrite = currentObservations.filter((observation) =>
      Date.parse(observation.fetchedAt) >
        (lastWrittenFetchedAt.get(observation.assetKey) ?? Number.NEGATIVE_INFINITY));
    const storeStarted = nowMs();
    const [observationsWritten] = await Promise.all([
      observationsToWrite.length > 0
        ? priceStore.putMany(observationsToWrite).then(() => true, () => false)
        : Promise.resolve(false),
      attempts.length > 0
        ? priceStore.putAttempts?.(attempts).catch(() => undefined) ?? Promise.resolve(undefined)
        : Promise.resolve(undefined),
    ]);
    durations.store += Math.max(0, nowMs() - storeStarted);
    if (observationsWritten) {
      for (const observation of observationsToWrite) {
        lastWrittenFetchedAt.set(observation.assetKey, Date.parse(observation.fetchedAt));
      }
    }
    return { observations: currentObservations, attempts, quotes: providerQuotes };
  }
}

export const priceBalances = createBalancesPricer();

function pricingInputs(holdings: readonly ReadHolding[], stocksById: ReadonlyMap<string, InvestAsset>): CodexRawQuoteInput[] {
  const registry = holdings.filter((holding) => holding.source === "registry" && holding.kind !== "native" && !stocksById.has(holding.id)).map(pricingInput);
  const discovered = holdings.filter((holding) => !(holding.source === "registry" && stocksById.has(holding.id)) && (holding.source === "catalog" || holding.source === "borrow" || holding.marketDataResolved === true) && positivePricingAmount(holding)).map(pricingInput);
  return uniqueInputs([...registry, ...discovered]);
}

function neededFxKeys(holdings: readonly ReadHolding[], quoteCurrency: FiatCurrencyCode | null): string[] {
  const keys = new Set<string>();
  if (holdings.some(positivePricingAmount)) {
    if (quoteCurrency && quoteCurrency !== "USD") keys.add(`${FX_PREFIX}${quoteCurrency}`);
    for (const holding of holdings) {
      if (holding.cashCurrency && holding.cashCurrency !== "USD") keys.add(`${FX_PREFIX}${holding.cashCurrency}`);
      if (holding.kind === "native" && positivePricingAmount(holding)) keys.add(`${FX_PREFIX}ETH`);
    }
  }
  return [...keys];
}

function refreshWork(
  tokenInputs: readonly CodexRawQuoteInput[],
  fxKeys: readonly string[],
  stored: ReadonlyMap<string, PriceObservation>,
  attempts: ReadonlyMap<string, ValuationAttempt>,
  now: Date,
): RefreshWork {
  const due = (key: string) => {
    const observation = stored.get(key);
    const needs = !safeObservation(observation, now) || now.getTime() - Date.parse(observation!.fetchedAt) > BALANCES_PRICE_REFRESH_MS;
    if (!needs) return false;
    const attempt = attempts.get(key);
    if (!attempt) return true;
    const delay = attempt.status === "unavailable" ? BALANCES_NEGATIVE_UNAVAILABLE_MS : attempt.status === "fresh" ? BALANCES_PRICE_REFRESH_MS : BALANCES_NEGATIVE_LONG_MS;
    return now.getTime() - Date.parse(attempt.attemptAt) >= delay;
  };
  return {
    tokenInputs: tokenInputs.filter(({ assetKey }) => due(assetKey)),
    fxKeys: fxKeys.filter(due),
  };
}

function safeObservation(observation: PriceObservation | undefined, now: Date): observation is PriceObservation {
  return Boolean(observation) && now.getTime() - Date.parse(observation!.asOf) <= BALANCES_PRICE_MAX_AGE_MS;
}

function newestObservations(observations: readonly PriceObservation[]): PriceObservation[] {
  const byKey = new Map<string, PriceObservation>();
  for (const observation of observations) {
    const existing = byKey.get(observation.assetKey);
    if (!existing || Date.parse(observation.asOf) > Date.parse(existing.asOf) ||
      (observation.asOf === existing.asOf && Date.parse(observation.fetchedAt) > Date.parse(existing.fetchedAt))) {
      byKey.set(observation.assetKey, observation);
    }
  }
  return [...byKey.values()];
}

function observationFromPrice(price: PriceQuote): PriceObservation | null {
  if (price.status !== "fresh" || !price.unitPrice) return null;
  const asOf = price.source.asOf ?? price.source.fetchedAt;
  return { assetKey: price.assetKey, unitPrice: price.unitPrice, asOf, fetchedAt: price.source.fetchedAt };
}

function coinbaseOutcomes(keys: readonly string[], rates: ExchangeRates | null, now: Date) {
  const observations: PriceObservation[] = [];
  const attempts: ValuationAttempt[] = [];
  for (const key of keys) {
    const suffix = key.slice(FX_PREFIX.length);
    const quote = suffix === "ETH" ? rates?.nativeEthQuote : rates?.quotes.find(({ quoteCurrency }) => quoteCurrency === suffix);
    const status: ValuationAttemptStatus = rates === null ? "unavailable" : quote?.status ?? "missing";
    attempts.push({ assetKey: key, attemptAt: now.toISOString(), status });
    const value = suffix === "ETH" ? (quote as NativeEthQuote | undefined)?.assetUnitsPerUsd : (quote as FxQuote | undefined)?.quoteUnitsPerUsd;
    if (status === "fresh" && value && quote) {
      observations.push({ assetKey: key, unitPrice: value, asOf: quote.source.asOf ?? quote.source.fetchedAt, fetchedAt: quote.source.fetchedAt });
    }
  }
  return { observations, attempts };
}

function ratesFromObservations(keys: readonly string[], stored: ReadonlyMap<string, PriceObservation>, now: Date): ExchangeRates | null {
  const source = (observation: PriceObservation) => ({ provider: "Coinbase Exchange Rates" as const, method: "Stored exchange-rate observation", fetchedAt: observation.fetchedAt, asOf: observation.asOf, timeBasis: "provider-as-of" as const });
  const quotes: FxQuote[] = [{ baseCurrency: "USD", quoteCurrency: "USD", quoteUnitsPerUsd: { atoms: "1", scale: 0 }, sourceValue: "1", status: "fresh", source: { provider: "Coinbase Exchange Rates", method: "USD arithmetic identity", fetchedAt: now.toISOString(), asOf: now.toISOString(), timeBasis: "retrieved-at" } }];
  let nativeEthQuote: NativeEthQuote = { baseCurrency: "USD", assetSymbol: "ETH", assetUnitsPerUsd: null, sourceValue: null, status: "missing", source: quotes[0]!.source };
  for (const key of keys) {
    const observation = stored.get(key);
    if (!safeObservation(observation, now)) continue;
    const suffix = key.slice(FX_PREFIX.length);
    if (suffix === "ETH") nativeEthQuote = { baseCurrency: "USD", assetSymbol: "ETH", assetUnitsPerUsd: observation.unitPrice, sourceValue: null, status: "fresh", source: source(observation) };
    else quotes.push({ baseCurrency: "USD", quoteCurrency: suffix as FiatCurrencyCode, quoteUnitsPerUsd: observation.unitPrice, sourceValue: null, status: "fresh", source: source(observation) });
  }
  return { fetchedAt: now.toISOString(), quotes, nativeEthQuote };
}

function priceHolding(holding: ReadHolding, quoteCurrency: FiatCurrencyCode | null, prices: readonly PriceQuote[], rates: ExchangeRates | null, currentTime: Date, stock?: StockHolding): Holding {
  const base: Omit<Holding, "value"> = { key: holding.key, id: holding.id, kind: holding.kind, source: holding.source, name: holding.name, symbol: holding.symbol, decimals: holding.decimals, contractAddress: holding.contractAddress, cashCurrency: holding.cashCurrency, ...(holding.imageUrl ? { imageUrl: holding.imageUrl } : {}), ...(holding.underlying ? { underlying: holding.underlying } : {}), balance: holding.balance, ...(holding.underlyingBalance ? { underlyingBalance: holding.underlyingBalance } : {}) };
  if (holding.balance.status === "unavailable") return { ...base, value: { status: "unavailable" }, ...(holding.cashCurrency ? { cashValue: { status: "unavailable" } as HoldingCashValue } : {}) };
  if (quoteCurrency === null) return { ...base, value: { status: "unpriced", reason: "no-quote-currency" }, ...(holding.cashCurrency ? { cashValue: priceCash(holding, prices, rates) } : {}) };
  if (holding.source === "wallet" && holding.marketDataResolved !== true) return { ...base, value: { status: "unpriced", reason: "below-market-gate" } };
  const valuation = valueFraction(holding, quoteCurrency, prices, rates, currentTime, stock);
  const value: HoldingValue = valuation.fraction
    ? { status: "priced", currency: quoteCurrency, amount: roundFractionPreservingPositive(valuation.fraction), asOf: valuation.asOf, ...(valuation.reference ? { reference: valuation.reference } : {}) }
    : { status: "unpriced", reason: valuation.reason };
  const unitValue = value.status === "priced" && holding.balance.baseUnits !== "0"
    ? priceUnit(holding, quoteCurrency, prices, rates, stock?.reference)
    : undefined;
  return { ...base, value, ...(unitValue ? { unitValue } : {}), ...(holding.cashCurrency ? { cashValue: priceCash(holding, prices, rates) } : {}) };
}

function priceUnit(holding: ReadHolding, currency: FiatCurrencyCode, prices: readonly PriceQuote[], rates: ExchangeRates | null, stockReference?: TokenizedEquityReference): Holding["unitValue"] {
  if (holding.kind === "vault-share") return undefined;
  const fx = findFx(rates, currency);
  if (!fx) return undefined;
  let amount: ExactDecimal;
  if (holding.kind === "native") {
    const native = rates?.nativeEthQuote;
    if (native?.status !== "fresh" || !native.assetUnitsPerUsd || native.assetUnitsPerUsd.atoms === "0") return undefined;
    const ratio = divideFractions(exactDecimalToFraction(fx.quoteUnitsPerUsd!), exactDecimalToFraction(native.assetUnitsPerUsd));
    amount = normalizeUnitDecimal({ atoms: (ratio.numerator * BigInt(10) ** BigInt(18) / ratio.denominator).toString(), scale: 18 });
  } else {
    const unitPrice = stockReference?.status === "open" || stockReference?.status === "closed"
      ? stockReference.price
      : prices.find(({ assetKey }) => assetKey === holding.key)?.unitPrice;
    if (!unitPrice) return undefined;
    amount = normalizeUnitDecimal({
      atoms: (BigInt(unitPrice.atoms) * BigInt(fx.quoteUnitsPerUsd!.atoms)).toString(),
      scale: unitPrice.scale + fx.quoteUnitsPerUsd!.scale,
    });
  }
  return amount.atoms === "0" || amount.scale > 100 ? undefined : { currency, amount };
}

function normalizeUnitDecimal(amount: ExactDecimal): ExactDecimal {
  let { atoms, scale } = amount;
  while (scale > 0 && atoms.endsWith("0")) {
    atoms = atoms.slice(0, -1);
    scale -= 1;
  }
  return { atoms, scale };
}

function valueFraction(holding: ReadHolding, currency: FiatCurrencyCode, prices: readonly PriceQuote[], rates: ExchangeRates | null, currentTime: Date, stock?: StockHolding): Valuation {
  const amount = holding.kind === "vault-share" ? holding.underlyingBalance : holding.balance;
  const decimals = holding.kind === "vault-share" ? holding.underlying!.decimals : holding.decimals;
  if (amount?.status !== "ready") return failed("price-unavailable", currentTime);
  const quantity = baseUnitsToFraction(amount.baseUnits, decimals);
  if (quantity.numerator === BigInt(0)) return { fraction: ZERO, reason: "price-unavailable", asOf: currentTime.toISOString() };
  if (stock) {
    if (stock.listing === "removed") return failed("asset-removed", currentTime);
    const reference = stock.reference;
    if (reference?.status === "paused") return failed("price-paused", currentTime);
    if (reference?.status === "stale") return failed("price-stale", currentTime);
    if (reference?.status !== "open" && reference?.status !== "closed") return failed("price-unavailable", currentTime);
    const fx = findFx(rates, currency);
    if (!fx) return failed("fx-unavailable", currentTime);
    return {
      fraction: multiplyFractions(quantity, exactDecimalToFraction(reference.price), exactDecimalToFraction(fx.quoteUnitsPerUsd!)),
      reason: "price-unavailable",
      asOf: reference.updatedAt,
      reference: { kind: "tokenized-equity", session: reference.status },
    };
  }
  const fx = findFx(rates, currency);
  if (!fx) return failed("fx-unavailable", currentTime);
  const fxFraction = exactDecimalToFraction(fx.quoteUnitsPerUsd!);
  if (holding.kind === "native") {
    const native = rates?.nativeEthQuote;
    if (native?.status !== "fresh" || !native.assetUnitsPerUsd) return failed("price-unavailable", currentTime);
    return { fraction: multiplyFractions(divideFractions(quantity, exactDecimalToFraction(native.assetUnitsPerUsd)), fxFraction), reason: "price-unavailable", asOf: oldestAsOf(native, fx) };
  }
  const pricingKey = holding.kind === "vault-share" ? holding.underlying!.key : holding.key;
  const price = prices.find(({ assetKey }) => assetKey === pricingKey);
  if (price?.status === "stale") return failed("price-stale", currentTime);
  if (price?.status !== "fresh" || !price.unitPrice) return failed("price-unavailable", currentTime);
  if ((holding.source === "catalog" || holding.source === "wallet") && !meetsGate(holding.liquidityUsd, LIQUIDITY_GATE)) return failed("below-market-gate", currentTime);
  return { fraction: multiplyFractions(quantity, exactDecimalToFraction(price.unitPrice), fxFraction), reason: "price-unavailable", asOf: oldestAsOf(price, fx) };
}

function priceCash(holding: ReadHolding, prices: readonly PriceQuote[], rates: ExchangeRates | null): HoldingCashValue {
  if (holding.balance.status === "unavailable") return { status: "unavailable" };
  const quantity = baseUnitsToFraction(holding.balance.baseUnits, holding.decimals);
  if (quantity.numerator === BigInt(0)) return { status: "priced", currency: holding.cashCurrency!, amount: roundFractionPreservingPositive(ZERO) };
  const price = prices.find(({ assetKey }) => assetKey === holding.key);
  if (price?.status === "stale") return { status: "unpriced", reason: "price-stale" };
  if (price?.status !== "fresh" || !price.unitPrice) return { status: "unpriced", reason: "price-unavailable" };
  const fx = findFx(rates, holding.cashCurrency!);
  if (!fx) return { status: "unpriced", reason: "fx-unavailable" };
  return { status: "priced", currency: holding.cashCurrency!, amount: roundFractionPreservingPositive(multiplyFractions(quantity, exactDecimalToFraction(price.unitPrice), exactDecimalToFraction(fx.quoteUnitsPerUsd!))) };
}

function pricingInput(holding: ReadHolding): CodexRawQuoteInput {
  const key = holding.kind === "vault-share" ? holding.underlying!.key : holding.key;
  const address = holding.kind === "vault-share" ? holding.underlying!.key.split(":").at(-1)! : holding.contractAddress!;
  return { assetKey: key as `eip155:8453/erc20:${string}`, address: address as `0x${string}`, networkId: 8453 };
}
function uniqueInputs(inputs: readonly CodexRawQuoteInput[]) { return [...new Map(inputs.map((input) => [input.assetKey, input])).values()]; }
async function fetchPriceInputs(readPrices: NonNullable<Dependencies["readPrices"]>, inputs: readonly CodexRawQuoteInput[]): Promise<PriceQuote[]> {
  const batches: CodexRawQuoteInput[][] = [];
  for (let index = 0; index < inputs.length; index += PRICE_BATCH_SIZE) batches.push(inputs.slice(index, index + PRICE_BATCH_SIZE));
  return (await mapWithConcurrency(batches, BALANCES_PRICE_CONCURRENCY, (batch) => readPriceBatch(readPrices, batch))).flat();
}
export async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number, map: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length); let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => { while (nextIndex < values.length) { const index = nextIndex++; results[index] = await map(values[index]!, index); } });
  await Promise.all(workers); return results;
}
async function readPriceBatch(readPrices: NonNullable<Dependencies["readPrices"]>, inputs: readonly CodexRawQuoteInput[]) {
  try { return await readPrices(inputs, { freshnessMs: BALANCES_PRICE_MAX_AGE_MS }); }
  catch { return unavailablePrices(inputs); }
}
function positivePricingAmount(holding: ReadHolding) { const amount = holding.kind === "vault-share" ? holding.underlyingBalance : holding.balance; return amount?.status === "ready" && BigInt(amount.baseUnits) > BigInt(0); }
function findFx(rates: ExchangeRates | null, currency: FiatCurrencyCode) { const fx = rates?.quotes.find(({ quoteCurrency }) => quoteCurrency === currency); return fx?.status === "fresh" && fx.quoteUnitsPerUsd ? fx : null; }
function meetsGate(decimal: ExactDecimal | undefined, threshold: Fraction) { if (!decimal) return false; const value = exactDecimalToFraction(decimal); return value.numerator * threshold.denominator >= threshold.numerator * value.denominator; }
function failed(reason: Valuation["reason"], currentTime: Date): Valuation { return { fraction: null, reason, asOf: currentTime.toISOString() }; }
function oldestAsOf(...quotes: Array<PriceQuote | NativeEthQuote | FxQuote>) { return quotes.map((quote) => quote.source.asOf ?? quote.source.fetchedAt).sort()[0]!; }
function quoteFromObservation(observation: PriceObservation | undefined, input: CodexRawQuoteInput, currentTime: Date): PriceQuote {
  if (!observation) return unavailablePrices([input])[0]!;
  const stale = !safeObservation(observation, currentTime);
  return { assetKey: input.assetKey, contractAddress: input.address, quoteCurrency: "USD", unitPrice: observation.unitPrice, sourceValue: null, status: stale ? "stale" : "fresh", source: { provider: "Codex", method: "Stored price observation", fetchedAt: observation.fetchedAt, asOf: observation.asOf, timeBasis: "provider-as-of" } };
}
function unavailablePrices(inputs: readonly CodexRawQuoteInput[]): PriceQuote[] { const fetchedAt = new Date().toISOString(); return inputs.map((input) => ({ ...input, contractAddress: input.address, quoteCurrency: "USD", unitPrice: null, sourceValue: null, status: "unavailable", source: { provider: "Codex", method: "Exact-contract token prices", fetchedAt, asOf: null, timeBasis: "retrieved-at" } })); }
