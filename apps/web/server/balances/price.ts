import "server-only";

import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import { emitServerEvent } from "@/server/observability/log";
import {
  getCodexRawQuotes,
  type CodexRawQuoteInput,
} from "@/server/market-data/codex/raw-quotes";
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
import type { FxQuote, NativeEthQuote, PriceQuote } from "@/shared/balances/quotes";
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
export const BALANCES_NEGATIVE_UNAVAILABLE_MS = 60_000;
export const BALANCES_NEGATIVE_LONG_MS = 15 * 60_000;
const LIQUIDITY_GATE = { numerator: BigInt(25_000), denominator: BigInt(1) };
const ZERO: Fraction = { numerator: BigInt(0), denominator: BigInt(1) };
const FX_PREFIX = "fx:USD:";

type ExchangeRates = Awaited<ReturnType<typeof getCoinbaseExchangeRates>>;
export type ValuationMode = "cached" | "bootstrap";
export type PriceBalancesResult = {
  holdings: Holding[];
  revalidating: boolean;
  durationMs: { store: number; codex: number; coinbase: number };
};
type Dependencies = {
  readPrices?: (inputs: readonly CodexRawQuoteInput[], options?: { freshnessMs?: number }) => Promise<PriceQuote[]>;
  readExchangeRates?: () => Promise<ExchangeRates>;
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
  const priceStore = dependencies.priceStore ?? getPriceObservationStore();
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? (() => Date.now());
  const schedule = dependencies.schedule ?? ((task) => { void (typeof task === "function" ? task() : task); });
  const refreshing = new Set<string>();
  const lastWrittenFetchedAt = new Map<string, number>();

  return async function priceRead(
    read: BalancesRead,
    region: RegionId,
    mode: ValuationMode = "bootstrap",
  ): Promise<PriceBalancesResult> {
    const startedStore = nowMs();
    const currentTime = now();
    const quoteCurrency = presentationRegions[region].currency.code;
    const tokenInputs = pricingInputs(read.holdings);
    const fxKeys = neededFxKeys(read.holdings, quoteCurrency);
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

    const degradedKeys = allKeys.filter((key) => !safeObservation(storedByKey.get(key), currentTime));
    const revalidating = mode === "cached" && degradedKeys.some((key) => refreshing.has(key));
    const prices = tokenInputs.map((input) => bootstrapQuotes.find(({ assetKey, status }) =>
      assetKey === input.assetKey && (status === "fresh" || status === "stale"))
      ?? quoteFromObservation(storedByKey.get(input.assetKey), input, currentTime));
    const rates = ratesFromObservations(fxKeys, storedByKey, currentTime);
    const holdings = read.holdings.map((holding) => priceHolding(holding, quoteCurrency, prices, rates, currentTime));
    return { holdings, revalidating, durationMs };
  };

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
    try { schedule(task); } catch { for (const key of keys) refreshing.delete(key); }
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

function pricingInputs(holdings: readonly ReadHolding[]): CodexRawQuoteInput[] {
  const registry = holdings.filter((holding) => holding.source === "registry" && holding.kind !== "native").map(pricingInput);
  const discovered = holdings.filter((holding) => (holding.source === "catalog" || holding.marketDataResolved === true) && positivePricingAmount(holding)).map(pricingInput);
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

function priceHolding(holding: ReadHolding, quoteCurrency: FiatCurrencyCode | null, prices: readonly PriceQuote[], rates: ExchangeRates | null, currentTime: Date): Holding {
  const base: Omit<Holding, "value"> = { key: holding.key, id: holding.id, kind: holding.kind, source: holding.source, name: holding.name, symbol: holding.symbol, decimals: holding.decimals, contractAddress: holding.contractAddress, cashCurrency: holding.cashCurrency, ...(holding.imageUrl ? { imageUrl: holding.imageUrl } : {}), ...(holding.underlying ? { underlying: holding.underlying } : {}), balance: holding.balance, ...(holding.underlyingBalance ? { underlyingBalance: holding.underlyingBalance } : {}) };
  if (holding.balance.status === "unavailable") return { ...base, value: { status: "unavailable" }, ...(holding.cashCurrency ? { cashValue: { status: "unavailable" } as HoldingCashValue } : {}) };
  if (quoteCurrency === null) return { ...base, value: { status: "unpriced", reason: "no-quote-currency" }, ...(holding.cashCurrency ? { cashValue: priceCash(holding, prices, rates) } : {}) };
  if (holding.source === "wallet" && holding.marketDataResolved !== true) return { ...base, value: { status: "unpriced", reason: "below-market-gate" } };
  const valuation = valueFraction(holding, quoteCurrency, prices, rates, currentTime);
  const value: HoldingValue = valuation.fraction ? { status: "priced", currency: quoteCurrency, amount: roundFractionPreservingPositive(valuation.fraction), asOf: valuation.asOf } : { status: "unpriced", reason: valuation.reason };
  return { ...base, value, ...(holding.cashCurrency ? { cashValue: priceCash(holding, prices, rates) } : {}) };
}

function valueFraction(holding: ReadHolding, currency: FiatCurrencyCode, prices: readonly PriceQuote[], rates: ExchangeRates | null, currentTime: Date): { fraction: Fraction | null; reason: "price-unavailable" | "price-stale" | "fx-unavailable" | "below-market-gate"; asOf: string } {
  const amount = holding.kind === "vault-share" ? holding.underlyingBalance : holding.balance;
  const decimals = holding.kind === "vault-share" ? holding.underlying!.decimals : holding.decimals;
  if (amount?.status !== "ready") return failed("price-unavailable", currentTime);
  const quantity = baseUnitsToFraction(amount.baseUnits, decimals);
  if (quantity.numerator === BigInt(0)) return { fraction: ZERO, reason: "price-unavailable", asOf: currentTime.toISOString() };
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
function failed(reason: "price-unavailable" | "price-stale" | "fx-unavailable" | "below-market-gate", currentTime: Date) { return { fraction: null, reason, asOf: currentTime.toISOString() } as const; }
function oldestAsOf(...quotes: Array<PriceQuote | NativeEthQuote | FxQuote>) { return quotes.map((quote) => quote.source.asOf ?? quote.source.fetchedAt).sort()[0]!; }
function quoteFromObservation(observation: PriceObservation | undefined, input: CodexRawQuoteInput, currentTime: Date): PriceQuote {
  if (!observation) return unavailablePrices([input])[0]!;
  const stale = !safeObservation(observation, currentTime);
  return { assetKey: input.assetKey, contractAddress: input.address, quoteCurrency: "USD", unitPrice: observation.unitPrice, sourceValue: null, status: stale ? "stale" : "fresh", source: { provider: "Codex", method: "Stored price observation", fetchedAt: observation.fetchedAt, asOf: observation.asOf, timeBasis: "provider-as-of" } };
}
function unavailablePrices(inputs: readonly CodexRawQuoteInput[]): PriceQuote[] { const fetchedAt = new Date().toISOString(); return inputs.map((input) => ({ ...input, contractAddress: input.address, quoteCurrency: "USD", unitPrice: null, sourceValue: null, status: "unavailable", source: { provider: "Codex", method: "Exact-contract token prices", fetchedAt, asOf: null, timeBasis: "retrieved-at" } })); }
