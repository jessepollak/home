import { describe, expect, test } from "bun:test";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import type { TokenizedEquityReference } from "@/server/market-data/tokenized-equity/reader";
import { createCodexRawQuotesReader } from "@/server/market-data/codex/raw-quotes";
import type { PriceQuote } from "@/shared/balances/quotes";
import {
  BALANCES_PRICE_CONCURRENCY,
  createBalancesPricer,
  mapWithConcurrency,
  STOCK_REFERENCE_MAX_AGE_MS,
  STOCK_REFERENCE_REFRESH_MS,
} from "./price";
import { BORROW_MARKETS, DEFAULT_BORROW_MARKET } from "@/shared/borrowing/config";
import { exactDecimalToFraction } from "@/shared/balances/math";
import type { Holding } from "@/shared/balances/types";
import type { BalancesRead, ReadHolding } from "./types";
import { MemoryPriceObservationStore } from "./memory-price-observation-store";
import type { PriceObservation, PriceObservationStore } from "./price-observation-store";

const source = {
  provider: "Codex" as const,
  method: "test",
  fetchedAt: "2026-09-13T12:00:00.000Z",
  asOf: "2026-09-13T11:59:00.000Z",
  timeBasis: "provider-as-of" as const,
};

function holding(
  address: string,
  id: string,
  sourceKind: "registry" | "catalog" | "wallet",
  options: {
    cash?: "USD";
    liquidity?: string | null;
    baseUnits?: string;
    marketDataResolved?: true;
  } = {},
): ReadHolding {
  return {
    key: `eip155:8453/erc20:${address}`,
    id,
    kind: "erc20",
    source: sourceKind,
    name: id,
    symbol: id.toUpperCase(),
    decimals: 6,
    contractAddress: address as `0x${string}`,
    cashCurrency: options.cash ?? null,
    balance: {
      status: "ready",
      baseUnits: options.baseUnits ?? "1000000",
    },
    ...(
      sourceKind === "catalog" || options.marketDataResolved
        ? {
            liquidityUsd: options.liquidity === null
              ? undefined
              : { atoms: options.liquidity ?? "100000", scale: 0 },
          }
        : {}
    ),
    ...(options.marketDataResolved ? { marketDataResolved: true as const } : {}),
  };
}

const usdc = holding(
  "0x1111111111111111111111111111111111111111",
  "usdc",
  "registry",
  { cash: "USD" },
);
const dust = holding(
  "0x2222222222222222222222222222222222222222",
  "catalog:dust",
  "catalog",
  { liquidity: "25000" },
);
const stale = holding(
  "0x3333333333333333333333333333333333333333",
  "catalog:stale",
  "catalog",
);
const read: BalancesRead = {
  block: {
    number: "1",
    hash: `0x${"1".repeat(64)}`,
    timestamp: "1",
  },
  observedAt: "2026-09-13T12:00:00.000Z",
  holdings: [usdc, dust, stale],
  coverage: {
    registry: "complete",
    catalog: "complete",
  },
};

function quote(
  assetKey: string,
  status: PriceQuote["status"],
): PriceQuote {
  return {
    assetKey: assetKey as PriceQuote["assetKey"],
    contractAddress: assetKey.split(":").at(-1) as `0x${string}`,
    quoteCurrency: "USD",
    unitPrice: status === "fresh" ? { atoms: "1", scale: 0 } : null,
    sourceValue: "1",
    status,
    source,
  };
}

