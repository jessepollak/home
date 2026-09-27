import { describe, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { parseMarketStatsResponse } from "@/shared/invest/contracts/market-stats";
import { createCodexMarketStatsReader } from "./market-stats";

const now = () => new Date("2026-09-13T12:00:00.000Z");
const bitcoin = investAssets.find((asset) => asset.id === "cbbtc")!;
const litecoin = investAssets.find((asset) => asset.id === "cbltc")!;

function result(address: string = bitcoin.contractAddress, networkId: string | number = "8453") {
  return {
    token: { address, networkId },
    marketCap: "123.456",
    volume24: "10.25",
    liquidity: "9.5",
  };
}

function payload(results: unknown[]) {
  return Response.json({ data: { filterTokens: { results } } });
}

describe("Codex market stats reader", () => {
  test("queries the exact Base contract and preserves numeric lexemes and positive USD fields", async () => {
    let variables: unknown;
    let query = "";
    const reader = createCodexMarketStatsReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { variables: unknown; query: string };
        variables = body.variables;
        query = body.query;
        return new Response(`{"data":{"filterTokens":{"results":[{"token":{"address":"${bitcoin.contractAddress.toUpperCase().replace("0X", "0x")}","networkId":8453},"marketCap":12345678901234567890.123,"volume24":"0.000001","liquidity":9.5}]}}}`);
      },
    });

    const response = await reader("cbbtc");
    expect(variables).toEqual({ tokens: [`${bitcoin.contractAddress.toLowerCase()}:8453`], limit: 1 });
    expect(query).toContain("marketCap");
    expect(query).toContain("volume24");
    expect(query).toContain("liquidity");
    expect(response).toEqual({
      version: 1,
      provider: "codex",
      assetId: "cbbtc",
      currency: "USD",
      fetchedAt: "2026-09-13T12:00:00.000Z",
      status: "ready",
      stats: {
        marketCapUsd: { atoms: "12345678901234567890123", scale: 3 },
        volume24hUsd: { atoms: "1", scale: 6 },
        liquidityUsd: { atoms: "95", scale: 1 },
      },
    });
    expect(parseMarketStatsResponse(response)).toEqual(response);
  });

  test("omits missing, zero, negative, malformed and out-of-range stats", async () => {
    const reader = createCodexMarketStatsReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => payload([{ ...result(), marketCap: "0", volume24: "-5", liquidity: "1e-40" }]),
    });
    expect((await reader("cbbtc")).stats).toEqual({});
    const missing = createCodexMarketStatsReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => payload([{ token: result().token, marketCap: "5", liquidity: "nope" }]),
    });
    expect((await missing("cbbtc")).stats).toEqual({ marketCapUsd: { atoms: "5", scale: 0 } });
  });

  test("does not attribute mismatched addresses, networks or multiple tokens to the requested asset", async () => {
    for (const results of [
      [result(litecoin.contractAddress)],
      [result(bitcoin.contractAddress, "1")],
      [result(), result()],
      [],
    ]) {
      const reader = createCodexMarketStatsReader({ apiKey: "fixture-key", now, fetchImpl: async () => payload(results) });
      expect(await reader("cbbtc")).toMatchObject({ status: "ready", stats: {} });
    }
  });

  test("never requests stocks or unknown assets, even without a key", async () => {
    let calls = 0;
    const reader = createCodexMarketStatsReader({
      apiKey: undefined,
      fetchImpl: async () => {
        calls += 1;
        return payload([result()]);
      },
    });
    expect(await reader("nvdac")).toMatchObject({ status: "unavailable", unavailableReason: "unsupported-asset", stats: {} });
    expect(await reader("cbbtc")).toMatchObject({ status: "unavailable", unavailableReason: "not-configured", stats: {} });
    expect(await reader("not-an-asset")).toMatchObject({ status: "unavailable", unavailableReason: "unknown-asset", assetId: null });
    expect(calls).toBe(0);
  });

  test("returns sanitized errors without caching provider failures", async () => {
    let calls = 0;
    const reader = createCodexMarketStatsReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? Response.json({ errors: [{ message: "secret" }] }) : payload([result()]);
      },
    });
    expect(await reader("cbbtc")).toMatchObject({ status: "error", stats: {}, fetchedAt: null });
    expect(await reader("cbbtc")).toMatchObject({ status: "ready", stats: { marketCapUsd: { atoms: "123456", scale: 3 } } });
    expect(calls).toBe(2);
  });

  test("deduplicates in flight reads, caches ready responses for 60 seconds, and evicts oldest entries", async () => {
    let time = Date.parse("2026-09-13T12:00:00.000Z");
    let calls = 0;
    let release!: (response: Response) => void;
    const reader = createCodexMarketStatsReader({
      apiKey: "fixture-key",
      now: () => new Date(time),
      cacheMaxEntries: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Promise<Response>((resolve) => { release = resolve; });
        return payload([result(calls === 2 ? litecoin.contractAddress : bitcoin.contractAddress)]);
      },
    });
    const first = reader("cbbtc");
    const coalesced = reader("cbbtc");
    expect(calls).toBe(1);
    release(payload([result()]));
    expect(await first).toEqual(await coalesced);
    time += 59_999;
    await reader("cbbtc");
    expect(calls).toBe(1);
    await reader("cbltc");
    expect(calls).toBe(2);
    await reader("cbbtc");
    expect(calls).toBe(3);
    time += 60_001;
    await reader("cbbtc");
    expect(calls).toBe(4);
  });

  test("bounds simultaneous distinct provider calls", async () => {
    let calls = 0;
    let release!: (response: Response) => void;
    const reader = createCodexMarketStatsReader({
      apiKey: "fixture-key",
      maxInFlight: 1,
      fetchImpl: async () => {
        calls += 1;
        return new Promise<Response>((resolve) => { release = resolve; });
      },
    });
    const first = reader("cbbtc");
    expect(await reader("cbltc")).toMatchObject({ status: "error", stats: {} });
    expect(calls).toBe(1);
    release(payload([result()]));
    await first;
  });
});
