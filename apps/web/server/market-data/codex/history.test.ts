import { describe, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { CodexMarketDataError } from "./client";
import { CODEX_GRAPHQL_ENDPOINT } from "./config";
import {
  CODEX_BARS_QUERY,
  createCodexMarketHistoryReader,
  MARKET_HISTORY_WINDOWS,
} from "./history";

const NOW_ISO = "2026-09-07T20:30:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const now = () => new Date(NOW_MS);
const bitcoin = investAssets.find((asset) => asset.id === "cbbtc")!;

function barsResponse(
  points: { t: number; c: string | null }[],
  status = "ok",
) {
  return Response.json({
    data: {
      getBars: {
        t: points.map((point) => point.t),
        c: points.map((point) =>
          point.c === null ? null : Number(point.c),
        ),
        s: status,
      },
    },
  });
}

function rawBarsResponse(getBars: unknown) {
  return Response.json({ data: { getBars } });
}

describe("Codex market history reader", () => {
  test("requests getBars for an allowlisted Base token and preserves close lexemes", async () => {
    const seen: { url?: string; body?: unknown } = {};
    const reader = createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: (async (url, init) => {
        seen.url = String(url);
        seen.body = JSON.parse(String(init?.body));
        return new Response(
          `{"data":{"getBars":{"t":[1757200000,1757286400],"c":[62000.125,64210.5],"s":"ok"}}}`,
          { headers: { "content-type": "application/json" } },
        );
      }),
    });

    const result = await reader("cbbtc", "1W");
    const window = MARKET_HISTORY_WINDOWS["1W"];
    const to = Math.floor(NOW_MS / 1000);

    expect(seen.url).toBe(CODEX_GRAPHQL_ENDPOINT);
    expect(CODEX_BARS_QUERY).toContain("getBars");
    expect(CODEX_BARS_QUERY).toContain("symbolType: TOKEN");
    expect(seen.body).toEqual({
      query: CODEX_BARS_QUERY,
      variables: {
        symbol: `${bitcoin.contractAddress.toLowerCase()}:8453`,
        from: to - window.durationSeconds,
        to,
        resolution: window.resolution,
      },
    });
    expect(result).toEqual({
      version: 1,
      provider: "codex",
      assetId: "cbbtc",
      range: "1W",
      fetchedAt: NOW_ISO,
      status: "ready",
      points: [
        { time: new Date(1757200000 * 1000).toISOString(), value: "62000.125" },
        { time: new Date(1757286400 * 1000).toISOString(), value: "64210.5" },
      ],
    });
  });

  test("returns empty for explicit no_data and valid empty ok bars", async () => {
    const noData = await createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => barsResponse([], "no_data"),
    })("cbbtc", "1D");
    const emptyOk = await createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => barsResponse([]),
    })("cbbtc", "1D");

    expect(noData).toMatchObject({ status: "empty", points: [] });
    expect(emptyOk).toMatchObject({ status: "empty", points: [] });
  });

  test("accepts nullable close values and preserves valid non-null close lexemes", async () => {
    const result = await createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () =>
        barsResponse([
          { t: 1757200000, c: null },
          { t: 1757286400, c: "64210.5" },
        ]),
    })("cbbtc", "1D");
    const allNull = await createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => barsResponse([{ t: 1757200000, c: null }]),
    })("cbbtc", "1D");

    expect(result).toMatchObject({
      status: "ready",
      points: [
        { time: new Date(1757286400 * 1000).toISOString(), value: "64210.5" },
      ],
    });
    expect(allNull).toMatchObject({ status: "empty", points: [] });
  });

  test("rejects malformed bar structures and values instead of treating them as empty", async () => {
    const malformedBars = [
      { s: "ok", t: [1757332800], c: [] },
      { s: "ok", t: [] },
      { s: "ok", c: [] },
      { t: [], c: [] },
      { s: "unexpected", t: [], c: [] },
      { s: "ok", t: ["bad-timestamp"], c: [1] },
      { s: "ok", t: [1757332800], c: ["bad-price"] },
    ];

    for (const getBars of malformedBars) {
      const reader = createCodexMarketHistoryReader({
        apiKey: "fixture-key",
        now,
        fetchImpl: async () => rawBarsResponse(getBars),
      });

      await expect(reader("cbbtc", "1D")).rejects.toBeInstanceOf(
        CodexMarketDataError,
      );
    }
  });

  test("does not cache malformed history and recovers from a valid response", async () => {
    let calls = 0;
    const reader = createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? rawBarsResponse({ s: "ok", t: [1757332800], c: [] })
          : barsResponse([{ t: 1757332800, c: "64210.5" }]);
      },
    });

    await expect(reader("cbbtc", "1D")).rejects.toBeInstanceOf(
      CodexMarketDataError,
    );
    await expect(reader("cbbtc", "1D")).resolves.toMatchObject({
      status: "ready",
      points: [{ value: "64210.5" }],
    });
    expect(calls).toBe(2);
  });

  test("rejects unknown assets and ranges without calling Codex", async () => {
    let calls = 0;
    const reader = createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not run");
      },
    });

    expect(await reader("not-an-asset", "1W")).toMatchObject({
      status: "unavailable",
      unavailableReason: "unknown-asset",
      points: [],
    });
    expect(await reader("cbbtc", "2Y")).toMatchObject({
      status: "unavailable",
      unavailableReason: "invalid-range",
      points: [],
    });
    expect(calls).toBe(0);
  });

  test("does not call the network when the server-only key is missing", async () => {
    let calls = 0;
    const result = await createCodexMarketHistoryReader({
      apiKey: undefined,
      now,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not run");
      },
    })("cbbtc", "1W");

    expect(calls).toBe(0);
    expect(result.unavailableReason).toBe("not-configured");
    expect(result.points).toEqual([]);
  });

  test("does not normalize GraphQL failures as history points", async () => {
    const reader = createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now,
      fetchImpl: async () =>
        Response.json({
          data: null,
          errors: [{ message: "private upstream detail" }],
        }),
    });

    await expect(reader("cbbtc", "1W")).rejects.toBeInstanceOf(CodexMarketDataError);
  });
});
