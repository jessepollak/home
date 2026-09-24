import { describe, expect, test } from "bun:test";
import { CODEX_GRAPHQL_ENDPOINT } from "@/server/market-data/codex/config";
import {
  bucketWindow,
  createCodexHistoricalCloseReader,
  historicalCloseKey,
  selectClose,
} from "./codex-closes";

const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const TRANSFER_AT = Date.parse("2026-09-07T11:05:00.000Z") / 1_000;
const NOW = () => new Date("2026-09-10T00:00:00.000Z");

function barsAt(...entries: [string, string][]) {
  return {
    t: entries.map(([iso]) => Date.parse(iso) / 1_000),
    c: entries.map(([, close]) => close),
    s: "ok",
  };
}

describe("historical close selection", () => {
  test("uses the latest completed 15-minute close at or before the transfer", () => {
    const result = selectClose([
      { startSeconds: Date.parse("2026-09-07T10:30:00.000Z") / 1_000, close: "0.20" },
      { startSeconds: Date.parse("2026-09-07T10:45:00.000Z") / 1_000, close: "0.2173291" },
      { startSeconds: Date.parse("2026-09-07T11:00:00.000Z") / 1_000, close: "9.99" },
      { startSeconds: Date.parse("2026-09-07T11:15:00.000Z") / 1_000, close: "10.50" },
    ], TRANSFER_AT);
    expect(result).toEqual({
      status: "found",
      close: {
        provider: "Codex",
        closedAt: "2026-09-07T11:00:00.000Z",
        resolutionMinutes: 15,
        priceUsd: { atoms: "2173291", scale: 7 },
      },
    });
  });

  test("accepts a close exactly one hour old and rejects anything older", () => {
    const exactlyOneHour = Date.parse("2026-09-07T09:50:00.000Z") / 1_000;
    expect(selectClose([{ startSeconds: exactlyOneHour, close: "1" }], TRANSFER_AT).status)
      .toBe("found");
    expect(selectClose([{ startSeconds: exactlyOneHour - 1, close: "1" }], TRANSFER_AT))
      .toEqual({ status: "none" });
    expect(selectClose([], TRANSFER_AT)).toEqual({ status: "none" });
  });

  test("covers every close a transfer inside its hour bucket could need", () => {
    const hour = Math.floor(TRANSFER_AT / 3_600);
    const window = bucketWindow(hour);
    expect(window.from).toBe(hour * 3_600 - 3_600 - 900);
    expect(window.to).toBe(hour * 3_600 + 3_600);
  });
});

