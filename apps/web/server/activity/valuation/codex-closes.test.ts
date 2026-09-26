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
const epoch = (iso: string) => Date.parse(iso) / 1_000;

function barsAt(...entries: [string, string][]) {
  return {
    t: entries.map(([iso]) => epoch(iso)),
    c: entries.map(([, close]) => close),
    s: "ok",
  };
}

function resultFor(reader: ReturnType<typeof createCodexHistoricalCloseReader>, contract: typeof TOKEN_A | typeof TOKEN_B, timestampSeconds: number) {
  const request = { contract, timestampSeconds };
  return reader([request]).then((results) => results.get(historicalCloseKey(request)));
}

describe("historical close selection", () => {
  test("uses the latest completed 15-minute close, including an exact bar-close and hour-start transfer", () => {
    const bars = [
      { startSeconds: epoch("2026-09-07T10:30:00.000Z"), close: "0.20" },
      { startSeconds: epoch("2026-09-07T10:45:00.000Z"), close: "0.2173291" },
      { startSeconds: epoch("2026-09-07T11:00:00.000Z"), close: "9.99" },
      { startSeconds: epoch("2026-09-07T11:15:00.000Z"), close: "10.50" },
    ];
    expect(selectClose(bars, TRANSFER_AT)).toMatchObject({
      status: "found", close: { closedAt: "2026-09-07T11:00:00.000Z", priceUsd: { atoms: "2173291", scale: 7 } },
    });
    expect(selectClose(bars, epoch("2026-09-07T11:00:00.000Z"))).toMatchObject({
      status: "found", close: { closedAt: "2026-09-07T11:00:00.000Z" },
    });
    expect(selectClose(bars, epoch("2026-09-07T10:59:59.000Z"))).toMatchObject({
      status: "found", close: { closedAt: "2026-09-07T10:45:00.000Z" },
    });
  });

  test("accepts a sparse close exactly 24 hours old, rejects 24 hours plus one second and a weeks-old quote", () => {
    const startSeconds = epoch("2026-09-06T10:45:00.000Z");
    const bars = [{ startSeconds, close: "1" }];
    expect(selectClose(bars, TRANSFER_AT - 5 * 60).status).toBe("found");
    expect(selectClose(bars, TRANSFER_AT - 5 * 60 + 1)).toEqual({ status: "none" });
    expect(selectClose(bars, TRANSFER_AT + 21 * 86_400)).toEqual({ status: "none" });
    expect(selectClose([], TRANSFER_AT)).toEqual({ status: "none" });
  });

  test("covers the sparse preceding day while ending at the hour boundary", () => {
    const hour = Math.floor(TRANSFER_AT / 3_600);
    const window = bucketWindow(hour);
    expect(window.from).toBe(hour * 3_600 - 86_400 - 900);
    expect(window.to).toBe(hour * 3_600 + 3_600);
  });
});

