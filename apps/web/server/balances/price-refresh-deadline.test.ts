import { afterEach, beforeEach, expect, jest, mock, setSystemTime, test } from "bun:test";
import { stockAssets, type InvestAsset } from "@/config/invest-assets";
import type { TokenizedEquityFeed, TokenizedEquityReference } from "@/server/market-data/tokenized-equity/reader";
import type { CodexRawQuoteInput } from "@/server/market-data/codex/raw-quotes";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { PriceQuote } from "@/shared/balances/quotes";
import { createBalancesPricer } from "./price";
import type { getCoinbaseExchangeRates } from "./fx-coinbase";
import type { PriceObservation, PriceObservationStore, ValuationAttempt } from "./price-observation-store";
import type { BalancesRead, ReadHolding } from "./types";

const AT = "2026-09-13T12:00:00.000Z";
const source = { provider: "Codex" as const, method: "test", fetchedAt: AT, asOf: AT, timeBasis: "provider-as-of" as const };

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date(AT));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
  setObservabilityLogWriterForTests();
});

function inventory(count: number): BalancesRead {
  const holdings: ReadHolding[] = Array.from({ length: count }, (_, index) => {
    const address = `0x${(index + 1).toString(16).padStart(40, "0")}` as const;
    return {
      key: `eip155:8453/erc20:${address}`, id: `token:${index}`, kind: "erc20", source: "registry",
      name: "Token", symbol: "TOKEN", decimals: 6, contractAddress: address, cashCurrency: null,
      balance: { status: "ready", baseUnits: "1000000" },
    };
  });
  return {
    block: { number: "1", hash: `0x${"1".repeat(64)}`, timestamp: "1" }, observedAt: AT, holdings,
    coverage: { registry: "complete", catalog: "complete" },
  };
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing fixture item ${index}`);
  return value;
}

function quotes(inputs: readonly CodexRawQuoteInput[]): PriceQuote[] {
  return inputs.map(({ assetKey, address }) => ({
    assetKey, contractAddress: address, quoteCurrency: "USD", unitPrice: { atoms: "1", scale: 0 },
    sourceValue: "1", status: "fresh", source,
  }));
}

function stockInventory(asset: InvestAsset): BalancesRead {
  return {
    ...inventory(0),
    holdings: [{
      key: `eip155:8453/erc20:${asset.contractAddress.toLowerCase()}`, id: asset.id, kind: "erc20", source: "registry",
      name: asset.displayName, symbol: asset.representation.tokenSymbol, decimals: asset.representation.decimals ?? 8,
      contractAddress: asset.contractAddress, cashCurrency: null,
      balance: { status: "ready", baseUnits: "100000000" },
    }],
  };
}

function fixture(configuredStocks: readonly InvestAsset[] = []) {
  const clock = { ms: 0 };
  const observations: PriceObservation[] = [];
  const attempts: ValuationAttempt[] = [];
  const checkpoint = Promise.withResolvers<void>();
  const scheduled: Array<() => Promise<unknown>> = [];
  const tokenReads: Array<{ inputs: readonly CodexRawQuoteInput[]; result: ReturnType<typeof Promise.withResolvers<PriceQuote[]>>; signal?: AbortSignal }> = [];
  const fx = Promise.withResolvers<Awaited<ReturnType<typeof getCoinbaseExchangeRates>>>();
  let fxCalls = 0;
  const events: Array<Record<string, unknown>> = [];
  setObservabilityLogWriterForTests((line) => {
    const event: unknown = JSON.parse(line);
    if (typeof event === "object" && event !== null && "code" in event && "outcome" in event) {
      events.push({ code: event.code, outcome: event.outcome });
    }
  });
  const priceStore: PriceObservationStore = {
    getMany: async (keys) => observations.filter(({ assetKey }) => keys.includes(assetKey)),
    getAttempts: async (keys) => attempts.filter(({ assetKey }) => keys.includes(assetKey)),
    putMany: async (values) => { observations.push(...values); },
    putAttempts: async (values) => { attempts.push(...values); checkpoint.resolve(); },
  };
  const readStockReferences = mock(async (_feeds: readonly TokenizedEquityFeed[]): Promise<TokenizedEquityReference[]> => []);
  const price = createBalancesPricer({
    priceStore, refreshWindowMs: 30_000, stockAssets: configuredStocks, readStockReferences,
    now: () => new Date(Date.parse(AT) + clock.ms), nowMs: () => clock.ms,
    schedule: (task) => { scheduled.push(typeof task === "function" ? task : () => task); },
    readPrices: (inputs, options) => {
      const result = Promise.withResolvers<PriceQuote[]>();
      tokenReads.push({ inputs, result, signal: options?.signal });
      return result.promise;
    },
    readExchangeRates: () => { fxCalls += 1; return fx.promise; },
  });
  return { clock, price, scheduled, tokenReads, readStockReferences, observations, attempts, checkpoint, events, fx, fxCalls: () => fxCalls };
}

test("background token deadline preserves completed batches but leaves unfinished keys due for the next request", async () => {
  const f = fixture();
  const read = inventory(26);
  f.clock.ms = 20_000;
  await f.price(read, "US", "cached", undefined, 1_000);
  f.clock.ms = 24_000;
  let finished = false;
  const refresh = at(f.scheduled, 0)().then(() => { finished = true; });
  expect(f.tokenReads.map(({ inputs }) => inputs.length)).toEqual([25, 1]);
  at(f.tokenReads, 0).result.resolve(quotes(at(f.tokenReads, 0).inputs));
  await f.checkpoint.promise;
  expect(f.observations.map(({ assetKey }) => assetKey)).toEqual(read.holdings.slice(0, 25).map(({ key }) => key));
  expect(f.attempts.map(({ status }) => status)).toEqual(Array(25).fill("fresh"));
  jest.advanceTimersByTime(3_999);
  await Promise.resolve();
  expect(finished).toBe(false);
  f.clock.ms = 28_000;
  jest.advanceTimersByTime(1);
  await refresh;
  expect(at(f.tokenReads, 1).signal?.aborted).toBe(true);
  expect(f.observations).toHaveLength(25);
  expect(f.attempts).toHaveLength(25);
  expect(f.events).toEqual([expect.objectContaining({ code: "VALUATION_BACKGROUND_REFRESH", outcome: "ok" })]);
  expect(f.scheduled).toHaveLength(1);
  at(f.tokenReads, 1).result.resolve(quotes(at(f.tokenReads, 1).inputs));
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.observations).toHaveLength(25);
  expect(f.attempts).toHaveLength(25);
  await f.price(read, "US", "cached");
  expect(f.scheduled).toHaveLength(2);
  const retry = at(f.scheduled, 1)();
  expect(at(f.tokenReads, 2).inputs.map(({ assetKey }) => String(assetKey))).toEqual([at(read.holdings, 25).key]);
  at(f.tokenReads, 2).result.resolve(quotes(at(f.tokenReads, 2).inputs));
  await retry;
});

test("a background task starting after its deadline skips providers and writes and releases its keys", async () => {
  const f = fixture();
  await f.price(inventory(1), "DE", "cached");
  f.clock.ms = 27_001;
  await at(f.scheduled, 0)();
  expect(f.tokenReads).toEqual([]);
  expect(f.fxCalls()).toBe(0);
  expect(f.observations).toEqual([]);
  expect(f.attempts).toEqual([]);
  expect(f.events).toEqual([expect.objectContaining({ code: "VALUATION_BACKGROUND_REFRESH", outcome: "skipped" })]);
  await f.price(inventory(1), "DE", "cached");
  expect(f.scheduled).toHaveLength(2);
});

test("background FX is left due without an attempt when its timeout does not fit", async () => {
  const f = fixture();
  await f.price(inventory(1), "DE", "cached");
  f.clock.ms = 21_001;
  const refresh = at(f.scheduled, 0)();
  expect(f.fxCalls()).toBe(0);
  jest.advanceTimersByTime(5_999);
  await refresh;
  expect(f.observations).toEqual([]);
  expect(f.attempts).toEqual([]);
  await f.price(inventory(1), "DE", "cached");
  expect(f.scheduled).toHaveLength(2);
  const retry = at(f.scheduled, 1)();
  expect(f.fxCalls()).toBe(1);
  f.fx.reject(new Error("FX unavailable"));
  jest.advanceTimersByTime(27_000);
  await retry;
});

test("background FX whose timeout fits persists while token pricing is still pending", async () => {
  const f = fixture();
  await f.price(inventory(1), "DE", "cached");
  f.clock.ms = 21_000;
  let finished = false;
  const refresh = at(f.scheduled, 0)().then(() => { finished = true; });
  expect(f.fxCalls()).toBe(1);
  expect(f.tokenReads).toHaveLength(1);
  f.fx.resolve({
    fetchedAt: AT,
    quotes: [{ baseCurrency: "USD", quoteCurrency: "EUR", quoteUnitsPerUsd: { atoms: "9", scale: 1 }, sourceValue: "0.9", status: "fresh", source: { ...source, provider: "Coinbase Exchange Rates" } }],
    nativeEthQuote: { baseCurrency: "USD", assetSymbol: "ETH", assetUnitsPerUsd: null, sourceValue: null, status: "missing", source: { ...source, provider: "Coinbase Exchange Rates" } },
  });
  await f.checkpoint.promise;
  expect(finished).toBe(false);
  expect(f.observations).toEqual([{ assetKey: "fx:USD:EUR", unitPrice: { atoms: "9", scale: 1 }, asOf: AT, fetchedAt: AT }]);
  expect(f.attempts).toEqual([{ assetKey: "fx:USD:EUR", attemptAt: "2026-09-13T12:00:21.000Z", status: "fresh" }]);
  jest.advanceTimersByTime(6_000);
  await refresh;
  expect(f.observations).toHaveLength(1);
  expect(f.attempts).toHaveLength(1);
});

test("background stock references stay due when their timeout does not fit the request deadline", async () => {
  const asset = at(stockAssets, 0);
  const f = fixture([asset]);
  const read = stockInventory(asset);
  f.clock.ms = 20_000;
  await f.price(read, "US", "cached", undefined, 1_000);
  expect(f.scheduled).toHaveLength(1);
  f.clock.ms = 25_501;
  await at(f.scheduled, 0)();
  expect(f.readStockReferences).not.toHaveBeenCalled();
  await f.price(read, "US", "cached");
  expect(f.scheduled).toHaveLength(2);
  await at(f.scheduled, 1)();
  expect(f.readStockReferences).toHaveBeenCalledTimes(1);
  expect(f.readStockReferences).toHaveBeenCalledWith([{
    assetId: asset.id,
    token: asset.contractAddress,
    feedProxy: asset.valuation.feedProxy,
    feedDecimals: asset.valuation.feedDecimals,
    heartbeatSeconds: asset.valuation.heartbeatSeconds,
  }]);
});

test("background stock references run once when their timeout fits exactly", async () => {
  const asset = at(stockAssets, 0);
  const f = fixture([asset]);
  const read = stockInventory(asset);
  f.clock.ms = 20_000;
  await f.price(read, "US", "cached", undefined, 1_000);
  expect(f.scheduled).toHaveLength(1);
  f.clock.ms = 25_500;
  await at(f.scheduled, 0)();
  expect(f.readStockReferences).toHaveBeenCalledTimes(1);
  await f.price(read, "US", "cached");
  expect(f.scheduled).toHaveLength(1);
  expect(f.readStockReferences).toHaveBeenCalledTimes(1);
});