describe("Codex historical close reader", () => {
  test("batches one aliased request per page, keyed by exact contract and hour bucket, then serves settled buckets from cache", async () => {
    const bodies: { query: string; variables: Record<string, unknown> }[] = [];
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key",
      now: NOW,
      fetchImpl: (async (url, init) => {
        expect(String(url)).toBe(CODEX_GRAPHQL_ENDPOINT);
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          data: {
            b0: barsAt(["2026-09-07T10:45:00.000Z", "0.25"]),
            b1: barsAt(["2026-09-07T10:45:00.000Z", "4.00"]),
          },
        });
      }),
    });
    const requests = [
      { contract: TOKEN_A, timestampSeconds: TRANSFER_AT },
      { contract: TOKEN_A, timestampSeconds: TRANSFER_AT + 60 },
      { contract: TOKEN_B, timestampSeconds: TRANSFER_AT },
    ];

    const first = await reader(requests);
    const second = await reader(requests);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.variables).toMatchObject({
      s0: `${TOKEN_A}:8453`,
      s1: `${TOKEN_B}:8453`,
    });
    expect(bodies[0]!.query).toContain("b1: getBars");
    expect(bodies[0]!.query).toContain("currencyCode: \"USD\"");
    expect(bodies[0]!.query).toContain("resolution: \"15\"");
    for (const results of [first, second]) {
      expect(results.get(historicalCloseKey(requests[0]!))).toMatchObject({
        status: "found",
        close: { priceUsd: { atoms: "25", scale: 2 } },
      });
      expect(results.get(historicalCloseKey(requests[2]!))).toMatchObject({
        status: "found",
        close: { priceUsd: { atoms: "400", scale: 2 } },
      });
    }
  });

  test("isolates a failed alias and never caches provider failure", async () => {
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key",
      now: NOW,
      fetchImpl: (async () => {
        calls += 1;
        return Response.json({
          data: { b0: barsAt(["2026-09-07T10:45:00.000Z", "1.5"]), b1: null },
          errors: [{ message: "token not found", path: ["b1"] }],
        });
      }),
    });
    const requests = [
      { contract: TOKEN_A, timestampSeconds: TRANSFER_AT },
      { contract: TOKEN_B, timestampSeconds: TRANSFER_AT },
    ];

    const results = await reader(requests);
    expect(results.get(historicalCloseKey(requests[0]!))?.status).toBe("found");
    expect(results.get(historicalCloseKey(requests[1]!))).toEqual({ status: "unavailable" });

    await reader([requests[1]!]);
    expect(calls).toBe(2);
  });

  test("reports unavailable without a request when Codex is not configured or fails", async () => {
    let calls = 0;
    const unconfigured = createCodexHistoricalCloseReader({
      apiKey: " ",
      fetchImpl: (async () => {
        calls += 1;
        return Response.json({});
      }),
    });
    const request = { contract: TOKEN_A, timestampSeconds: TRANSFER_AT };
    expect((await unconfigured([request])).get(historicalCloseKey(request)))
      .toEqual({ status: "unavailable" });
    expect(calls).toBe(0);

    const failing = createCodexHistoricalCloseReader({
      apiKey: "fixture-key",
      fetchImpl: async () => new Response("", { status: 502 }),
    });
    expect((await failing([request])).get(historicalCloseKey(request)))
      .toEqual({ status: "unavailable" });
  });

  test("drops a bar that was still forming when fetched and refetches once that bar has closed", async () => {
    let nowMs = Date.parse("2026-09-07T11:14:30.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key",
      now: () => new Date(nowMs),
      fetchImpl: async () => {
        calls += 1;
        return Response.json({
          data: {
            b0: barsAt(
              ["2026-09-07T10:45:00.000Z", "1.00"],
              ["2026-09-07T11:00:00.000Z", "2.00"],
            ),
          },
        });
      },
    });
    await reader([{ contract: TOKEN_A, timestampSeconds: TRANSFER_AT }]);

    nowMs = Date.parse("2026-09-07T11:14:50.000Z");
    const beforeClose = { contract: TOKEN_A, timestampSeconds: Date.parse("2026-09-07T11:14:45.000Z") / 1_000 };
    expect((await reader([beforeClose])).get(historicalCloseKey(beforeClose))).toMatchObject({
      status: "found",
      close: { closedAt: "2026-09-07T11:00:00.000Z", priceUsd: { atoms: "100", scale: 2 } },
    });
    expect(calls).toBe(1);

    nowMs = Date.parse("2026-09-07T11:15:20.000Z");
    const afterClose = { contract: TOKEN_A, timestampSeconds: Date.parse("2026-09-07T11:15:10.000Z") / 1_000 };
    expect((await reader([afterClose])).get(historicalCloseKey(afterClose))).toMatchObject({
      status: "found",
      close: { closedAt: "2026-09-07T11:15:00.000Z", priceUsd: { atoms: "200", scale: 2 } },
    });
    expect(calls).toBe(2);
  });

  test("shares an in-flight bucket within one bar but refetches once a bar closes mid-flight", async () => {
    let nowMs = Date.parse("2026-09-07T11:14:50.000Z");
    const releases: (() => void)[] = [];
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key",
      now: () => new Date(nowMs),
      fetchImpl: async () => {
        await new Promise<void>((resolve) => releases.push(resolve));
        return Response.json({
          data: {
            b0: barsAt(
              ["2026-09-07T10:45:00.000Z", "1.00"],
              ["2026-09-07T11:00:00.000Z", "2.00"],
            ),
          },
        });
      },
    });
    const early = { contract: TOKEN_A, timestampSeconds: Date.parse("2026-09-07T11:14:40.000Z") / 1_000 };
    const first = reader([early]);
    const sameBar = reader([early]);
    expect(releases).toHaveLength(1);

    nowMs = Date.parse("2026-09-07T11:15:20.000Z");
    const late = { contract: TOKEN_A, timestampSeconds: Date.parse("2026-09-07T11:15:10.000Z") / 1_000 };
    const afterBoundary = reader([late]);
    expect(releases).toHaveLength(2);
    releases.forEach((release) => release());

    expect((await first).get(historicalCloseKey(early))).toMatchObject({
      close: { closedAt: "2026-09-07T11:00:00.000Z" },
    });
    expect((await sameBar).get(historicalCloseKey(early))).toMatchObject({
      close: { closedAt: "2026-09-07T11:00:00.000Z" },
    });
    expect((await afterBoundary).get(historicalCloseKey(late))).toMatchObject({
      status: "found",
      close: { closedAt: "2026-09-07T11:15:00.000Z", priceUsd: { atoms: "200", scale: 2 } },
    });
  });

  test("distinguishes no trading data from provider failure", async () => {
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key",
      now: NOW,
      fetchImpl: (async () => Response.json({
        data: { b0: { t: [], c: [], s: "no_data" } },
      })),
    });
    const request = { contract: TOKEN_A, timestampSeconds: TRANSFER_AT };
    expect((await reader([request])).get(historicalCloseKey(request)))
      .toEqual({ status: "none" });
  });
});