function createTestPricer(
  options: Parameters<typeof createBalancesPricer>[0] = {},
) {
  return createBalancesPricer({
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    ...options,
    priceStore: options.priceStore ?? new MemoryPriceObservationStore(),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function rates(includeEur = true) {
  return {
    fetchedAt: source.fetchedAt,
    quotes: [
      {
        baseCurrency: "USD",
        quoteCurrency: "USD",
        quoteUnitsPerUsd: { atoms: "1", scale: 0 },
        sourceValue: "1",
        status: "fresh",
        source,
      },
      ...(includeEur
        ? [{
            baseCurrency: "USD" as const,
            quoteCurrency: "EUR" as const,
            quoteUnitsPerUsd: { atoms: "9", scale: 1 },
            sourceValue: "0.9",
            status: "fresh" as const,
            source,
          }]
        : []),
    ],
    nativeEthQuote: {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: { atoms: "1", scale: 3 },
      sourceValue: "0.001",
      status: "fresh",
      source,
    },
  } as never;
}

describe("balances pricing", () => {
  test("checkpoints background waves before continuing and a new pricer resumes only unfinished keys", async () => {
    const holdings = Array.from({ length: 225 }, (_, index) =>
      holding(`0x${(index + 1).toString(16).padStart(40, "0")}`, `token:${index}`, "registry"));
    const keys = holdings.map(({ key }) => key);
    const priceStore = new MemoryPriceObservationStore();
    const scheduled: Array<() => Promise<unknown>> = [];
    const gates = Array.from({ length: 9 }, () => deferred<PriceQuote[]>());
    const started = Array.from({ length: 8 }, () => deferred<void>());
    const checkpoints: Array<{ observations: number; attempts: number }> = [];
    let calls = 0;
    let active = 0;
    let maximum = 0;
    const price = createTestPricer({
      priceStore,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async () => {
        const index = calls++;
        active += 1;
        maximum = Math.max(maximum, active);
        if (index >= 4) checkpoints.push({
          observations: (await priceStore.getMany(keys)).length,
          attempts: (await priceStore.getAttempts(keys)).length,
        });
        started[index]?.resolve();
        const result = await gates[index]!.promise;
        active -= 1;
        return result;
      },
    });
    await price({ ...read, holdings }, "US", "cached");
    void scheduled[0]!();
    await started[3]!.promise;
    expect(calls).toBe(4);
    for (const [step, index] of [3, 1, 0, 2].entries()) {
      gates[index]!.resolve(holdings.slice(index * 25, (index + 1) * 25).map(({ key }) => quote(key, "fresh")));
      await started[step + 4]!.promise;
      expect(checkpoints[step]).toEqual({ observations: (step + 1) * 25, attempts: (step + 1) * 25 });
    }
    expect(maximum).toBe(4);
    expect(active).toBe(4);
    expect(await priceStore.getMany(keys.slice(100))).toEqual([]);
    expect(await priceStore.getAttempts(keys.slice(100))).toEqual([]);
    await price({ ...read, holdings }, "US", "cached");
    expect(scheduled).toHaveLength(1);
    const resumedKeys: string[] = [];
    const restarted = createTestPricer({
      priceStore,
      readPrices: async (inputs) => {
        resumedKeys.push(...inputs.map(({ assetKey }) => assetKey));
        return [...inputs].reverse().map(({ assetKey }) => ({
          ...quote(assetKey, "fresh"),
          unitPrice: { atoms: String(keys.indexOf(assetKey) + 1), scale: 0 },
        }));
      },
    });
    const resumed = await restarted({ ...read, holdings }, "US");
    expect(resumedKeys).toEqual(keys.slice(100));
    expect(resumed.holdings.map(({ key }) => key)).toEqual(keys);
    expect(resumed.holdings.slice(100).map(({ unitValue }) => unitValue?.amount)).toEqual(
      Array.from({ length: 125 }, (_, index) => ({ atoms: String(index + 101), scale: 0 })),
    );
    expect(await priceStore.getMany(keys)).toHaveLength(225);
    expect(await priceStore.getAttempts(keys)).toHaveLength(225);
  });

  test.each(["missing", "stale", "invalid", "unavailable"] as const)(
    "checkpoints completed %s outcomes while later batches remain unfinished and retains last-good values",
    async (status) => {
      const holdings = Array.from({ length: 126 }, (_, index) =>
        holding(`0x${(index + 1).toString(16).padStart(40, "0")}`, `token:${index}`, "registry"));
      const keys = holdings.map(({ key }) => key);
      const priceStore = new MemoryPriceObservationStore();
      const prior = { assetKey: keys[0]!, unitPrice: { atoms: "7", scale: 0 }, asOf: source.asOf!, fetchedAt: "2026-09-13T11:58:00.000Z" };
      await priceStore.putMany([prior]);
      const scheduled: Array<() => Promise<unknown>> = [];
      const continued = deferred<void>();
      let calls = 0;
      const price = createTestPricer({
        priceStore,
        schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
        readPrices: async (inputs) => {
          calls += 1;
          if (calls === 1) {
            if (status === "unavailable") throw new Error("provider unavailable");
            return inputs.map(({ assetKey }) => quote(assetKey, status));
          }
          if (calls === 5) continued.resolve();
          return await new Promise<PriceQuote[]>(() => {});
        },
      });
      await price({ ...read, holdings }, "US", "cached");
      void scheduled[0]!();
      await continued.promise;
      expect(await priceStore.getAttempts(keys.slice(0, 25))).toEqual(
        keys.slice(0, 25).map((assetKey) => ({ assetKey, attemptAt: source.fetchedAt, status })),
      );
      expect(await priceStore.getMany(keys)).toEqual([prior]);
      expect(await priceStore.getAttempts(keys.slice(25))).toEqual([]);
      const resumedKeys: string[] = [];
      const restarted = createTestPricer({
        priceStore,
        readPrices: async (inputs) => {
          resumedKeys.push(...inputs.map(({ assetKey }) => assetKey));
          return inputs.map(({ assetKey }) => quote(assetKey, "fresh"));
        },
      });
      const result = await restarted({ ...read, holdings }, "US");
      expect(resumedKeys).toEqual(keys.slice(25));
      expect(result.holdings[0]?.unitValue?.amount).toEqual({ atoms: "7", scale: 0 });
      expect(result.holdings[1]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
    },
  );

  test.each(["observations", "attempts"] as const)("retries failed background %s checkpoints without losing later progress", async (failedWrite) => {
    const holdings = Array.from({ length: 101 }, (_, index) =>
      holding(`0x${(index + 1).toString(16).padStart(40, "0")}`, `token:${index}`, "registry"));
    const keys = holdings.map(({ key }) => key);
    const memory = new MemoryPriceObservationStore();
    let observationWrites = 0;
    let attemptWrites = 0;
    let currentTime = new Date(source.fetchedAt);
    const priceStore: PriceObservationStore = {
      getMany: (keys) => memory.getMany(keys),
      getAttempts: (keys) => memory.getAttempts(keys),
      putMany: async (observations) => {
        observationWrites += 1;
        if (failedWrite === "observations" && observationWrites === 1) throw new Error("checkpoint write failed");
        await memory.putMany(observations);
      },
      putAttempts: async (attempts) => {
        attemptWrites += 1;
        if (failedWrite === "attempts" && attemptWrites === 1) throw new Error("attempt write failed");
        await memory.putAttempts(attempts);
      },
    };
    const scheduled: Array<() => Promise<unknown>> = [];
    const fetched: string[] = [];
    const price = createTestPricer({
      priceStore,
      now: () => currentTime,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async (inputs) => {
        fetched.push(...inputs.map(({ assetKey }) => assetKey));
        return inputs.map(({ assetKey }) => quote(assetKey, "fresh"));
      },
    });
    await price({ ...read, holdings }, "US", "cached");
    await scheduled[0]!();
    expect(await memory.getMany(keys)).toHaveLength(failedWrite === "observations" ? 76 : 101);
    expect(await memory.getAttempts(keys)).toHaveLength(failedWrite === "attempts" ? 76 : 101);
    fetched.length = 0;
    currentTime = new Date("2026-09-13T12:01:01.000Z");
    await price({ ...read, holdings }, "US", "cached");
    expect(scheduled).toHaveLength(2);
    await scheduled[1]!();
    expect(fetched).toEqual(keys);
    expect(await memory.getMany(keys)).toHaveLength(101);
    expect(await memory.getAttempts(keys)).toHaveLength(101);
    expect(observationWrites).toBe(failedWrite === "observations" ? 6 : 5);
  });

  test("serializes same-key persistence while disjoint checkpoints progress and each worker awaits its own writes", async () => {
    const holdings = Array.from({ length: 126 }, (_, index) =>
      holding(`0x${(index + 1).toString(16).padStart(40, "0")}`, `token:${index}`, "registry"));
    const memory = new MemoryPriceObservationStore();
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const disjointWritesDone = deferred<void>();
    const bootstrapReady = deferred<void>();
    let completedDisjointWrites = 0;
    let bootstrapFetched = false;
    let activeWrites = 0;
    let maximumWrites = 0;
    let writes = 0;
    let calls = 0;
    const priceStore: PriceObservationStore = {
      getMany: (keys) => memory.getMany(keys),
      getAttempts: (keys) => memory.getAttempts(keys),
      putAttempts: async (attempts) => {
        if (attempts[0]?.assetKey === holdings[0]!.key) await releaseWrite.promise;
        await memory.putAttempts(attempts);
      },
      putMany: async (observations) => {
        activeWrites += 1;
        maximumWrites = Math.max(maximumWrites, activeWrites);
        writes += 1;
        if (writes === 1) { writeStarted.resolve(); await releaseWrite.promise; }
        await memory.putMany(observations);
        activeWrites -= 1;
        if (observations[0]?.assetKey !== holdings[0]!.key && ++completedDisjointWrites === 5) disjointWritesDone.resolve();
      },
    };
    const scheduled: Array<() => Promise<unknown>> = [];
    const price = createTestPricer({
      priceStore,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      nowMs: () => { if (bootstrapFetched) bootstrapReady.resolve(); return 0; },
      readPrices: async (inputs) => {
        calls += 1;
        if (calls === 7) bootstrapFetched = true;
        return inputs.map(({ assetKey }) => ({
          ...quote(assetKey, "fresh"),
          ...(bootstrapFetched ? { source: { ...source, fetchedAt: "2026-09-13T12:00:01.000Z" }, unitPrice: { atoms: "2", scale: 0 } } : {}),
        }));
      },
    });
    await price({ ...read, holdings }, "US", "cached");
    const refresh = scheduled[0]!();
    await writeStarted.promise;
    expect(calls).toBe(4);
    await disjointWritesDone.promise;
    expect(calls).toBe(6);
    expect(await memory.getMany(holdings.map(({ key }) => key))).toHaveLength(101);
    let bootstrapSettled = false;
    const bootstrap = price({ ...read, holdings: [holdings[0]!] }, "US").then((result) => { bootstrapSettled = true; return result; });
    await bootstrapReady.promise;
    expect(bootstrapSettled).toBe(false);
    expect(writes).toBe(6);
    expect(activeWrites).toBe(1);
    releaseWrite.resolve();
    await refresh;
    await bootstrap;
    expect(maximumWrites).toBeGreaterThan(1);
    expect(writes).toBe(7);
    expect(calls).toBe(7);
    expect((await memory.getMany([holdings[0]!.key]))[0]?.unitPrice).toEqual({ atoms: "2", scale: 0 });
    expect(await memory.getMany(holdings.map(({ key }) => key))).toHaveLength(126);
  });

  test.each(["observations", "attempts"] as const)("a held background %s checkpoint does not block disjoint bootstrap persistence", async (heldWrite) => {
    const memory = new MemoryPriceObservationStore();
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const scheduled: Array<() => Promise<unknown>> = [];
    const priceStore: PriceObservationStore = {
      getMany: (keys) => memory.getMany(keys),
      getAttempts: (keys) => memory.getAttempts(keys),
      putMany: async (observations) => {
        if (heldWrite === "observations" && observations.some(({ assetKey }) => assetKey === usdc.key)) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        await memory.putMany(observations);
      },
      putAttempts: async (attempts) => {
        if (heldWrite === "attempts" && attempts.some(({ assetKey }) => assetKey === usdc.key)) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        await memory.putAttempts(attempts);
      },
    };
    const price = createTestPricer({
      priceStore,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async (inputs) => inputs.map(({ assetKey }) => quote(assetKey, "fresh")),
    });
    await price({ ...read, holdings: [usdc] }, "US", "cached");
    let backgroundSettled = false;
    const background = scheduled[0]!().then(() => { backgroundSettled = true; });
    await writeStarted.promise;
    const result = await price({ ...read, holdings: [dust] }, "US", "bootstrap", new AbortController().signal);
    expect(result.holdings[0]?.value.status).toBe("priced");
    expect(await memory.getMany([dust.key])).toHaveLength(1);
    expect(await memory.getAttempts([dust.key])).toHaveLength(1);
    expect(backgroundSettled).toBe(false);
    releaseWrite.resolve();
    await background;
    expect(await memory.getMany([usdc.key])).toHaveLength(1);
    expect(await memory.getAttempts([usdc.key])).toHaveLength(1);
  });

  test.each(["observations", "attempts"] as const)("caller abort skips same-key bootstrap queued behind held background %s without late writes or advancing its fence", async (heldWrite) => {
    const memory = new MemoryPriceObservationStore();
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const bootstrapReady = deferred<void>();
    const gates = [deferred<PriceQuote[]>(), deferred<PriceQuote[]>()];
    const started = [deferred<void>(), deferred<void>()];
    const scheduled: Array<() => Promise<unknown>> = [];
    const observationWrites: PriceObservation[][] = [];
    const attemptWrites: string[][] = [];
    const providerSignals: AbortSignal[] = [];
    let bootstrapFetched = false;
    let failStoreReads = false;
    let currentTime = new Date(source.fetchedAt);
    const priceStore: PriceObservationStore = {
      getMany: (keys) => failStoreReads ? Promise.reject(new Error("store read failed")) : memory.getMany(keys),
      getAttempts: (keys) => failStoreReads ? Promise.reject(new Error("attempt read failed")) : memory.getAttempts(keys),
      putMany: async (observations) => {
        observationWrites.push([...observations]);
        if (heldWrite === "observations" && observationWrites.length === 1) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        await memory.putMany(observations);
      },
      putAttempts: async (attempts) => {
        attemptWrites.push(attempts.map(({ assetKey }) => assetKey));
        if (heldWrite === "attempts" && attemptWrites.length === 1) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        await memory.putAttempts(attempts);
      },
    };
    const newer = { ...quote(usdc.key, "fresh"), source: { ...source, fetchedAt: "2026-09-13T12:00:01.000Z" }, unitPrice: { atoms: "2", scale: 0 } };
    let calls = 0;
    const price = createTestPricer({
      priceStore,
      now: () => currentTime,
      nowMs: () => { if (bootstrapFetched) bootstrapReady.resolve(); return 0; },
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async (_inputs, options) => {
        const index = calls++;
        providerSignals.push(options!.signal!);
        if (index >= 2) return [newer];
        started[index]!.resolve();
        const quotes = await gates[index]!.promise;
        if (index === 1) bootstrapFetched = true;
        return quotes;
      },
    });
    await price({ ...read, holdings: [usdc] }, "US", "cached");
    let backgroundSettled = false;
    const background = scheduled[0]!().then(() => { backgroundSettled = true; });
    await started[0]!.promise;
    currentTime = new Date("2026-09-13T12:00:01.000Z");
    const controller = new AbortController();
    const bootstrap = price({ ...read, holdings: [usdc] }, "US", "bootstrap", controller.signal);
    await started[1]!.promise;
    gates[0]!.resolve([quote(usdc.key, "fresh")]);
    await writeStarted.promise;
    gates[1]!.resolve([newer]);
    await bootstrapReady.promise;
    expect(observationWrites).toHaveLength(1);
    expect(attemptWrites).toHaveLength(1);
    controller.abort();
    await bootstrap;
    expect(backgroundSettled).toBe(false);
    expect(providerSignals[0]!.aborted).toBe(false);
    expect(scheduled).toHaveLength(1);
    releaseWrite.resolve();
    await background;
    expect(observationWrites).toHaveLength(1);
    expect(attemptWrites).toHaveLength(1);
    expect((await memory.getMany([usdc.key]))[0]?.unitPrice).toEqual({ atoms: "1", scale: 0 });
    expect((await memory.getAttempts([usdc.key]))[0]?.attemptAt).toBe(source.fetchedAt);
    failStoreReads = true;
    currentTime = new Date("2026-09-13T12:00:02.000Z");
    const retry = await price({ ...read, holdings: [usdc] }, "US");
    expect(retry.holdings[0]?.unitValue?.amount).toEqual({ atoms: "2", scale: 0 });
    expect(observationWrites).toHaveLength(2);
    expect(observationWrites[1]![0]?.fetchedAt).toBe(newer.source.fetchedAt);
    expect(attemptWrites).toHaveLength(2);
    expect((await memory.getMany([usdc.key]))[0]?.unitPrice).toEqual({ atoms: "2", scale: 0 });
    expect((await memory.getAttempts([usdc.key]))[0]?.attemptAt).toBe(currentTime.toISOString());
  });

  test.each(["observations", "attempts"] as const)("cancelled mixed-key bootstrap releases disjoint descendants while retaining held background %s barriers", async (heldWrite) => {
    const memory = new MemoryPriceObservationStore();
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const queuedReady = Array.from({ length: 5 }, () => deferred<void>());
    const scheduled: Array<() => Promise<unknown>> = [];
    const observationWrites: PriceObservation[][] = [];
    const attemptWrites: Array<Array<{ assetKey: string; status: string }>> = [];
    let failStoreReads = false;
    let backgroundWriteActive = false;
    let overlappingWrites = false;
    const priceStore: PriceObservationStore = {
      getMany: (keys) => failStoreReads ? Promise.reject(new Error("store read failed")) : memory.getMany(keys),
      getAttempts: (keys) => failStoreReads ? Promise.reject(new Error("attempt read failed")) : memory.getAttempts(keys),
      putMany: async (observations) => {
        if (backgroundWriteActive && observations.some(({ assetKey }) => assetKey === usdc.key)) overlappingWrites = true;
        observationWrites.push([...observations]);
        if (heldWrite === "observations" && observationWrites.length === 1) {
          backgroundWriteActive = true;
          writeStarted.resolve();
          await releaseWrite.promise;
          await memory.putMany(observations);
          backgroundWriteActive = false;
        } else await memory.putMany(observations);
      },
      putAttempts: async (attempts) => {
        if (backgroundWriteActive && attemptWrites.length > 0 && attempts.some(({ assetKey }) => assetKey === usdc.key)) overlappingWrites = true;
        attemptWrites.push(attempts.map(({ assetKey, status }) => ({ assetKey, status })));
        if (heldWrite === "attempts" && attemptWrites.length === 1) {
          backgroundWriteActive = true;
          writeStarted.resolve();
          await releaseWrite.promise;
          await memory.putAttempts(attempts);
          backgroundWriteActive = false;
        } else await memory.putAttempts(attempts);
      },
    };
    let calls = 0;
    const price = createTestPricer({
      priceStore,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      nowMs: () => { queuedReady[calls - 2]?.resolve(); return 0; },
      readPrices: async (inputs) => {
        const index = calls++;
        return inputs.map(({ assetKey }) => ({
          ...quote(assetKey, "fresh"),
          source: { ...source, fetchedAt: `2026-09-13T12:00:0${index === 1 ? 9 : index}.000Z` },
          unitPrice: { atoms: index === 1 ? "99" : String(index + 1), scale: 0 },
        }));
      },
    });
    await price({ ...read, holdings: [usdc] }, "US", "cached");
    let backgroundSettled = false;
    const background = scheduled[0]!().then(() => { backgroundSettled = true; });
    await writeStarted.promise;
    failStoreReads = true;
    const controller = new AbortController();
    const mixed = price({ ...read, holdings: [usdc, dust] }, "US", "bootstrap", controller.signal);
    await queuedReady[0]!.promise;
    const disjointBeforeAbort = price({ ...read, holdings: [dust] }, "US");
    await queuedReady[1]!.promise;
    const conflictingBeforeAbort = price({ ...read, holdings: [usdc] }, "US");
    await queuedReady[2]!.promise;
    expect(observationWrites).toHaveLength(1);
    expect(attemptWrites).toHaveLength(1);
    controller.abort();
    const mixedResult = await mixed;
    expect(mixedResult.holdings.every(({ value }) => value.status === "priced")).toBe(true);
    const firstDisjoint = await disjointBeforeAbort;
    expect(firstDisjoint.holdings[0]?.unitValue?.amount).toEqual({ atoms: "3", scale: 0 });
    const secondDisjoint = await price({ ...read, holdings: [dust] }, "US");
    expect(secondDisjoint.holdings[0]?.unitValue?.amount).toEqual({ atoms: "5", scale: 0 });
    const conflictingAfterAbort = price({ ...read, holdings: [usdc] }, "US");
    await queuedReady[4]!.promise;
    expect(backgroundSettled).toBe(false);
    expect(backgroundWriteActive).toBe(true);
    expect(observationWrites.map((observations) => observations.map(({ assetKey }) => assetKey))).toEqual([[usdc.key], [dust.key], [dust.key]]);
    expect(attemptWrites.map((attempts) => attempts.map(({ assetKey }) => assetKey))).toEqual([[usdc.key], [dust.key], [dust.key]]);
    expect(overlappingWrites).toBe(false);
    expect(scheduled).toHaveLength(1);
    releaseWrite.resolve();
    await background;
    await Promise.all([conflictingBeforeAbort, conflictingAfterAbort]);
    expect(overlappingWrites).toBe(false);
    expect(observationWrites.map((observations) => observations.map(({ assetKey }) => assetKey))).toEqual([[usdc.key], [dust.key], [dust.key], [usdc.key], [usdc.key]]);
    expect(observationWrites.flat().map(({ unitPrice }) => unitPrice.atoms)).toEqual(["1", "3", "5", "4", "6"]);
    expect(attemptWrites.map((attempts) => attempts.map(({ assetKey }) => assetKey))).toEqual([[usdc.key], [dust.key], [dust.key], [usdc.key], [usdc.key]]);
    expect(attemptWrites.flat().every(({ status }) => status === "fresh")).toBe(true);
    expect((await memory.getMany([usdc.key]))[0]?.unitPrice).toEqual({ atoms: "6", scale: 0 });
    expect((await memory.getMany([dust.key]))[0]?.unitPrice).toEqual({ atoms: "5", scale: 0 });
    expect((await memory.getAttempts([usdc.key, dust.key])).map(({ status }) => status)).toEqual(["fresh", "fresh"]);
    expect(calls).toBe(6);
  });

  test("an older overlapping bootstrap result cannot overwrite a newer background checkpoint", async () => {
    const memory = new MemoryPriceObservationStore();
    const gates = [deferred<PriceQuote[]>(), deferred<PriceQuote[]>()];
    const started = [deferred<void>(), deferred<void>()];
    const scheduled: Array<() => Promise<unknown>> = [];
    const writes: PriceObservation[][] = [];
    const priceStore: PriceObservationStore = {
      getMany: (keys) => memory.getMany(keys),
      getAttempts: (keys) => memory.getAttempts(keys),
      putAttempts: (attempts) => memory.putAttempts(attempts),
      putMany: async (observations) => { writes.push([...observations]); await memory.putMany(observations); },
    };
    let calls = 0;
    const price = createTestPricer({
      priceStore,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async () => { const index = calls++; started[index]!.resolve(); return await gates[index]!.promise; },
    });
    await price({ ...read, holdings: [usdc] }, "US", "cached");
    const background = scheduled[0]!();
    await started[0]!.promise;
    const bootstrap = price({ ...read, holdings: [usdc] }, "US");
    await started[1]!.promise;
    gates[0]!.resolve([{ ...quote(usdc.key, "fresh"), unitPrice: { atoms: "2", scale: 0 } }]);
    await background;
    gates[1]!.resolve([{ ...quote(usdc.key, "fresh"), source: { ...source, fetchedAt: "2026-09-13T11:59:59.000Z" } }]);
    await bootstrap;
    expect(writes).toHaveLength(1);
    expect((await memory.getMany([usdc.key]))[0]?.unitPrice).toEqual({ atoms: "2", scale: 0 });
  });

  test("token checkpoints are durable while FX remains pending and FX persists once", async () => {
    const memory = new MemoryPriceObservationStore();
    const observationWrites: string[][] = [];
    const attemptWrites: string[][] = [];
    const priceStore: PriceObservationStore = {
      getMany: (keys) => memory.getMany(keys),
      getAttempts: (keys) => memory.getAttempts(keys),
      putMany: async (observations) => {
        observationWrites.push(observations.map(({ assetKey }) => assetKey));
        await memory.putMany(observations);
      },
      putAttempts: async (attempts) => {
        attemptWrites.push(attempts.map(({ assetKey }) => assetKey));
        await memory.putAttempts(attempts);
      },
    };
    const scheduled: Array<() => Promise<unknown>> = [];
    const fxStarted = deferred<void>();
    const fx = deferred<ReturnType<typeof rates>>();
    const price = createTestPricer({
      priceStore,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async (inputs) => inputs.map(({ assetKey }) => quote(assetKey, "fresh")),
      readExchangeRates: async () => { fxStarted.resolve(); return await fx.promise; },
    });
    await price({ ...read, holdings: [usdc] }, "DE", "cached");
    const refresh = scheduled[0]!();
    await fxStarted.promise;
    expect(await memory.getMany([usdc.key])).toHaveLength(1);
    expect(await memory.getAttempts([usdc.key])).toHaveLength(1);
    expect(await memory.getMany(["fx:USD:EUR"])).toEqual([]);
    fx.resolve(rates());
    await refresh;
    expect(await memory.getMany(["fx:USD:EUR"])).toHaveLength(1);
    expect(await memory.getAttempts(["fx:USD:EUR"])).toHaveLength(1);
    expect(observationWrites).toEqual([[usdc.key], ["fx:USD:EUR"]]);
    expect(attemptWrites).toEqual([[usdc.key], ["fx:USD:EUR"]]);
  });

  test("bounds bootstrap pricing, preserves completed batches, and refreshes unfinished inputs without negative caching", async () => {
    const holdings = Array.from({ length: 225 }, (_, index) =>
      holding(`0x${(index + 1).toString(16).padStart(40, "0")}`, `token:${index}`, "registry"));
    const priceStore = new MemoryPriceObservationStore();
    const scheduled: Array<() => Promise<unknown>> = [];
    const pending: Array<{ keys: string[]; gate: ReturnType<typeof deferred<PriceQuote[]>> }> = [];
    let calls = 0;
    let background = false;
    const price = createTestPricer({
      priceStore,
      priceBudgetMs: 5,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async (inputs, options) => {
        calls += 1;
        expect(inputs.length).toBeLessThanOrEqual(25);
        if (background) {
          expect(options?.signal?.aborted).toBe(false);
          return inputs.map((input) => quote(input.assetKey, "fresh"));
        }
        if (calls <= 4) return inputs.map((input) => quote(input.assetKey, "fresh"));
        const gate = deferred<PriceQuote[]>();
        pending.push({ keys: inputs.map(({ assetKey }) => assetKey), gate });
        return await gate.promise;
      },
    });

    const result = await price({ ...read, holdings }, "US");
    expect(calls).toBe(8);
    expect(result.holdings.slice(0, 100).every(({ value }) => value.status === "priced")).toBe(true);
    expect(result.holdings.slice(100).every(({ value }) =>
      value.status === "unpriced" && value.reason === "price-unavailable")).toBe(true);
    expect(result.revalidating).toBe(true);
    const completedKeys = holdings.slice(0, 100).map(({ key }) => key);
    const remainingKeys = holdings.slice(100).map(({ key }) => key);
    expect(await priceStore.getAttempts(completedKeys)).toHaveLength(100);
    expect(await priceStore.getMany(completedKeys)).toHaveLength(100);
    expect(await priceStore.getAttempts(remainingKeys)).toEqual([]);
    expect(await priceStore.getMany(remainingKeys)).toEqual([]);
    expect(scheduled).toHaveLength(1);

    for (const { keys, gate } of pending) gate.resolve(keys.map((key) => quote(key, "fresh")));
    await Promise.resolve();
    expect(await priceStore.getAttempts(remainingKeys)).toEqual([]);
    expect(await priceStore.getMany(remainingKeys)).toEqual([]);
    background = true;
    await scheduled[0]!();
    expect(await priceStore.getAttempts(remainingKeys)).toHaveLength(125);
    expect(await priceStore.getMany(remainingKeys)).toHaveLength(125);
  });

  test.each(["US", "DE"] as const)("%s request abort stops outstanding pricing and new batches without scheduling refresh or starting FX", async (region) => {
    const holdings = Array.from({ length: 225 }, (_, index) =>
      holding(`0x${(index + 1).toString(16).padStart(40, "0")}`, `token:${index}`, "registry"));
    const priceStore = new MemoryPriceObservationStore();
    const started = deferred<void>();
    const signals: AbortSignal[] = [];
    const scheduled: unknown[] = [];
    let fxCalls = 0;
    const price = createTestPricer({
      priceStore,
      schedule: (task) => scheduled.push(task),
      readPrices: async (_inputs, options) => {
        signals.push(options!.signal!);
        if (signals.length === 4) started.resolve();
        return await new Promise<PriceQuote[]>(() => {});
      },
      readExchangeRates: async () => { fxCalls += 1; return rates(); },
    });
    const controller = new AbortController();
    const pending = price({ ...read, holdings }, region, "bootstrap", controller.signal);
    await started.promise;
    controller.abort();
    const result = await pending;

    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(result.holdings.every(({ value }) => value.status === "unpriced" &&
      value.reason === (region === "US" ? "price-unavailable" : "fx-unavailable"))).toBe(true);
    expect(result.revalidating).toBe(false);
    expect(fxCalls).toBe(0);
    expect(scheduled).toEqual([]);
    const keys = holdings.map(({ key }) => key);
    expect(await priceStore.getAttempts(keys)).toEqual([]);
    expect(await priceStore.getMany(keys)).toEqual([]);
  });

  test("an already-aborted request starts no bootstrap price fetches", async () => {
    let calls = 0;
    const price = createTestPricer({
      readPrices: async (inputs) => { calls += 1; return inputs.map((input) => quote(input.assetKey, "fresh")); },
      schedule: () => { throw new Error("Aborted requests must not schedule refreshes"); },
    });
    const result = await price(read, "US", "bootstrap", AbortSignal.abort());
    expect(calls).toBe(0);
    expect(result.holdings.every(({ value }) => value.status === "unpriced" && value.reason === "price-unavailable")).toBe(true);
    expect(result.revalidating).toBe(false);
  });

  test("bounds price batch concurrency at four and preserves result order", async () => {
    const gates = Array.from({ length: 6 }, () => deferred<number>());
    let active = 0;
    let maximum = 0;
    const pending = mapWithConcurrency(
      [0, 1, 2, 3, 4, 5],
      BALANCES_PRICE_CONCURRENCY,
      async (value) => {
        active += 1;
        maximum = Math.max(maximum, active);
        const result = await gates[value]!.promise;
        active -= 1;
        return result;
      },
    );

    await Promise.resolve();
    expect(active).toBe(4);
    gates[3]!.resolve(30);
    await Promise.resolve();
    gates[1]!.resolve(10);
    await Promise.resolve();
    expect(maximum).toBe(4);
    for (const [index, gate] of gates.entries()) gate.resolve(index * 10);
    await expect(pending).resolves.toEqual([0, 10, 20, 30, 40, 50]);
  });

  test("keeps the cash unit price even with zero wallet USDC", async () => {
    const price = createTestPricer({ readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")),
      readExchangeRates: async () => rates() });
    const result = await price({ ...read, holdings: [{ ...usdc, balance: { status: "ready", baseUnits: "0" } }] }, "US");
    expect(result.holdings[0]?.value).toMatchObject({ status: "priced", amount: { atoms: "0" } });
    expect(result.holdings[0]?.unitValue).toEqual({ currency: "USD", amount: { atoms: "1", scale: 0 } });
  });
  test("requests regional FX for a zero-balance cash holding", async () => {
    const price = createTestPricer({ readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")),
      readExchangeRates: async () => rates() });
    const result = await price({ ...read, holdings: [{ ...usdc, balance: { status: "ready", baseUnits: "0" } }] }, "DE");
    expect(result.holdings[0]?.unitValue).toEqual({ currency: "EUR", amount: { atoms: "9", scale: 1 } });
  });


  test("keeps the exact ERC-20 unit price independently of the holding's rounded value", async () => {
    const token = holding("0x4444444444444444444444444444444444444444", "volatile", "registry", { baseUnits: "1" });
    const price = createTestPricer({
      readPrices: async (inputs) => inputs.map((input) => ({
        ...quote(input.assetKey, "fresh"),
        unitPrice: { atoms: "12345678901", scale: 5 },
      })),
      readExchangeRates: async () => rates(),
    });

    const result = await price({ ...read, holdings: [token] }, "DE");
    expect(result.holdings[0]?.value.status).toBe("priced");
    expect(result.holdings[0]?.unitValue).toEqual({
      currency: "EUR",
      amount: { atoms: "111111110109", scale: 6 },
    });
  });

  test("normalizes trailing zeros after multiplying the ERC-20 price by FX", async () => {
    const token = holding("0x4444444444444444444444444444444444444444", "volatile", "registry");
    const price = createTestPricer({
      readPrices: async (inputs) => inputs.map((input) => ({
        ...quote(input.assetKey, "fresh"),
        unitPrice: { atoms: "1234500", scale: 4 },
      })),
      readExchangeRates: async () => rates(),
    });

    const result = await price({ ...read, holdings: [token] }, "DE");
    expect(result.holdings[0]?.unitValue).toEqual({ currency: "EUR", amount: { atoms: "111105", scale: 3 } });
  });

  test("floors the native ETH unit price to 18 places", async () => {
    const native: ReadHolding = {
      key: "eip155:8453/native",
      id: "eth",
      kind: "native",
      source: "registry",
      name: "Ethereum",
      symbol: "ETH",
      decimals: 18,
      contractAddress: null,
      cashCurrency: null,
      balance: { status: "ready", baseUnits: "1000000000000000000" },
    };
    const price = createTestPricer({
      readExchangeRates: async () => ({
        ...(rates() as { fetchedAt: string; quotes: unknown[] }),
        nativeEthQuote: {
          baseCurrency: "USD",
          assetSymbol: "ETH",
          assetUnitsPerUsd: { atoms: "7", scale: 4 },
          sourceValue: "0.0007",
          status: "fresh",
          source,
        },
      }) as never,
    });

    const result = await price({ ...read, holdings: [native] }, "DE");
    expect(result.holdings[0]?.value.status).toBe("priced");
    expect(result.holdings[0]?.unitValue).toEqual({
      currency: "EUR",
      amount: { atoms: "1285714285714285714285", scale: 18 },
    });
  });

  test("omits unit prices on priced vault shares", async () => {
    const vault: ReadHolding = {
      ...usdc,
      id: "vault",
      kind: "vault-share",
      cashCurrency: null,
      underlying: { key: usdc.key as `eip155:8453/erc20:${string}`, symbol: "USDC", decimals: 6 },
      underlyingBalance: { status: "ready", baseUnits: "1000000" },
    };
    const price = createTestPricer({
      readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")),
      readExchangeRates: async () => rates(),
    });
    const result = await price({ ...read, holdings: [vault] }, "US");
    expect(result.holdings[0]?.value.status).toBe("priced");
    expect(result.holdings[0]?.unitValue).toBeUndefined();
  });

  test("prices Borrow collateral and debt with the same quotes as wallet holdings", async () => {
    const cbbtcAddress = DEFAULT_BORROW_MARKET.collateralToken.address.toLowerCase() as `0x${string}`;
    const usdcAddress = DEFAULT_BORROW_MARKET.loanToken.address.toLowerCase() as `0x${string}`;
    const walletCbbtc: ReadHolding = {
      key: `eip155:8453/erc20:${cbbtcAddress}`,
      id: "cbbtc",
      kind: "erc20",
      source: "registry",
      name: "Bitcoin",
      symbol: "cbBTC",
      decimals: 8,
      contractAddress: cbbtcAddress,
      cashCurrency: null,
      balance: { status: "ready", baseUnits: "50000000" },
    };
    const marketId = DEFAULT_BORROW_MARKET.marketId.toLowerCase() as `0x${string}`;
    const price = createTestPricer({
      readPrices: async (inputs) => inputs.map((input) => ({
        ...quote(input.assetKey, "fresh"),
        unitPrice: input.address.toLowerCase() === cbbtcAddress
          ? { atoms: "100000", scale: 0 }
          : { atoms: "1", scale: 0 },
      })),
      readExchangeRates: async () => rates(),
    });

    const result = await price({
      ...read,
      holdings: [walletCbbtc],
      borrow: {
        markets: BORROW_MARKETS.map((market) => ({
          marketId: market.marketId.toLowerCase() as `0x${string}`,
          status: "ready" as const,
          blockNumber: "1",
          collateralRaw: market.marketId.toLowerCase() === marketId ? "100000000" : "0",
          debtAssetsRaw: market.marketId.toLowerCase() === marketId ? "30000000" : "0",
          borrowAprWad: "51000000000000000",
        })),
      },
    }, "DE");

    const euros = (value: Holding["value"]) => {
      if (value.status !== "priced") return null;
      const fraction = exactDecimalToFraction(value.amount);
      return (fraction.numerator / fraction.denominator).toString();
    };
    expect(euros(result.holdings[0]!.value)).toBe("45000");
    expect(result.borrow.coverage).toBe("complete");
    const [position] = result.borrow.positions;
    expect(position?.collateral).toMatchObject({
      key: walletCbbtc.key,
      source: "borrow",
      collateral: { marketId },
      value: { status: "priced", currency: "EUR" },
    });
    expect(euros(position!.collateral.value)).toBe("90000");
    expect(position?.debt).toMatchObject({
      sign: -1,
      marketId,
      asset: { key: `eip155:8453/erc20:${usdcAddress}`, decimals: 6 },
      balance: { status: "ready", baseUnits: "30000000" },
      value: { status: "priced", currency: "EUR" },
    });
    expect(euros(position!.debt.value)).toBe("27");
    expect(position?.borrowAprWad).toBe("51000000000000000");
  });

  test("a missing borrow read prices no positions and marks Borrow partial", async () => {
    const price = createTestPricer({
      readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")),
      readExchangeRates: async () => rates(),
    });
    const result = await price(read, "US");
    expect(result.borrow).toEqual({ coverage: "partial", positions: [] });
  });

  test("isolates one failed Codex batch without losing other batch prices", async () => {
    const rows = Array.from({ length: 26 }, (_, index) => holding(
      `0x${(index + 1).toString(16).padStart(40, "0")}`,
      `catalog:${index}`,
      "catalog",
    ));
    let calls = 0;
    const price = createTestPricer({
      readPrices: async (inputs) => {
        calls += 1;
        if (calls === 2) throw new Error("one batch failed");
        return [...inputs].reverse().map((input) => quote(input.assetKey, "fresh"));
      },
      readExchangeRates: async () => rates(),
    });

    const result = await price({ ...read, holdings: rows }, "US");
    expect(calls).toBe(2);
    expect(result.holdings.slice(0, 25).every(({ value }) => value.status === "priced")).toBeTrue();
    expect(result.holdings[25]?.value).toEqual({
      status: "unpriced",
      reason: "price-unavailable",
    });
  });
  test("applies the catalog gate, stale reason, and cash denomination", async () => {
    const price = createTestPricer({
      readPrices: async (inputs) => inputs.map((input) =>
        quote(
          input.assetKey,
          input.assetKey === stale.key ? "stale" : "fresh",
        ),
      ),
      readExchangeRates: async () => rates(),
    });

    const result = await price(read, "DE");
    expect(result.holdings.find(({ id }) => id === dust.id)?.value).toMatchObject({
      status: "priced",
      currency: "EUR",
    });
    expect(result.holdings.find(({ id }) => id === stale.id)?.value).toEqual({
      status: "unpriced",
      reason: "price-stale",
    });
    expect(result.holdings.find(({ id }) => id === stale.id)?.unitValue).toBeUndefined();
    expect(result.holdings.find(({ id }) => id === "usdc")?.cashValue).toMatchObject({
      status: "priced",
      currency: "USD",
    });
    expect(result.holdings.find(({ id }) => id === "usdc")?.value).toMatchObject({
      status: "priced",
      currency: "EUR",
    });
  });

  test("reports missing regional FX without losing own-currency cash value", async () => {
    const price = createTestPricer({
      readPrices: async (inputs) => inputs.map((input) =>
        quote(input.assetKey, "fresh"),
      ),
      readExchangeRates: async () => rates(false),
    });

    const result = await price({
      ...read,
      holdings: [usdc],
    }, "DE");
    expect(result.holdings[0]?.value).toEqual({
      status: "unpriced",
      reason: "fx-unavailable",
    });
    expect(result.holdings[0]?.unitValue).toBeUndefined();
    expect(result.holdings[0]?.cashValue).toMatchObject({
      status: "priced",
      currency: "USD",
    });
  });

  test("leaves wallet rows unpriced and does not issue a price request for them", async () => {
    const wallet = holding(
      "0x4444444444444444444444444444444444444444",
      "wallet:token",
      "wallet",
    );
    const batches: string[][] = [];
    const price = createTestPricer({
      readPrices: async (inputs) => {
        batches.push(inputs.map(({ assetKey }) => assetKey));
        return inputs.map((input) => quote(input.assetKey, "fresh"));
      },
      readExchangeRates: async () => rates(),
    });

    const result = await price({ ...read, holdings: [wallet] }, "US");
    expect(batches).toEqual([]);
    expect(result.holdings[0]?.value).toEqual({
      status: "unpriced",
      reason: "below-market-gate",
    });
    expect(result.holdings[0]?.unitValue).toBeUndefined();
  });

  test("prices enriched wallet rows and applies the same market gate", async () => {
    const admitted = holding(
      "0x4444444444444444444444444444444444444444",
      "wallet:admitted",
      "wallet",
      { marketDataResolved: true },
    );
    const gated = holding(
      "0x5555555555555555555555555555555555555555",
      "wallet:gated",
      "wallet",
      { marketDataResolved: true, liquidity: "24999" },
    );
    const missingLiquidity: ReadHolding = { ...gated, id: "wallet:missing-liquidity", contractAddress: "0x6666666666666666666666666666666666666666", key: "eip155:8453/erc20:0x6666666666666666666666666666666666666666", liquidityUsd: undefined };
    const batches: string[][] = [];
    const price = createTestPricer({
      readPrices: async (inputs) => {
        batches.push(inputs.map(({ assetKey }) => assetKey));
        return inputs.map((input) => quote(input.assetKey, "fresh"));
      },
      readExchangeRates: async () => rates(),
    });

    const result = await price(
      { ...read, holdings: [admitted, gated, missingLiquidity] },
      "US",
    );
    expect(batches).toEqual([[admitted.key, gated.key, missingLiquidity.key]]);
    expect(result.holdings[0]?.value).toMatchObject({
      status: "priced",
      currency: "USD",
    });
    expect(result.holdings[1]?.value).toEqual({
      status: "unpriced",
      reason: "below-market-gate",
    });
    expect(result.holdings[1]?.unitValue).toBeUndefined();
    expect(result.holdings[2]?.value).toEqual({
      status: "unpriced",
      reason: "below-market-gate",
    });
  });

  test.each([
    ["3 hours", 3 * 60 * 60 * 1_000, "priced"],
    ["30 hours", 30 * 60 * 60 * 1_000, "unpriced"],
  ] as const)("uses the 24-hour display freshness bound at %s", async (_name, ageMs, expected) => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    const idrx = holding(
      "0x6666666666666666666666666666666666666666",
      "idrx",
      "registry",
      { cash: "USD" },
    );
    idrx.cashCurrency = "IDR";
    const price = createTestPricer({
      readPrices: async (inputs, options) => createCodexRawQuotesReader({
        apiKey: "fixture-key",
        inputs,
        now: () => now,
        freshnessMs: options?.freshnessMs,
        fetchImpl: async () => Response.json({
          data: {
            getTokenPrices: [{
              address: idrx.contractAddress,
              networkId: 8453,
              priceUsd: "0.000061",
              timestamp: String((now.getTime() - ageMs) / 1_000),
            }],
          },
        }),
      })(),
      readExchangeRates: async () => {
        const baseRates = rates() as unknown as {
          fetchedAt: string;
          quotes: Record<string, unknown>[];
          nativeEthQuote: Record<string, unknown>;
        };
        return {
          ...baseRates,
          quotes: [
            ...baseRates.quotes,
            {
              baseCurrency: "USD",
              quoteCurrency: "IDR",
              quoteUnitsPerUsd: { atoms: "16393", scale: 0 },
              sourceValue: "16393",
              status: "fresh",
              source,
            },
          ],
        } as never;
      },
    });

    const result = await price({ ...read, holdings: [idrx] }, "ID");
    if (expected === "priced") {
      expect(result.holdings[0]?.value).toMatchObject({
        status: "priced",
        currency: "IDR",
        asOf: new Date(now.getTime() - ageMs).toISOString(),
      });
      expect(result.holdings[0]?.cashValue).toMatchObject({
        status: "priced",
        currency: "IDR",
      });
    } else {
      expect(result.holdings[0]?.value).toEqual({
        status: "unpriced",
        reason: "price-stale",
      });
      expect(result.holdings[0]?.cashValue).toEqual({
        status: "unpriced",
        reason: "price-stale",
      });
    }
  });

  test.each([
    ["within", 3 * 60 * 60 * 1_000, "priced"],
    ["outside", 30 * 60 * 60 * 1_000, "unpriced"],
  ] as const)("uses stored observations %s the display freshness bound", async (_name, ageMs, expected) => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    const store = new MemoryPriceObservationStore();
    const asOf = new Date(now.getTime() - ageMs).toISOString();
    await store.putMany([{
      assetKey: usdc.key,
      unitPrice: { atoms: "1", scale: 0 },
      asOf,
      fetchedAt: "2026-09-13T11:59:00.000Z",
    }]);
    const price = createTestPricer({
      priceStore: store,
      now: () => now,
      readPrices: async (inputs) => inputs.map((input) =>
        quote(input.assetKey, "unavailable")),
      readExchangeRates: async () => rates(),
    });

    const result = await price({ ...read, holdings: [usdc] }, "US");
    if (expected === "priced") {
      expect(result.holdings[0]?.value).toMatchObject({ status: "priced", asOf });
    } else {
      expect(result.holdings[0]?.value).toEqual({
        status: "unpriced",
        reason: "price-stale",
      });
    }
  });

  test("omits the cash unit price for a zero balance when the stored price is stale", async () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    const store = new MemoryPriceObservationStore();
    await store.putMany([{
      assetKey: usdc.key,
      unitPrice: { atoms: "1", scale: 0 },
      asOf: new Date(now.getTime() - 30 * 60 * 60 * 1_000).toISOString(),
      fetchedAt: "2026-09-13T11:59:00.000Z",
    }]);
    const price = createTestPricer({
      priceStore: store,
      now: () => now,
      readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "unavailable")),
      readExchangeRates: async () => rates(),
    });
    const result = await price({ ...read, holdings: [{ ...usdc, balance: { status: "ready", baseUnits: "0" } }] }, "US");
    expect(result.holdings[0]?.value).toMatchObject({ status: "priced", amount: { atoms: "0" } });
    expect(result.holdings[0]?.unitValue).toBeUndefined();
  });

  test("serves an expiring stored observation and refreshes it in the background", async () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    const store = new MemoryPriceObservationStore();
    await store.putMany([{
      assetKey: usdc.key,
      unitPrice: { atoms: "1", scale: 0 },
      asOf: "2026-09-13T11:59:00.000Z",
      fetchedAt: "2026-09-13T11:58:00.000Z",
    }]);
    const scheduled: Array<() => Promise<unknown>> = [];
    let reads = 0;
    const price = createTestPricer({
      priceStore: store,
      now: () => now,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async (inputs) => {
        reads += 1;
        return inputs.map((input) => quote(input.assetKey, "fresh"));
      },
      readExchangeRates: async () => rates(),
    });

    const result = await price({ ...read, holdings: [usdc] }, "US");
    expect(result.holdings[0]?.value.status).toBe("priced");
    expect(reads).toBe(0);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(reads).toBe(1);
    expect((await store.getMany([usdc.key]))[0]?.fetchedAt).toBe(source.fetchedAt);
  });

  test("dedupes observations by asset key using the newest source time", async () => {
    const writes: PriceObservation[][] = [];
    const priceStore: PriceObservationStore = {
      getMany: async () => [],
      putMany: async (observations) => { writes.push([...observations]); },
      getAttempts: async () => [],
      putAttempts: async () => undefined,
    };
    const newer = "2026-09-13T11:59:30.000Z";
    const price = createTestPricer({
      priceStore,
      readPrices: async (inputs) => [
        { ...quote(inputs[0]!.assetKey, "fresh"), source: { ...source, asOf: source.asOf } },
        { ...quote(inputs[0]!.assetKey, "fresh"), source: { ...source, asOf: newer } },
      ],
      readExchangeRates: async () => rates(),
    });

    await price({ ...read, holdings: [usdc] }, "US");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([expect.objectContaining({
      assetKey: usdc.key,
      asOf: newer,
    })]);
  });

  test("skips persistence when source times have not advanced", async () => {
    const writes: PriceObservation[][] = [];
    const priceStore: PriceObservationStore = {
      getMany: async () => [],
      putMany: async (observations) => { writes.push([...observations]); },
      getAttempts: async () => [],
      putAttempts: async () => undefined,
    };
    const price = createTestPricer({
      priceStore,
      readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")),
      readExchangeRates: async () => rates(),
    });

    await price({ ...read, holdings: [usdc] }, "US");
    await price({ ...read, holdings: [usdc] }, "US");
    expect(writes).toHaveLength(1);
  });

  test("retries an identical observation after transient persistence failure", async () => {
    let currentTime = new Date("2026-09-13T12:00:00.000Z");
    const memory = new MemoryPriceObservationStore();
    let writes = 0;
    const priceStore: PriceObservationStore = {
      getMany: (keys) => memory.getMany(keys),
      getAttempts: (keys) => memory.getAttempts(keys),
      putAttempts: (attempts) => memory.putAttempts(attempts),
      putMany: async (observations) => {
        writes += 1;
        if (writes === 1) throw new Error("transient write failure");
        await memory.putMany(observations);
      },
    };
    const price = createBalancesPricer({
      priceStore,
      now: () => currentTime,
      readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")),
    });

    await price({ ...read, holdings: [usdc] }, "US");
    currentTime = new Date("2026-09-13T12:01:01.000Z");
    const retried = await price({ ...read, holdings: [usdc] }, "US");

    expect(writes).toBe(2);
    expect(await memory.getMany([usdc.key])).toHaveLength(1);
    expect(retried.holdings[0]?.value.status).toBe("priced");
  });

  test("keeps concurrent bootstrap FX available when its storage write is deduplicated", async () => {
    const memory = new MemoryPriceObservationStore();
    const readsReady = deferred<void>();
    let reads = 0;
    const emptyConcurrentReads = async () => {
      reads += 1;
      if (reads === 4) readsReady.resolve();
      await readsReady.promise;
      return [];
    };
    const store: PriceObservationStore = {
      getMany: emptyConcurrentReads,
      getAttempts: emptyConcurrentReads,
      putMany: (observations) => memory.putMany(observations),
      putAttempts: (attempts) => memory.putAttempts(attempts),
    };
    const fxReads = [deferred<ReturnType<typeof rates>>(), deferred<ReturnType<typeof rates>>()];
    let fxIndex = 0;
    const price = createBalancesPricer({
      priceStore: store,
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")),
      readExchangeRates: () => fxReads[fxIndex++]!.promise,
    });

    const first = price({ ...read, holdings: [usdc] }, "DE");
    await Promise.resolve();
    const second = price({ ...read, holdings: [usdc] }, "DE");
    await Promise.resolve();
    fxReads[0]!.resolve(rates());
    await first;
    fxReads[1]!.resolve(rates());
    const secondResult = await second;

    expect(secondResult.holdings[0]?.value).toMatchObject({
      status: "priced",
      currency: "EUR",
    });
  });

  test("falls back to a stored quote when a Codex batch fails", async () => {
    const store = new MemoryPriceObservationStore();
    await store.putMany([{
      assetKey: usdc.key,
      unitPrice: { atoms: "1", scale: 0 },
      asOf: "2026-09-13T11:00:00.000Z",
      fetchedAt: "2026-09-13T11:00:01.000Z",
    }]);
    const price = createTestPricer({
      priceStore: store,
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      readPrices: async () => { throw new Error("Codex unavailable"); },
      readExchangeRates: async () => rates(),
    });

    const result = await price({ ...read, holdings: [usdc] }, "US");
    expect(result.holdings[0]?.value).toMatchObject({
      status: "priced",
      asOf: "2026-09-13T11:00:00.000Z",
    });
  });

  test("cached rows never await providers and expose revalidation only for a degraded scheduled value", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    let codexReads = 0;
    let coinbaseReads = 0;
    const price = createTestPricer({
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
      readPrices: async (inputs) => {
        codexReads += 1;
        return inputs.map((input) => quote(input.assetKey, "fresh"));
      },
      readExchangeRates: async () => {
        coinbaseReads += 1;
        return rates();
      },
    });

    const result = await price({ ...read, holdings: [usdc] }, "US", "cached");
    expect(result.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
    expect(result.revalidating).toBeTrue();
    expect(result.durationMs.codex).toBe(0);
    expect(result.durationMs.coinbase).toBe(0);
    expect(codexReads).toBe(0);
    expect(coinbaseReads).toBe(0);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(codexReads).toBe(1);
    expect(coinbaseReads).toBe(0);
  });

  test("suppresses missing attempts for fifteen minutes", async () => {
    const store = new MemoryPriceObservationStore();
    await store.putAttempts([{
      assetKey: usdc.key,
      attemptAt: "2026-09-13T11:50:00.000Z",
      status: "missing",
    }]);
    const scheduled: unknown[] = [];
    const price = createTestPricer({
      priceStore: store,
      schedule: (task) => scheduled.push(task),
      readPrices: async () => { throw new Error("must not run"); },
    });

    const result = await price({ ...read, holdings: [usdc] }, "US", "cached");
    expect(result.revalidating).toBeFalse();
    expect(scheduled).toEqual([]);
  });

  test("uses USD identity without reading or storing Coinbase FX", async () => {
    const store = new MemoryPriceObservationStore();
    await store.putMany([{
      assetKey: usdc.key,
      unitPrice: { atoms: "1", scale: 0 },
      asOf: "2026-09-13T11:59:00.000Z",
      fetchedAt: "2026-09-13T12:00:00.000Z",
    }]);
    let coinbaseReads = 0;
    const price = createTestPricer({
      priceStore: store,
      readExchangeRates: async () => { coinbaseReads += 1; return rates(); },
    });

    const result = await price({ ...read, holdings: [usdc] }, "US", "cached");
    expect(result.holdings[0]?.value.status).toBe("priced");
    expect(coinbaseReads).toBe(0);
    expect(await store.getMany(["fx:USD:USD"])).toEqual([]);
  });

  test("uses one identical full registry batch across wallet balances", async () => {
    const firstRegistry = holding(
      "0x4444444444444444444444444444444444444444",
      "first",
      "registry",
    );
    const secondRegistry = holding(
      "0x5555555555555555555555555555555555555555",
      "second",
      "registry",
      { baseUnits: "0" },
    );
    const batches: string[][] = [];
    const price = createTestPricer({
      readPrices: async (inputs) => {
        batches.push(inputs.map(({ assetKey }) => assetKey));
        return inputs.map((input) => quote(input.assetKey, "fresh"));
      },
      readExchangeRates: async () => rates(),
    });

    await price({
      ...read,
      holdings: [firstRegistry, secondRegistry],
    }, "US");
    await price({
      ...read,
      holdings: [
        { ...firstRegistry, balance: { status: "ready", baseUnits: "0" } },
        { ...secondRegistry, balance: { status: "ready", baseUnits: "1" } },
      ],
    }, "US");

    expect(batches).toEqual([
      [firstRegistry.key, secondRegistry.key],
    ]);
  });
});