describe("Codex historical close reader", () => {
  test("one aliased request per page prices recent and older transfers by contract, independently of shared symbols", async () => {
    const bodies: { query: string; variables: Record<string, unknown> }[] = [];
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key",
      now: NOW,
      fetchImpl: (async (url, init) => {
        expect(String(url)).toBe(CODEX_GRAPHQL_ENDPOINT);
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ data: {
          b0: barsAt(
            ["2026-09-07T10:45:00.000Z", "0.10"],
            ["2026-09-07T11:00:00.000Z", "0.25"],
          ),
          b1: barsAt(["2026-09-07T10:45:00.000Z", "4.00"]),
        } });
      }),
    });
    const requests = [
      { contract: TOKEN_A, timestampSeconds: TRANSFER_AT + 15 * 60 },
      { contract: TOKEN_A, timestampSeconds: epoch("2026-09-07T11:00:00.000Z") },
      { contract: TOKEN_B, timestampSeconds: TRANSFER_AT },
    ];
    for (const results of [await reader(requests), await reader(requests)]) {
      expect(results.get(historicalCloseKey(requests[0]!))).toMatchObject({ status: "found", close: { priceUsd: { atoms: "25", scale: 2 } } });
      expect(results.get(historicalCloseKey(requests[1]!))).toMatchObject({ status: "found", close: { closedAt: "2026-09-07T11:00:00.000Z", priceUsd: { atoms: "10", scale: 2 } } });
      expect(results.get(historicalCloseKey(requests[2]!))).toMatchObject({ status: "found", close: { priceUsd: { atoms: "400", scale: 2 } } });
    }
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.variables).toMatchObject({
      s0: `${TOKEN_A}:8453`, s1: `${TOKEN_B}:8453`,
      f0: epoch("2026-09-06T10:45:00.000Z"),
      t0: epoch("2026-09-07T12:00:00.000Z"),
    });
    expect(bodies[0]!.query.match(/getBars\(/g)).toHaveLength(2);
    expect(bodies[0]!.query.match(/countback: 8/g)).toHaveLength(2);
    expect(bodies[0]!.query).toContain("removeEmptyBars: true");
  });

  test("eight non-empty bars leave room for the latest completed bar before any transfer in an hour", async () => {
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: NOW,
      fetchImpl: async () => Response.json({ data: { b0: barsAt(
        ["2026-09-07T10:45:00.000Z", "1"],
        ["2026-09-07T11:00:00.000Z", "2"],
        ["2026-09-07T11:15:00.000Z", "3"],
        ["2026-09-07T11:30:00.000Z", "4"],
        ["2026-09-07T11:45:00.000Z", "5"],
      ) } }),
    });
    expect(await resultFor(reader, TOKEN_A, epoch("2026-09-07T11:00:00.000Z"))).toMatchObject({
      status: "found", close: { closedAt: "2026-09-07T11:00:00.000Z", priceUsd: { atoms: "1" } },
    });
  });

  test("isolates a failed alias and never caches provider failure", async () => {
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: NOW,
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ data: { b0: barsAt(["2026-09-07T10:45:00.000Z", "1.5"]), b1: null }, errors: [{ message: "token not found", path: ["b1"] }] });
      },
    });
    const requests = [{ contract: TOKEN_A, timestampSeconds: TRANSFER_AT }, { contract: TOKEN_B, timestampSeconds: TRANSFER_AT }];
    const results = await reader(requests);
    expect(results.get(historicalCloseKey(requests[0]!))?.status).toBe("found");
    expect(results.get(historicalCloseKey(requests[1]!))).toEqual({ status: "unavailable" });
    await reader([requests[1]!]);
    expect(calls).toBe(2);
  });

  test("reports unavailable without a request when Codex is not configured or fails", async () => {
    let calls = 0;
    const unconfigured = createCodexHistoricalCloseReader({ apiKey: " ", fetchImpl: async () => { calls += 1; return Response.json({}); } });
    expect(await resultFor(unconfigured, TOKEN_A, TRANSFER_AT)).toEqual({ status: "unavailable" });
    expect(calls).toBe(0);
    const failing = createCodexHistoricalCloseReader({ apiKey: "fixture-key", fetchImpl: async () => new Response("", { status: 502 }) });
    expect(await resultFor(failing, TOKEN_A, TRANSFER_AT)).toEqual({ status: "unavailable" });
  });

  test("drops a forming or future bar and refetches after it closes", async () => {
    let nowMs = Date.parse("2026-09-07T11:14:30.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs),
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ data: { b0: barsAt(
          ["2026-09-07T10:45:00.000Z", "1.00"],
          ["2026-09-07T11:00:00.000Z", "2.00"],
          ["2026-09-07T11:15:00.000Z", "3.00"],
        ) } });
      },
    });
    expect(await resultFor(reader, TOKEN_A, epoch("2026-09-07T11:15:00.000Z"))).toMatchObject({ close: { closedAt: "2026-09-07T11:00:00.000Z" } });
    nowMs = Date.parse("2026-09-07T11:14:50.000Z");
    expect(await resultFor(reader, TOKEN_A, epoch("2026-09-07T11:14:45.000Z"))).toMatchObject({ close: { closedAt: "2026-09-07T11:00:00.000Z" } });
    expect(calls).toBe(1);
    nowMs = Date.parse("2026-09-07T11:15:20.000Z");
    expect(await resultFor(reader, TOKEN_A, epoch("2026-09-07T11:15:10.000Z"))).toMatchObject({ close: { closedAt: "2026-09-07T11:15:00.000Z", priceUsd: { atoms: "200" } } });
    expect(calls).toBe(2);
  });

  test("shares an in-flight bucket within a bar but refetches across a bar boundary", async () => {
    let nowMs = Date.parse("2026-09-07T11:14:50.000Z");
    const releases: (() => void)[] = [];
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs),
      fetchImpl: async () => {
        await new Promise<void>((resolve) => releases.push(resolve));
        return Response.json({ data: { b0: barsAt(["2026-09-07T10:45:00.000Z", "1.00"], ["2026-09-07T11:00:00.000Z", "2.00"]) } });
      },
    });
    const early = resultFor(reader, TOKEN_A, epoch("2026-09-07T11:14:40.000Z"));
    const sameBar = resultFor(reader, TOKEN_A, epoch("2026-09-07T11:14:40.000Z"));
    expect(releases).toHaveLength(1);
    nowMs = Date.parse("2026-09-07T11:15:20.000Z");
    const late = resultFor(reader, TOKEN_A, epoch("2026-09-07T11:15:10.000Z"));
    expect(releases).toHaveLength(2);
    releases.forEach((release) => release());
    expect(await early).toMatchObject({ close: { closedAt: "2026-09-07T11:00:00.000Z" } });
    expect(await sameBar).toMatchObject({ close: { closedAt: "2026-09-07T11:00:00.000Z" } });
    expect(await late).toMatchObject({ close: { closedAt: "2026-09-07T11:15:00.000Z" } });
  });

  test("settled snapshot refetches after its TTL when delayed provider bars arrive", async () => {
    let nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs),
      fetchImpl: async () => Response.json({ data: { b0: barsAt(
        ["2026-09-07T10:30:00.000Z", "1"],
        ...(++calls === 1 ? [] : [["2026-09-07T10:45:00.000Z", "2"] as [string, string]]),
      ) } }),
    });
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ close: { priceUsd: { atoms: "1" } } });
    nowMs += 60_001;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ close: { priceUsd: { atoms: "1" } } });
    expect(calls).toBe(1);
    nowMs += 86_400_000;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    expect(calls).toBe(2);
  });

  test("recent snapshot refetches delayed provider bars once recent TTL expires", async () => {
    let nowMs = Date.parse("2026-09-07T11:20:00.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs),
      fetchImpl: async () => Response.json({ data: { b0: barsAt(
        ["2026-09-07T10:45:00.000Z", "1"],
        ...(++calls === 1 ? [] : [["2026-09-07T11:00:00.000Z", "2"] as [string, string]]),
      ) } }),
    });
    const at = epoch("2026-09-07T11:16:00.000Z");
    expect(await resultFor(reader, TOKEN_A, at)).toMatchObject({ close: { priceUsd: { atoms: "1" } } });
    nowMs += 60_000;
    expect(await resultFor(reader, TOKEN_A, at)).toMatchObject({ close: { priceUsd: { atoms: "1" } } });
    nowMs += 1;
    expect(await resultFor(reader, TOKEN_A, at)).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    expect(calls).toBe(2);
  });

  test("empty settled bucket has only recent TTL and recovers after a transient no-data response", async () => {
    let nowMs = Date.parse("2026-09-10T00:00:00.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs),
      fetchImpl: async () => Response.json({ data: { b0: ++calls === 1 ? { t: [], c: [], s: "no_data" } : barsAt(["2026-09-07T10:45:00.000Z", "3"]) } }),
    });
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toEqual({ status: "none" });
    nowMs += 60_000;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toEqual({ status: "none" });
    nowMs += 1;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ status: "found", close: { priceUsd: { atoms: "3" } } });
    expect(calls).toBe(2);
  });

  test("fetch failure or simulated timeout uses only an eligible expired entry, never caches failures or renews freshness", async () => {
    let nowMs = Date.parse("2026-09-07T11:20:00.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs), timeoutMs: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 3) throw new DOMException("timed out", "AbortError"); if (calls > 1) return new Response("", { status: 504 });
        return Response.json({ data: { b0: barsAt(["2026-09-07T10:45:00.000Z", "1"]) } });
      },
    });
    const early = epoch("2026-09-07T11:16:00.000Z");
    const late = epoch("2026-09-07T11:30:01.000Z");
    expect(await resultFor(reader, TOKEN_A, early)).toMatchObject({ status: "found" });
    nowMs = Date.parse("2026-09-07T11:21:01.000Z");
    expect(await resultFor(reader, TOKEN_A, early)).toMatchObject({ status: "found", close: { priceUsd: { atoms: "1" } } });
    expect(await resultFor(reader, TOKEN_A, early)).toMatchObject({ status: "found" });
    expect(await resultFor(reader, TOKEN_A, late)).toEqual({ status: "unavailable" });
    expect(calls).toBe(4);
  });

  test("expired empty entry remains none only when fetched after the requested bar began", async () => {
    let nowMs = Date.parse("2026-09-07T11:20:00.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({ apiKey: "fixture-key", now: () => new Date(nowMs),
      fetchImpl: async () => ++calls === 1
        ? Response.json({ data: { b0: { t: [], c: [], s: "no_data" } } })
        : new Response("", { status: 502 }),
    });
    const early = epoch("2026-09-07T11:16:00.000Z");
    expect(await resultFor(reader, TOKEN_A, early)).toEqual({ status: "none" });
    nowMs += 60_001;
    expect(await resultFor(reader, TOKEN_A, early)).toEqual({ status: "none" });
    expect(await resultFor(reader, TOKEN_A, epoch("2026-09-07T11:30:00.000Z"))).toEqual({ status: "unavailable" });
    expect(calls).toBe(3);
  });
});
