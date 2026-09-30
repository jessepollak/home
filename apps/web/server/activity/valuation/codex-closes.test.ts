import { describe, expect, test } from "bun:test";
import { CODEX_GRAPHQL_ENDPOINT } from "@/server/market-data/codex/config";
import { createWriteOrder } from "@/server/cache/write-order";
import {
  bucketWindow,
  ACTIVITY_CLOSE_STALE_RETENTION_MS,
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

function deferredResponse() {
  return Promise.withResolvers<Response>();
}

function closeResponse(amount: string, count = 1) {
  return Response.json({ data: Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `b${index}`, barsAt(["2026-09-07T10:45:00.000Z", amount]),
    ]),
  ) });
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

  test("treats a zero close as none rather than a found zero price", () => {
    expect(selectClose([{ startSeconds: epoch("2026-09-07T10:45:00.000Z"), close: "0" }], TRANSFER_AT)).toEqual({ status: "none" });
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

  test("evicts the least recently used bucket at capacity", async () => {
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: NOW, cacheMaxEntries: 2,
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ data: { b0: barsAt(["2026-09-07T10:45:00.000Z", "1"]) } });
      },
    });
    await resultFor(reader, TOKEN_A, TRANSFER_AT);
    await resultFor(reader, TOKEN_B, TRANSFER_AT);
    await resultFor(reader, TOKEN_A, TRANSFER_AT);
    await resultFor(reader, TOKEN_A, TRANSFER_AT + 3_600);
    await resultFor(reader, TOKEN_A, TRANSFER_AT);
    expect(calls).toBe(3);
    await resultFor(reader, TOKEN_B, TRANSFER_AT);
    expect(calls).toBe(4);
  });

  test("an expired close on failed refetch does not evict a fresh close", async () => {
    let nowMs = Date.parse("2026-09-07T11:20:00.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs), cacheMaxEntries: 2,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 3 || calls === 5) return new Response("", { status: 502 });
        const bar = calls === 1 ? "2026-09-07T11:00:00.000Z"
          : calls === 2 ? "2026-09-07T09:45:00.000Z" : "2026-09-07T08:45:00.000Z";
        return Response.json({ data: { b0: barsAt([bar, String(calls)]) } });
      },
    });
    const recent = epoch("2026-09-07T11:16:00.000Z");
    const settled = epoch("2026-09-07T10:05:00.000Z");
    expect(await resultFor(reader, TOKEN_A, recent)).toMatchObject({ status: "found" });
    expect(await resultFor(reader, TOKEN_B, settled)).toMatchObject({ status: "found" });
    nowMs += 60_001;
    expect(await resultFor(reader, TOKEN_A, recent)).toMatchObject({ status: "found" });
    expect(await resultFor(reader, TOKEN_A, epoch("2026-09-07T09:05:00.000Z"))).toMatchObject({ status: "found" });
    expect(await resultFor(reader, TOKEN_B, settled)).toMatchObject({ status: "found", close: { priceUsd: { atoms: "2" } } });
    expect(calls).toBe(4);
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
    await Promise.resolve();
    expect(releases).toHaveLength(1);
    nowMs = Date.parse("2026-09-07T11:15:20.000Z");
    const late = resultFor(reader, TOKEN_A, epoch("2026-09-07T11:15:10.000Z"));
    await Promise.resolve();
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

  test("uses an expired settled close on failure only within stale retention", async () => {
    let nowMs = Date.parse("2026-09-10T00:00:00.000Z");
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs),
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ data: { b0: barsAt(["2026-09-07T10:45:00.000Z", "1"]) } })
          : new Response("", { status: 502 });
      },
    });
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ status: "found" });
    nowMs += 24 * 60 * 60 * 1_000 + 1;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ status: "found", close: { priceUsd: { atoms: "1" } } });
    nowMs += ACTIVITY_CLOSE_STALE_RETENTION_MS - 24 * 60 * 60 * 1_000;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toEqual({ status: "unavailable" });
    expect(calls).toBe(3);
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

  test("write order prevents an older flight from repopulating an evicted newer close", async () => {
    let nowMs = NOW().getTime();
    const flights: ReturnType<typeof deferredResponse>[] = [];
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs), cacheMaxEntries: 1,
      fetchImpl: () => { const flight = deferredResponse(); flights.push(flight); return flight.promise; },
    });
    const older = resultFor(reader, TOKEN_A, TRANSFER_AT);
    nowMs += 900_000;
    const newer = resultFor(reader, TOKEN_A, TRANSFER_AT);
    await Promise.resolve();
    expect(flights).toHaveLength(2);
    flights[1]!.resolve(closeResponse("2"));
    expect(await newer).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    const eviction = resultFor(reader, TOKEN_B, TRANSFER_AT);
    await Promise.resolve();
    flights[2]!.resolve(closeResponse("3"));
    await eviction;
    flights[0]!.resolve(closeResponse("1"));
    await older;
    const reread = resultFor(reader, TOKEN_A, TRANSFER_AT);
    await Promise.resolve();
    flights[3]?.resolve(closeResponse("2"));
    expect(await reread).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    expect(flights).toHaveLength(4);
  });

  test("write order preserves same-tick in-flight sharing and one cached close", async () => {
    const flight = deferredResponse();
    const writeOrder = createWriteOrder();
    let calls = 0;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: NOW, cacheMaxEntries: 1, writeOrder,
      fetchImpl: () => { calls += 1; return flight.promise; },
    });
    const first = resultFor(reader, TOKEN_A, TRANSFER_AT);
    const second = resultFor(reader, TOKEN_A, TRANSFER_AT);
    await Promise.resolve();
    expect(calls).toBe(1);
    const outstandingKeys = writeOrder.size;
    flight.resolve(closeResponse("2"));
    expect(await first).toEqual(await second);
    expect(outstandingKeys).toBe(1);
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    expect(calls).toBe(1);
    expect(writeOrder.size).toBe(0);
  });

  test("write order lets a flight started one second later across a bar boundary win", async () => {
    let nowMs = Date.parse("2026-09-10T00:14:59.000Z");
    const flights: ReturnType<typeof deferredResponse>[] = [];
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs), cacheMaxEntries: 1,
      fetchImpl: () => { const flight = deferredResponse(); flights.push(flight); return flight.promise; },
    });
    const older = resultFor(reader, TOKEN_A, TRANSFER_AT);
    nowMs += 1_000;
    const newer = resultFor(reader, TOKEN_A, TRANSFER_AT);
    await Promise.resolve();
    expect(flights).toHaveLength(2);
    flights[1]!.resolve(closeResponse("2"));
    await newer;
    flights[0]!.resolve(closeResponse("1"));
    await older;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    expect(flights).toHaveLength(2);
  });

  test("write order prevents a late joiner from rewriting its creator's completed flight", async () => {
    let nowMs = NOW().getTime();
    const flights: ReturnType<typeof deferredResponse>[] = [];
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", now: () => new Date(nowMs), cacheMaxEntries: 3,
      fetchImpl: () => { const flight = deferredResponse(); flights.push(flight); return flight.promise; },
    });
    const key = { contract: TOKEN_A, timestampSeconds: TRANSFER_AT };
    const creator = reader([key, { contract: TOKEN_B, timestampSeconds: TRANSFER_AT }]);
    const joiner = reader([key, { contract: TOKEN_B, timestampSeconds: TRANSFER_AT - 3_600 }]);
    await Promise.resolve();
    expect(flights).toHaveLength(2);
    flights[0]!.resolve(closeResponse("1", 2));
    await creator;
    const eviction = reader([
      { contract: TOKEN_A, timestampSeconds: TRANSFER_AT - 3_600 },
      { contract: TOKEN_A, timestampSeconds: TRANSFER_AT - 7_200 },
    ]);
    await Promise.resolve();
    flights[2]!.resolve(closeResponse("4", 2));
    await eviction;
    nowMs += 900_000;
    const newer = reader([key]);
    await Promise.resolve();
    flights[3]!.resolve(closeResponse("2"));
    await newer;
    flights[1]!.resolve(closeResponse("3"));
    await joiner;
    expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    expect(flights).toHaveLength(4);
  });

  test("a clock failure while caching a settled flight rejects the read without an unhandled rejection", async () => {
    const writeOrder = createWriteOrder();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      let nowCalls = 0;
      const reader = createCodexHistoricalCloseReader({
        apiKey: "fixture-key", writeOrder,
        now: () => {
          nowCalls += 1;
          if (nowCalls === 3) throw new Error("settle clock failed");
          return NOW();
        },
        fetchImpl: async () => closeResponse("1"),
      });
      await expect(resultFor(reader, TOKEN_A, TRANSFER_AT)).rejects.toThrow("settle clock failed");
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(writeOrder.size).toBe(0);
      expect(await resultFor(reader, TOKEN_A, TRANSFER_AT)).toMatchObject({ close: { priceUsd: { atoms: "1" } } });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("write order releases prepared flights after a later chunk's preparation throws", async () => {
    const writeOrder = createWriteOrder();
    const flights: ReturnType<typeof deferredResponse>[] = [];
    let nowMs = NOW().getTime();
    let nowCalls = 0;
    let failed = false;
    const reader = createCodexHistoricalCloseReader({
      apiKey: "fixture-key", cacheMaxEntries: 1, writeOrder,
      now: () => {
        nowCalls += 1;
        if (!failed && nowCalls === 3) { failed = true; throw new Error("preparation failed"); }
        return new Date(nowMs);
      },
      fetchImpl: () => { const flight = deferredResponse(); flights.push(flight); return flight.promise; },
    });
    const requests = Array.from({ length: 26 }, (_, index) => ({
      contract: `0x${index.toString(16).padStart(40, "0")}` as `0x${string}`, timestampSeconds: TRANSFER_AT,
    }));
    const firstKey = requests[0]!;
    await expect(reader(requests)).rejects.toThrow("preparation failed");
    expect(flights).toHaveLength(1);
    const outstandingKeys = writeOrder.size;
    const joined = reader([firstKey]);
    flights[0]!.resolve(closeResponse("1", 25));
    expect((await joined).get(historicalCloseKey(firstKey))).toMatchObject({ status: "found" });
    expect(writeOrder.size).toBe(0);
    expect(outstandingKeys).toBe(25);
    const older = reader([firstKey]);
    nowMs += 900_000;
    const newer = reader([firstKey]);
    await Promise.resolve();
    expect(flights).toHaveLength(3);
    flights[2]!.resolve(closeResponse("2"));
    await newer;
    flights[1]!.resolve(closeResponse("1"));
    await older;
    expect((await reader([firstKey])).get(historicalCloseKey(firstKey))).toMatchObject({ close: { priceUsd: { atoms: "2" } } });
    expect(writeOrder.size).toBe(0);
  });
});
