import { describe, expect, test } from "bun:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
} from "viem";
import type { RecognizedTokenCatalogEntry } from "@/server/market-data/codex/recognized-catalog";
import { erc20Abi, multicallAbi } from "./abi";
import {
  createBalancesUniverseReader,
  createCatalogDecimalsReader,
} from "./universe";

const catalog: RecognizedTokenCatalogEntry[] = [
  {
    address: "0x1111111111111111111111111111111111111111",
    name: "One",
    symbol: "ONE",
    decimals: 18,
    liquidityUsd: { atoms: "100000", scale: 0 },
    volume24Usd: { atoms: "10000", scale: 0 },
  },
  {
    address: "0x2222222222222222222222222222222222222222",
    name: "Two",
    symbol: "TWO",
    decimals: 6,
    liquidityUsd: { atoms: "200000", scale: 0 },
    volume24Usd: { atoms: "20000", scale: 0 },
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve,
  };
}

function catalogOnly(
  result: Awaited<ReturnType<ReturnType<typeof createBalancesUniverseReader>>>,
) {
  return result.entries.filter((entry) => entry.source === "catalog");
}

function decimalsAggregate(count: number, decimals = 18): Hex {
  return encodeFunctionResult({
    abi: multicallAbi,
    functionName: "aggregate3",
    result: Array.from({ length: count }, () => ({
      success: true,
      returnData: encodeFunctionResult({
        abi: erc20Abi,
        functionName: "decimals",
        result: decimals,
      }),
    })),
  });
}

function catalogEntries(count: number): RecognizedTokenCatalogEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    address: `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    decimals: 18,
    liquidityUsd: { atoms: "100000", scale: 0 },
    volume24Usd: { atoms: "10000", scale: 0 },
  }));
}

describe("balances universe", () => {
  test("keeps registry first and silently drops real decimal mismatches", async () => {
    const read = createBalancesUniverseReader({
      hasApiKey: () => true,
      readCatalog: async () => ({
        status: "complete",
        entries: catalog,
      }),
      readDecimals: async () => ({
        values: [18, 18],
        failedIndexes: [],
      }),
    });

    const result = await read();
    expect(result.entries.slice(0, 3).map(({ id }) => id)).toEqual([
      "usdc",
      "eurc",
      "idrx",
    ]);
    expect(result.entries.findIndex(({ source }) => source === "catalog"))
      .toBeGreaterThan(20);
    expect(catalogOnly(result).map(({ symbol }) => symbol)).toEqual(["ONE"]);
    expect(result.catalogStatus).toBe("complete");
  });

  test("returns registry only and unavailable coverage without a Codex key", async () => {
    let called = false;
    const read = createBalancesUniverseReader({
      hasApiKey: () => false,
      readCatalog: async () => {
        called = true;
        return {
          status: "complete",
          entries: catalog,
        };
      },
    });

    const result = await read();
    expect(called).toBe(false);
    expect(result.entries.every(({ source }) => source === "registry")).toBe(true);
    expect(result.catalogStatus).toBe("unavailable");
  });

  test("does not bind shared decimals verification to the request signal", async () => {
    let receivedSignal: AbortSignal | undefined;
    const gate = deferred<{ values: number[]; failedIndexes: number[] }>();
    const read = createBalancesUniverseReader({
      hasApiKey: () => true,
      readCatalog: async () => ({
        status: "complete",
        entries: catalog,
      }),
      readDecimals: async (_entries, signal) => {
        receivedSignal = signal;
        return gate.promise;
      },
    });
    const controller = new AbortController();

    const pending = read(controller.signal);
    controller.abort();
    gate.resolve({
      values: [18, 6],
      failedIndexes: [],
    });

    await expect(pending).resolves.toMatchObject({ catalogStatus: "complete" });
    expect(receivedSignal).toBeUndefined();
  });

  test("excludes an unverified failed chunk and marks catalog incomplete", async () => {
    const read = createBalancesUniverseReader({
      hasApiKey: () => true,
      readCatalog: async () => ({
        status: "complete",
        entries: catalog,
      }),
      readDecimals: async () => ({
        values: [18, null],
        failedIndexes: [1],
      }),
    });

    const result = await read();
    expect(catalogOnly(result).map(({ symbol }) => symbol)).toEqual(["ONE"]);
    expect(result.catalogStatus).toBe("incomplete");
  });

  test("keeps a previous verified cache across a transient chunk failure", async () => {
    let current = 0;
    let attempts = 0;
    const read = createBalancesUniverseReader({
      hasApiKey: () => true,
      now: () => current,
      readCatalog: async () => ({
        status: "complete",
        entries: catalog,
      }),
      readDecimals: async () => {
        attempts += 1;
        return attempts === 1
          ? { values: [18, 6], failedIndexes: [] }
          : { values: [null, null], failedIndexes: [0, 1] };
      },
    });

    const initial = await read();
    current = 60_001;
    const afterFailure = await read();
    const retried = await read();

    expect(catalogOnly(initial).map(({ symbol }) => symbol)).toEqual(["ONE", "TWO"]);
    expect(catalogOnly(afterFailure).map(({ symbol }) => symbol)).toEqual([
      "ONE",
      "TWO",
    ]);
    expect(afterFailure.catalogStatus).toBe("incomplete");
    expect(retried.catalogStatus).toBe("incomplete");
    expect(attempts).toBe(3);
  });

  test("runs public Base decimals chunks sequentially", async () => {
    let active = 0;
    let maximumActive = 0;
    const readDecimals = createCatalogDecimalsReader({
      inspectRpc: () => ({
        source: "public-default",
        hostClass: "public-base",
        protocol: "https",
      }),
      rpc: {
        request: async (_method, params) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Promise.resolve();
          active -= 1;
          const call = decodeFunctionData({
            abi: multicallAbi,
            data: (params[0] as { data: Hex }).data,
          });
          return decimalsAggregate(call.args[0].length);
        },
      },
    });

    const result = await readDecimals(catalogEntries(129));
    expect(result.values).toHaveLength(129);
    expect(result.failedIndexes).toEqual([]);
    expect(maximumActive).toBe(1);
  });

  test("does not let an older catalog signature overwrite a newer flight", async () => {
    const firstGate = deferred<{ values: number[]; failedIndexes: number[] }>();
    const secondGate = deferred<{ values: number[]; failedIndexes: number[] }>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    let selected = catalog.slice(0, 1);
    let attempts = 0;
    const read = createBalancesUniverseReader({
      hasApiKey: () => true,
      readCatalog: async () => ({
        status: "complete",
        entries: selected,
      }),
      readDecimals: async (entries) => {
        attempts += 1;
        if (entries[0]?.symbol === "ONE") {
          firstStarted.resolve();
          return firstGate.promise;
        }
        secondStarted.resolve();
        return secondGate.promise;
      },
    });

    const first = read();
    await firstStarted.promise;
    selected = catalog.slice(1);
    const second = read();
    await secondStarted.promise;
    secondGate.resolve({
      values: [6],
      failedIndexes: [],
    });
    expect(catalogOnly(await second).map(({ symbol }) => symbol)).toEqual(["TWO"]);
    firstGate.resolve({
      values: [18],
      failedIndexes: [],
    });
    expect(catalogOnly(await first).map(({ symbol }) => symbol)).toEqual(["ONE"]);

    const cachedSecond = await read();
    expect(catalogOnly(cachedSecond).map(({ symbol }) => symbol)).toEqual(["TWO"]);
    expect(attempts).toBe(2);
  });
});
