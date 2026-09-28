import { describe, expect, test } from "bun:test";
import type { DailyFxReader } from "@/server/activity/valuation/coinbase-daily-fx";
import type { HistoricalCloseReader } from "@/server/activity/valuation/codex-closes";
import { createHistorySeries } from "./series";
import type {
  BlockRef, ChainBucket, HistoryChainReader, HistoryStore, ValuationPoint,
} from "./types";

const VAULT = `0x${"ab".repeat(20)}` as const;
const MARKET = `0x${"cd".repeat(32)}` as const;
const CONTRACT = `0x${"ef".repeat(20)}` as const;
const NOW = new Date("2026-03-12T14:00:00Z");
const finalized: BlockRef = { number: BigInt(500), hash: `0x${"01".repeat(32)}`, timestamp: Date.parse("2026-03-12T13:00:00Z") / 1_000 };

function bucket(at: string, block = BigInt(100)): ChainBucket {
  return {
    bucketAt: new Date(at), blockNumber: block,
    blockHash: `0x${"02".repeat(32)}`, blockTime: new Date(new Date(at).getTime() - 2_000),
  };
}

function fixture(options: { readCloses?: HistoricalCloseReader; readFx?: DailyFxReader } = {}) {
  const points: ValuationPoint[] = [];
  const buckets = new Map<number, ChainBucket>();
  const calls = {
    getBuckets: [] as Date[][],
    resolve: [] as Date[][],
    putBuckets: [] as ChainBucket[][],
    getPoints: [] as Parameters<HistoryStore["getValuationPoints"]>[0][],
    putPoints: [] as ValuationPoint[][],
    prune: [] as { cutoff: Date; batch: number }[],
    vaults: [] as Parameters<HistoryChainReader["readVaultRates"]>[0][],
    markets: [] as Parameters<HistoryChainReader["readMorphoBorrowIndexes"]>[0][],
    closes: [] as Parameters<HistoricalCloseReader>[0][],
    fx: [] as Parameters<DailyFxReader>[0][],
  };
  const store: Pick<HistoryStore, "getBuckets" | "putBuckets" | "getValuationPoints" | "putValuationPoints" | "pruneHourlyValuationPoints"> = {
    async getBuckets(_chain, times) {
      calls.getBuckets.push([...times]);
      return times.flatMap((time) => {
        const found = buckets.get(time.getTime());
        return found ? [found] : [];
      });
    },
    async putBuckets(_chain, resolved) {
      calls.putBuckets.push([...resolved]);
      for (const entry of resolved) buckets.set(entry.bucketAt.getTime(), entry);
    },
    async getValuationPoints(input) {
      calls.getPoints.push(input);
      return points.filter((point) => input.seriesKeys.includes(point.seriesKey)
        && point.basisVersion === input.basisVersion && point.granularity === input.granularity
        && input.bucketTimes.some((time) => time.getTime() === point.bucketAt.getTime()));
    },
    async putValuationPoints(batch) {
      calls.putPoints.push([...batch]);
      points.push(...batch);
    },
    async pruneHourlyValuationPoints(cutoff, batch) {
      calls.prune.push({ cutoff, batch });
      return 0;
    },
  };
  const chain: Pick<HistoryChainReader, "resolveBuckets" | "readVaultRates" | "readMorphoBorrowIndexes"> = {
    async resolveBuckets(times) {
      calls.resolve.push([...times]);
      return times.map((time, index) => bucket(time.toISOString(), BigInt(index + 200)));
    },
    async readVaultRates(input) {
      calls.vaults.push(input);
      return input.vaults.map((vault) => ({ vault, value: { atoms: BigInt(42), scale: 36 } }));
    },
    async readMorphoBorrowIndexes(input) {
      calls.markets.push(input);
      return input.marketIds.map((marketId) => ({ marketId, value: { atoms: BigInt(51), scale: 36 } }));
    },
  };
  const readCloses: HistoricalCloseReader = async (requests, signal) => {
    calls.closes.push(requests);
    return options.readCloses?.(requests, signal) ?? new Map();
  };
  const readFx: DailyFxReader = async (requests, signal) => {
    calls.fx.push(requests);
    return options.readFx?.(requests, signal) ?? new Map();
  };
  const series = createHistorySeries({
    store: store as HistoryStore, chain: chain as HistoryChainReader,
    readCloses, readFx, now: () => NOW,
  });
  const fill = (entries: ChainBucket[], overrides: Partial<Parameters<typeof series.fill>[0]> = {}) => series.fill({
    buckets: entries, granularity: "1h", vaults: [], marketIds: [], closeContracts: [], fxCurrencies: [], ...overrides,
  });
  return { points, buckets, calls, chain, series, fill };
}

function storedPoint(seriesKey: string, entry: ChainBucket, value: ValuationPoint["value"]): ValuationPoint {
  return {
    seriesKey, bucketAt: entry.bucketAt, basisVersion: "history-basis-v1", granularity: "1h",
    value, blockNumber: null, source: "codex", observedAt: NOW,
  };
}

