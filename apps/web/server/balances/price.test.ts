import { describe, expect, test } from "bun:test";
import { createCodexRawQuotesReader } from "@/server/market-data/codex/raw-quotes";
import { BALANCES_PRICE_MAX_AGE_MS } from "@/shared/balances/types";
import type { PriceQuote } from "@/shared/balances/quotes";
import {
  BALANCES_PRICE_CONCURRENCY,
  createBalancesPricer,
  mapWithConcurrency,
} from "./price";
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
    expect(result.slice(0, 25).every(({ value }) => value.status === "priced")).toBeTrue();
    expect(result[25]?.value).toEqual({
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
    expect(result.find(({ id }) => id === dust.id)?.value).toMatchObject({
      status: "priced",
      currency: "EUR",
    });
    expect(result.find(({ id }) => id === stale.id)?.value).toEqual({
      status: "unpriced",
      reason: "price-stale",
    });
    expect(result.find(({ id }) => id === "usdc")?.cashValue).toMatchObject({
      status: "priced",
      currency: "USD",
    });
    expect(result.find(({ id }) => id === "usdc")?.value).toMatchObject({
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
    expect(result[0]?.value).toEqual({
      status: "unpriced",
      reason: "fx-unavailable",
    });
    expect(result[0]?.cashValue).toMatchObject({
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
    expect(result[0]?.value).toEqual({
      status: "unpriced",
      reason: "below-market-gate",
    });
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
    expect(result[0]?.value).toMatchObject({
      status: "priced",
      currency: "USD",
    });
    expect(result[1]?.value).toEqual({
      status: "unpriced",
      reason: "below-market-gate",
    });
    expect(result[2]?.value).toEqual({
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
    expect(BALANCES_PRICE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1_000);
    if (expected === "priced") {
      expect(result[0]?.value).toMatchObject({
        status: "priced",
        currency: "IDR",
        asOf: new Date(now.getTime() - ageMs).toISOString(),
      });
      expect(result[0]?.cashValue).toMatchObject({
        status: "priced",
        currency: "IDR",
      });
    } else {
      expect(result[0]?.value).toEqual({
        status: "unpriced",
        reason: "price-stale",
      });
      expect(result[0]?.cashValue).toEqual({
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
      expect(result[0]?.value).toMatchObject({ status: "priced", asOf });
    } else {
      expect(result[0]?.value).toEqual({
        status: "unpriced",
        reason: "price-stale",
      });
    }
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
    expect(result[0]?.value.status).toBe("priced");
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
    expect(result[0]?.value).toMatchObject({
      status: "priced",
      asOf: "2026-09-13T11:00:00.000Z",
    });
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
      [firstRegistry.key, secondRegistry.key],
    ]);
  });
});