const listedStock = stockAssets[0]!;
const stockUpdatedAt = "2026-09-12T16:00:00.000Z";
const stockBlock = { number: "1", timestamp: "2026-09-13T12:00:00.000Z" };
const stockFeedPrice = { atoms: "12345678901", scale: 8 };
function stockHolding(baseUnits = "100000000"): ReadHolding {
  return {
    ...holding(listedStock.contractAddress.toLowerCase(), listedStock.id, "registry", { baseUnits }),
    decimals: listedStock.representation.decimals,
    symbol: listedStock.representation.tokenSymbol,
  };
}
function stockReference(status: "open" | "closed", price = stockFeedPrice): TokenizedEquityReference {
  return { assetId: listedStock.id, status, price, updatedAt: stockUpdatedAt, roundId: "1", multiplierWad: "1000377118676784179", block: stockBlock };
}

describe("stock holding valuation", () => {
  test.each([
    { label: "open USD", status: "open", region: "US", currency: "USD", atoms: "123456789010000000000", unit: { atoms: "12345678901", scale: 8 } },
    { label: "closed last close", status: "closed", region: "US", currency: "USD", atoms: "123456789010000000000", unit: { atoms: "12345678901", scale: 8 } },
    { label: "non-USD FX", status: "open", region: "DE", currency: "EUR", atoms: "111111110109000000000", unit: { atoms: "111111110109", scale: 9 } },
  ] as const)("prices $label from the feed without multiplying the registry multiplier", async ({ status, region, currency, atoms, unit }) => {
    const codexInputs: string[] = [];
    const feeds: string[][] = [];
    const price = createTestPricer({
      readPrices: async (inputs) => { codexInputs.push(...inputs.map((input) => input.assetKey)); return []; },
      readExchangeRates: async () => rates(),
      readStockReferences: async (inputs) => { feeds.push(inputs.map((feed) => feed.assetId)); return [stockReference(status)]; },
    });
    const result = await price({ ...read, holdings: [stockHolding()] }, region);
    expect(feeds).toEqual([stockAssets.map((asset) => asset.id)]);
    expect(codexInputs).toEqual([]);
    expect(result.holdings[0]?.value).toEqual({
      status: "priced", currency, amount: { atoms, scale: 18 }, asOf: stockUpdatedAt,
      reference: { kind: "tokenized-equity", session: status },
    });
    expect(result.holdings[0]?.unitValue).toEqual({ currency, amount: unit });
  });

  test("a cached pass serves the last good reference and schedules the next read instead of waiting on the provider", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    let now = 0;
    let reads = 0;
    const price = createTestPricer({
      nowMs: () => now,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => Promise.resolve(task)),
      readStockReferences: async () => { reads += 1; return [stockReference(reads === 1 ? "closed" : "open")]; },
    });
    const bootstrap = await price({ ...read, holdings: [stockHolding()] }, "US", "bootstrap");
    expect(reads).toBe(1);
    expect(bootstrap.holdings[0]?.value).toMatchObject({ status: "priced", reference: { kind: "tokenized-equity", session: "closed" } });
    now = STOCK_REFERENCE_REFRESH_MS + 1;
    const cached = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(reads).toBe(1);
    expect(cached.holdings[0]?.value).toMatchObject({ status: "priced", reference: { session: "closed" } });
    expect(cached.revalidating).toBe(false);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(reads).toBe(2);
    const refreshed = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(refreshed.holdings[0]?.value).toMatchObject({ status: "priced", reference: { session: "open" } });
    expect(refreshed.revalidating).toBe(false);
    expect(reads).toBe(2);
  });


  test("a resolved all-unavailable batch past the age bound is unpriced and degraded", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    let now = 0;
    let reads = 0;
    const price = createTestPricer({
      nowMs: () => now,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => Promise.resolve(task)),
      readStockReferences: async () => {
        reads += 1;
        return reads === 1 ? [stockReference("open")] : [{ assetId: listedStock.id, status: "unavailable", reason: "read-failed", block: null }];
      },
    });
    await price({ ...read, holdings: [stockHolding()] }, "US", "bootstrap");
    now = STOCK_REFERENCE_MAX_AGE_MS + 1;
    const stale = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(stale.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
    expect(stale.revalidating).toBe(true);
    await scheduled[0]!();
    const afterFailure = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(afterFailure.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
    expect(afterFailure.revalidating).toBe(true);
  });

  test("a failing reference refresh keeps a thirty-second retry cadence", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    let now = 0;
    const price = createTestPricer({
      nowMs: () => now,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => Promise.resolve(task)),
      readStockReferences: async () => { throw new Error("oracle unavailable"); },
    });
    await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    now += STOCK_REFERENCE_REFRESH_MS - 1;
    await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(scheduled).toHaveLength(1);
    now += 2;
    await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(scheduled).toHaveLength(2);
  });

  test("a cached pass stops pricing a stock once the retained reference outlives its usable age", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    let now = 0;
    let reads = 0;
    const price = createTestPricer({
      nowMs: () => now,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => Promise.resolve(task)),
      readStockReferences: async () => {
        reads += 1;
        if (reads === 1) return [stockReference("open")];
        throw new Error("oracle unavailable");
      },
    });
    expect((await price({ ...read, holdings: [stockHolding()] }, "US", "bootstrap")).holdings[0]?.value).toMatchObject({ status: "priced" });
    now = STOCK_REFERENCE_MAX_AGE_MS + 1;
    const cached = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(cached.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
    expect(cached.revalidating).toBe(true);
    expect(reads).toBe(1);
    await scheduled[0]!();
    expect(reads).toBe(2);
    const afterFailure = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(afterFailure.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
    expect(afterFailure.revalidating).toBe(true);
  });

  test("a cached pass keeps a usable reference through one rejected refresh and shows a later pause", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    let now = 0;
    let reads = 0;
    const price = createTestPricer({
      nowMs: () => now,
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => Promise.resolve(task)),
      readStockReferences: async () => {
        reads += 1;
        if (reads === 1) return [stockReference("open")];
        if (reads === 2) return [{ assetId: listedStock.id, status: "unavailable", reason: "read-failed", block: null }];
        return [{ assetId: listedStock.id, status: "paused", lastPrice: stockFeedPrice, updatedAt: stockUpdatedAt, multiplierWad: "1000000000000000000", block: stockBlock }];
      },
    });
    await price({ ...read, holdings: [stockHolding()] }, "US", "bootstrap");
    now = STOCK_REFERENCE_REFRESH_MS + 1;
    const cached = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(cached.holdings[0]?.value).toMatchObject({ status: "priced", reference: { session: "open" } });
    await scheduled[0]!();
    const afterRejection = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(afterRejection.holdings[0]?.value).toMatchObject({ status: "priced", reference: { session: "open" } });
    now += STOCK_REFERENCE_REFRESH_MS + 1;
    await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    await scheduled[scheduled.length - 1]!();
    const afterPause = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(afterPause.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-paused" });
  });
  test("concurrent bootstrap reads share one in-flight reference read", async () => {
    const pending = deferred<TokenizedEquityReference[]>();
    let reads = 0;
    const price = createTestPricer({
      readStockReferences: async () => { reads += 1; return pending.promise; },
    });
    const first = price({ ...read, holdings: [stockHolding()] }, "US", "bootstrap");
    const second = price({ ...read, holdings: [stockHolding()] }, "US", "bootstrap");
    pending.resolve([stockReference("closed")]);
    const [a, b] = await Promise.all([first, second]);
    expect(reads).toBe(1);
    expect(a.holdings[0]?.value).toMatchObject({ status: "priced", reference: { session: "closed" } });
    expect(b.holdings[0]?.value).toMatchObject({ status: "priced", reference: { session: "closed" } });
  });

  test("a cached pass on a cold instance reports the stock unpriced without waiting for the provider", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    const pending = deferred<TokenizedEquityReference[]>();
    const price = createTestPricer({
      schedule: (task) => scheduled.push(typeof task === "function" ? task : () => Promise.resolve(task)),
      readStockReferences: () => pending.promise,
    });
    const cached = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(cached.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
    expect(cached.revalidating).toBe(true);
    expect(scheduled).toHaveLength(1);
    pending.resolve([stockReference("open")]);
    await scheduled[0]!();
    const warmed = await price({ ...read, holdings: [stockHolding()] }, "US", "cached");
    expect(warmed.holdings[0]?.value).toMatchObject({ status: "priced" });
    expect(warmed.revalidating).toBe(false);
  });

  test("does not read a stock feed for a region with no quote currency", async () => {
    let reads = 0;
    const price = createTestPricer({ readStockReferences: async () => { reads += 1; return [stockReference("open")]; } });
    const result = await price({ ...read, holdings: [stockHolding()] }, "GLOBAL");
    expect(reads).toBe(0);
    expect(result.holdings[0]?.value).toEqual({ status: "unpriced", reason: "no-quote-currency" });
  });

  test.each([
    { label: "paused", reference: { assetId: listedStock.id, status: "paused", lastPrice: stockFeedPrice, updatedAt: stockUpdatedAt, multiplierWad: "1000377118676784179", block: stockBlock }, reason: "price-paused" },
    { label: "stale", reference: { assetId: listedStock.id, status: "stale", lastPrice: stockFeedPrice, updatedAt: stockUpdatedAt, multiplierWad: "1000377118676784179", block: stockBlock }, reason: "price-stale" },
    { label: "unavailable", reference: { assetId: listedStock.id, status: "unavailable", reason: "read-failed", block: null }, reason: "price-unavailable" },
  ] as const)("leaves a $label feed unpriced", async ({ reference, reason }) => {
    const price = createTestPricer({
      readPrices: async () => { throw new Error("stock must not use Codex"); },
      readStockReferences: async () => [reference as TokenizedEquityReference],
    });
    const result = await price({ ...read, holdings: [stockHolding()] }, "US");
    expect(result.holdings[0]?.value).toEqual({ status: "unpriced", reason });
    expect(result.holdings[0]?.unitValue).toBeUndefined();
  });

  test.each([
    { label: "reader throws", readStockReferences: async () => { throw new Error("oracle unavailable"); } },
    { label: "reader omits asset", readStockReferences: async () => [] },
  ])("marks stock price unavailable when $label", async ({ readStockReferences }) => {
    const price = createTestPricer({ readStockReferences });
    const result = await price({ ...read, holdings: [stockHolding()] }, "US");
    expect(result.holdings[0]?.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
  });

  test("does not read or price a removed listing", async () => {
    let reads = 0;
    const price = createTestPricer({
      stockAssets: [{ ...listedStock, listing: "removed" }],
      readPrices: async (inputs) => { expect(inputs).toEqual([]); return []; },
      readStockReferences: async () => { reads += 1; return [stockReference("open")]; },
    });
    const result = await price({ ...read, holdings: [stockHolding()] }, "US");
    expect(reads).toBe(0);
    expect(result.holdings[0]?.value).toEqual({ status: "unpriced", reason: "asset-removed" });
  });

  test("preserves zero balance without reading a feed", async () => {
    let reads = 0;
    const price = createTestPricer({ readStockReferences: async () => { reads += 1; return [stockReference("open")]; } });
    const result = await price({ ...read, holdings: [stockHolding("0")] }, "US");
    expect(reads).toBe(0);
    expect(result.holdings[0]?.value).toMatchObject({ status: "priced", amount: { atoms: "0", scale: 18 } });
    expect(result.holdings[0]?.unitValue).toBeUndefined();
  });

  test("values 10^30 base units exactly to the cent at a large feed price", async () => {
    const baseUnits = `1${"0".repeat(30)}`;
    const answer = "9876543210987654321";
    const price = createTestPricer({ readStockReferences: async () => [stockReference("open", { atoms: answer, scale: 8 })] });
    const result = await price({ ...read, holdings: [stockHolding(baseUnits)] }, "US");
    const value = result.holdings[0]?.value;
    expect(value?.status).toBe("priced");
    if (value?.status !== "priced") throw new Error("Expected stock valuation.");
    const expectedCents = BigInt(baseUnits) * BigInt(answer) / BigInt(10) ** BigInt(14);
    expect(BigInt(value.amount.atoms) / BigInt(10) ** BigInt(value.amount.scale - 2)).toBe(expectedCents);
    expect(value.amount).toEqual({ atoms: (expectedCents * BigInt(10) ** BigInt(16)).toString(), scale: 18 });
  });

  test.each(["cbhype", "cbzec"])("keeps %s on Codex despite its B20-style address", async (assetId) => {
    const asset = cryptoAssets.find((entry) => entry.id === assetId)!;
    const wrapped = holding(asset.contractAddress.toLowerCase(), asset.id, "registry");
    let stockReads = 0;
    const codexInputs: string[] = [];
    const price = createTestPricer({
      readStockReferences: async () => { stockReads += 1; return []; },
      readPrices: async (inputs) => { codexInputs.push(...inputs.map((input) => input.assetKey)); return inputs.map((input) => quote(input.assetKey, "fresh")); },
    });
    const result = await price({ ...read, holdings: [wrapped] }, "US");
    expect(stockReads).toBe(0);
    expect(codexInputs).toEqual([wrapped.key]);
    expect(result.holdings[0]?.value.status).toBe("priced");
  });

  test("never reads a stock feed when there is no stock holding", async () => {
    let reads = 0;
    const price = createTestPricer({ readStockReferences: async () => { reads += 1; return []; } });
    await price({ ...read, holdings: [usdc] }, "US");
    expect(reads).toBe(0);
  });
});