describe("history valuation series", () => {
  test("loads buckets from the store and resolves only missing times at or before finalized", async () => {
    const f = fixture();
    const old = bucket("2026-03-12T11:00:00Z");
    const missing = bucket("2026-03-12T12:00:00Z");
    const future = bucket("2026-03-12T14:00:00Z");
    f.buckets.set(old.bucketAt.getTime(), old);
    f.buckets.set(future.bucketAt.getTime(), future);
    const output = await f.series.ensureBuckets([old.bucketAt, missing.bucketAt, future.bucketAt], finalized);
    expect(output.map((entry) => entry.bucketAt.toISOString())).toEqual([old.bucketAt.toISOString(), missing.bucketAt.toISOString()]);
    expect(f.calls.getBuckets[0]).toEqual([old.bucketAt, missing.bucketAt]);
    expect(f.calls.resolve).toEqual([[missing.bucketAt]]);
    expect(f.calls.putBuckets[0]?.map((entry) => entry.bucketAt)).toEqual([missing.bucketAt]);
    await f.series.ensureBuckets([old.bucketAt, missing.bucketAt, future.bucketAt], finalized);
    expect(f.calls.resolve).toHaveLength(1);
  });

  test("uses stored points without fetching; fetches only missing chain values at bucket blocks", async () => {
    const f = fixture();
    const first = bucket("2026-03-11T10:00:00Z", BigInt(123));
    const second = bucket("2026-03-11T11:00:00Z", BigInt(124));
    f.points.push(storedPoint(`vault-rate:${VAULT}`, first, { atoms: BigInt(77), scale: 36 }));
    const values = await f.fill([first, second], { vaults: [VAULT], marketIds: [MARKET] });
    expect(values.get(`vault-rate:${VAULT}`)?.get(first.bucketAt.getTime())).toEqual({ status: "ready", value: { atoms: BigInt(77), scale: 36 }, provisional: false });
    expect(f.calls.vaults).toEqual([{ vaults: [VAULT], block: BigInt(124), signal: undefined }]);
    expect(f.calls.markets.map((call) => [call.block, call.blockTimestamp])).toEqual([
      [BigInt(123), Math.floor(first.blockTime.getTime() / 1_000)],
      [BigInt(124), Math.floor(second.blockTime.getTime() / 1_000)],
    ]);
    expect(values.get(`morpho-borrow-index:${MARKET}`)?.get(second.bucketAt.getTime())).toEqual({ status: "ready", value: { atoms: BigInt(51), scale: 36 }, provisional: false });
    expect(f.calls.getPoints[0]?.basisVersion).toBe("history-basis-v1");
    expect(f.calls.putPoints[0]?.map((point) => [point.seriesKey, point.blockNumber, point.source]).sort()).toEqual([
      [`morpho-borrow-index:${MARKET}`, BigInt(123), "base-rpc"],
      [`morpho-borrow-index:${MARKET}`, BigInt(124), "base-rpc"],
      [`vault-rate:${VAULT}`, BigInt(124), "base-rpc"],
    ].sort());
    await f.fill([first, second], { vaults: [VAULT], marketIds: [MARKET] });
    expect(f.calls.vaults).toHaveLength(1);
    expect(f.calls.markets).toHaveLength(2);
  });

  test("returns unavailable for a null chain value and does not store it", async () => {
    const f = fixture();
    f.chain.readVaultRates = async () => [{ vault: VAULT, value: null }];
    const entry = bucket("2026-03-11T10:00:00Z");
    const result = await f.fill([entry], { vaults: [VAULT] });
    expect(result.get(`vault-rate:${VAULT}`)?.get(entry.bucketAt.getTime())).toEqual({ status: "unavailable" });
    expect(f.points).toEqual([]);
  });

  test("does not store unsettled closes, even when found", async () => {
    const f = fixture({ readCloses: async (requests) => new Map(requests.map((request) => [
      `${request.contract}:${request.timestampSeconds}`,
      { status: "found" as const, close: { provider: "Codex" as const, closedAt: request.timestampSeconds.toString(), resolutionMinutes: 15 as const, priceUsd: { atoms: "125", scale: 2 } } },
    ])) });
    const entry = bucket("2026-03-12T13:00:00Z");
    const first = await f.fill([entry], { closeContracts: [CONTRACT] });
    expect(first.get(`close:${CONTRACT}`)?.get(entry.bucketAt.getTime())).toEqual({ status: "ready", value: { atoms: BigInt(125), scale: 2 }, provisional: true });
    expect(f.points).toEqual([]);
    await f.fill([entry], { closeContracts: [CONTRACT] });
    expect(f.calls.closes).toHaveLength(2);
  });

  test("stores settled none as null and does not refetch; unavailable never becomes zero or a row", async () => {
    const f = fixture({ readCloses: async (requests) => new Map(requests.map((request) => [
      `${request.contract}:${request.timestampSeconds}`, { status: "none" as const },
    ])) });
    const entry = bucket("2026-03-11T13:00:00Z");
    const first = await f.fill([entry], { closeContracts: [CONTRACT] });
    expect(first.get(`close:${CONTRACT}`)?.get(entry.bucketAt.getTime())).toEqual({ status: "none" });
    expect(f.points).toEqual([storedPoint(`close:${CONTRACT}`, entry, null)]);
    await f.fill([entry], { closeContracts: [CONTRACT] });
    expect(f.calls.closes).toHaveLength(1);
    const unavailable = fixture({ readCloses: async () => new Map() });
    expect((await unavailable.fill([entry], { closeContracts: [CONTRACT] })).get(`close:${CONTRACT}`)?.get(entry.bucketAt.getTime())).toEqual({ status: "unavailable" });
    expect(unavailable.points).toEqual([]);
  });

  test("uses the prior completed UTC day for both midnight and afternoon FX buckets", async () => {
    const f = fixture({ readFx: async (requests) => new Map(requests.map((request) => [
      `${request.base}:${request.quote}:${request.date}`, { rate: { atoms: "91", scale: 2 }, provisional: false },
    ])) });
    const midnight = bucket("2026-03-11T00:00:00Z");
    const afternoon = bucket("2026-03-11T13:00:00Z");
    const result = await f.fill([midnight, afternoon], { fxCurrencies: ["EUR", "USD"] });
    expect(f.calls.fx).toEqual([[{ base: "USD", quote: "EUR", date: "2026-03-10" }]]);
    expect(result.get("fx:USD:EUR")?.get(afternoon.bucketAt.getTime())).toEqual({ status: "ready", value: { atoms: BigInt(91), scale: 2 }, provisional: false });
    expect(result.get("fx:USD:USD")?.get(midnight.bucketAt.getTime())).toEqual({ status: "ready", value: { atoms: BigInt(1), scale: 0 }, provisional: false });
    expect(f.points.map((point) => [point.seriesKey, point.bucketAt, point.source])).toEqual([
      ["fx:USD:EUR", midnight.bucketAt, "coinbase"], ["fx:USD:EUR", afternoon.bucketAt, "coinbase"],
    ]);
  });

  test("provisional FX is returned but never stored; missing provider rate is unavailable", async () => {
    const f = fixture({ readFx: async (requests) => new Map(requests
      .filter((request) => request.quote === "EUR")
      .map((request) => [`${request.base}:${request.quote}:${request.date}`, { rate: { atoms: "7", scale: 0 }, provisional: true }])) });
    const entry = bucket("2026-03-12T00:00:00Z");
    const result = await f.fill([entry], { fxCurrencies: ["EUR", "GBP"] });
    expect(result.get("fx:USD:EUR")?.get(entry.bucketAt.getTime())).toEqual({ status: "ready", value: { atoms: BigInt(7), scale: 0 }, provisional: true });
    expect(result.get("fx:USD:GBP")?.get(entry.bucketAt.getTime())).toEqual({ status: "unavailable" });
    expect(f.points).toEqual([]);
  });

  test("unsettled none is not cached as a settled absence", async () => {
    const f = fixture({ readCloses: async (requests) => new Map(requests.map((request) => [
      `${request.contract}:${request.timestampSeconds}`, { status: "none" as const },
    ])) });
    const entry = bucket("2026-03-12T13:00:00Z");
    expect((await f.fill([entry], { closeContracts: [CONTRACT] })).get(`close:${CONTRACT}`)?.get(entry.bucketAt.getTime())).toEqual({ status: "none" });
    expect(f.points).toEqual([]);
    await f.fill([entry], { closeContracts: [CONTRACT] });
    expect(f.calls.closes).toHaveLength(2);
  });

  test("failed providers leave their series unavailable without persisting values", async () => {
    const f = fixture({
      readCloses: async () => { throw new Error("closes unavailable"); },
      readFx: async () => { throw new Error("fx unavailable"); },
    });
    f.chain.readVaultRates = async () => { throw new Error("rpc unavailable"); };
    f.chain.readMorphoBorrowIndexes = async () => { throw new Error("rpc unavailable"); };
    const entry = bucket("2026-03-11T00:00:00Z");
    const lookup = await f.fill([entry], { vaults: [VAULT], marketIds: [MARKET], closeContracts: [CONTRACT], fxCurrencies: ["EUR"] });
    for (const key of [`vault-rate:${VAULT}`, `morpho-borrow-index:${MARKET}`, `close:${CONTRACT}`, "fx:USD:EUR"]) {
      expect(lookup.get(key)?.get(entry.bucketAt.getTime())).toEqual({ status: "unavailable" });
    }
    expect(f.points).toEqual([]);
  });

  test("prunes hourly valuation points once per fill with an eight-day cutoff and a 500-row batch", async () => {
    const f = fixture();
    await f.fill([]);
    expect(f.calls.prune).toEqual([{ cutoff: new Date(NOW.getTime() - 8 * 86_400_000), batch: 500 }]);
  });
});
