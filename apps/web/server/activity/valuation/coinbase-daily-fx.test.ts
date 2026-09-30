import { describe, expect, test } from "bun:test";
import { createCoinbaseDailyFxReader, dailyFxKey } from "./coinbase-daily-fx";
import { createWriteOrder } from "@/server/cache/write-order";

function rateResponse(base: string, currency: string, amount: string) {
  return Response.json({ data: { amount, base, currency } });
}

function deferredResponse() {
  return Promise.withResolvers<Response>();
}

describe("Coinbase daily FX reader", () => {
  test("reads the dated daily rate once per pair and date and caches completed days", async () => {
    const urls: string[] = [];
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date("2026-09-10T12:00:00.000Z"),
      fetchImpl: (async (url: string | URL | Request) => {
        urls.push(String(url));
        return rateResponse("EUR", "USD", "1.161732");
      }),
    });
    const request = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;

    const first = await reader([request, request]);
    const second = await reader([request]);

    expect(urls).toEqual([
      "https://api.coinbase.com/v2/prices/EUR-USD/spot?date=2026-09-01",
    ]);
    for (const results of [first, second]) {
      expect(results.get(dailyFxKey(request))).toEqual({
        rate: { atoms: "1161732", scale: 6 },
        provisional: false,
      });
    }
  });

  test("evicts the least recently used settled day at capacity", async () => {
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03"] as const;
    const urls: string[] = [];
    const reader = createCoinbaseDailyFxReader({
      cacheMaxEntries: 2, now: () => new Date("2026-09-10T12:00:00.000Z"),
      fetchImpl: async (url) => {
        urls.push(String(url));
        return rateResponse("EUR", "USD", "1.1");
      },
    });
    const read = (date: string) => reader([{ base: "EUR", quote: "USD", date }]);
    await read(dates[0]);
    await read(dates[1]);
    await read(dates[0]);
    await read(dates[2]);
    await read(dates[0]);
    expect(urls).toHaveLength(3);
    await read(dates[1]);
    expect(urls).toHaveLength(4);
    expect(urls[3]).toContain("date=2026-09-02");
  });

  test("an expired provisional rate on failed refetch does not evict a settled rate", async () => {
    let nowMs = Date.parse("2026-09-10T12:00:00.000Z");
    let calls = 0;
    const reader = createCoinbaseDailyFxReader({
      cacheMaxEntries: 2, now: () => new Date(nowMs),
      fetchImpl: async () => {
        calls += 1;
        return calls === 3 || calls === 5
          ? new Response("", { status: 502 }) : rateResponse("EUR", "USD", String(calls));
      },
    });
    const read = async (date: string) => {
      const request = { base: "EUR", quote: "USD", date } as const;
      return (await reader([request])).get(dailyFxKey(request));
    };
    expect(await read("2026-09-10")).toMatchObject({ provisional: true });
    expect(await read("2026-09-09")).toMatchObject({ provisional: false });
    nowMs += 60_001;
    expect(await read("2026-09-10")).toBeNull();
    expect(await read("2026-09-08")).toMatchObject({ provisional: false });
    expect(await read("2026-09-09")).toMatchObject({ provisional: false, rate: { atoms: "2" } });
    expect(calls).toBe(4);
  });

  test("refetches a settled day after its 24-hour TTL", async () => {
    let nowMs = Date.parse("2026-09-10T12:00:00.000Z");
    let calls = 0;
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date(nowMs),
      fetchImpl: async () => { calls += 1; return rateResponse("EUR", "USD", "1.1"); },
    });
    const request = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;
    await reader([request]);
    nowMs += 24 * 60 * 60 * 1_000;
    await reader([request]);
    expect(calls).toBe(1);
    nowMs += 1;
    await reader([request]);
    expect(calls).toBe(2);
  });

  test("never serves an expired settled rate after a failed refetch and retries later", async () => {
    let nowMs = Date.parse("2026-09-10T12:00:00.000Z");
    let calls = 0;
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date(nowMs),
      fetchImpl: async () => {
        calls += 1;
        return calls === 2
          ? new Response("", { status: 503 })
          : rateResponse("EUR", "USD", calls === 1 ? "1.1" : "1.2");
      },
    });
    const request = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;
    const read = async () => (await reader([request])).get(dailyFxKey(request));

    expect(await read()).toEqual({ rate: { atoms: "11", scale: 1 }, provisional: false });
    nowMs += 24 * 60 * 60 * 1_000 + 1;
    expect(await read()).toBeNull();
    expect(await read()).toEqual({ rate: { atoms: "12", scale: 1 }, provisional: false });
    expect(calls).toBe(3);
  });

  test("starts no further dated requests once the caller aborts", async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date("2026-09-10T12:00:00.000Z"),
      fetchImpl: (async (url: string | URL | Request) => {
        urls.push(String(url));
        controller.abort();
        return rateResponse("EUR", "USD", "1.1");
      }),
    });
    const requests = Array.from({ length: 12 }, (_, day) => ({
      base: "EUR",
      quote: "USD",
      date: `2026-09-${String(day + 1).padStart(2, "0")}`,
    }) as const);

    await reader(requests, controller.signal);

    expect(urls.length).toBeLessThanOrEqual(4);
  });

  test("marks the current UTC day provisional and refreshes it after a minute", async () => {
    let nowMs = Date.parse("2026-09-10T12:00:00.000Z");
    let calls = 0;
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date(nowMs),
      fetchImpl: (async () => {
        calls += 1;
        return rateResponse("USD", "EUR", calls === 1 ? "0.86" : "0.87");
      }),
    });
    const request = { base: "USD", quote: "EUR", date: "2026-09-10" } as const;

    expect((await reader([request])).get(dailyFxKey(request))).toEqual({
      rate: { atoms: "86", scale: 2 },
      provisional: true,
    });
    nowMs += 61_000;
    expect((await reader([request])).get(dailyFxKey(request))?.rate).toEqual({
      atoms: "87",
      scale: 2,
    });
    expect(calls).toBe(2);
  });

  test("refreshes a provisional rate at UTC midnight while retaining completed-day cache entries", async () => {
    let nowMs = Date.parse("2026-09-10T23:59:30.000Z");
    let calls = 0;
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date(nowMs),
      fetchImpl: (async () => {
        calls += 1;
        return rateResponse("USD", "EUR", calls === 3 ? "0.87" : "0.86");
      }),
    });
    const provisional = { base: "USD", quote: "EUR", date: "2026-09-10" } as const;
    const completed = { base: "USD", quote: "EUR", date: "2026-09-09" } as const;

    const beforeMidnight = await reader([provisional, completed]);
    expect(beforeMidnight.get(dailyFxKey(provisional))?.provisional).toBe(true);
    expect(beforeMidnight.get(dailyFxKey(completed))?.provisional).toBe(false);
    expect(calls).toBe(2);

    nowMs = Date.parse("2026-09-11T00:00:10.000Z");
    const afterMidnight = await reader([provisional, completed]);
    expect(afterMidnight.get(dailyFxKey(provisional))).toEqual({
      rate: { atoms: "87", scale: 2 },
      provisional: false,
    });
    expect(afterMidnight.get(dailyFxKey(completed))).toEqual(
      beforeMidnight.get(dailyFxKey(completed)),
    );
    expect(calls).toBe(3);
    expect((await reader([provisional, completed])).get(dailyFxKey(provisional))?.provisional).toBe(false);
    expect(calls).toBe(3);
  });

  test("returns no rate for mismatched payloads, failures, and future dates", async () => {
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date("2026-09-10T12:00:00.000Z"),
      fetchImpl: (async (url: string | URL | Request) => {
        if (String(url).includes("IDR")) return new Response("", { status: 500 });
        return rateResponse("USD", "GBP", "0.74");
      }),
    });
    const mismatched = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;
    const failed = { base: "IDR", quote: "USD", date: "2026-09-01" } as const;
    const future = { base: "USD", quote: "GBP", date: "2026-09-11" } as const;
    const results = await reader([mismatched, failed, future]);
    expect(results.get(dailyFxKey(mismatched))).toBeNull();
    expect(results.get(dailyFxKey(failed))).toBeNull();
    expect(results.get(dailyFxKey(future))).toBeNull();
  });

  test("does not cache a non-ok response or a zero rate", async () => {
    let calls = 0;
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date("2026-09-10T12:00:00.000Z"),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("", { status: 503 });
        return rateResponse("EUR", "USD", calls === 2 ? "0" : "1.1");
      },
    });
    const request = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;
    expect((await reader([request])).get(dailyFxKey(request))).toBeNull();
    expect((await reader([request])).get(dailyFxKey(request))).toBeNull();
    expect((await reader([request])).get(dailyFxKey(request))?.rate).toEqual({ atoms: "11", scale: 1 });
    await reader([request]);
    expect(calls).toBe(3);
  });

  test("write order prevents an older request from repopulating an evicted newer rate", async () => {
    const flights: ReturnType<typeof deferredResponse>[] = [];
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date("2026-09-10T12:00:00.000Z"), cacheMaxEntries: 1,
      fetchImpl: () => { const flight = deferredResponse(); flights.push(flight); return flight.promise; },
    });
    const key = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;
    const older = reader([key]);
    const newer = reader([key]);
    expect(flights).toHaveLength(2);
    flights[1]!.resolve(rateResponse("EUR", "USD", "2"));
    expect((await newer).get(dailyFxKey(key))?.rate.atoms).toBe("2");
    const eviction = reader([{ ...key, date: "2026-09-02" }]);
    flights[2]!.resolve(rateResponse("EUR", "USD", "3"));
    await eviction;
    flights[0]!.resolve(rateResponse("EUR", "USD", "1"));
    await older;
    const reread = reader([key]);
    flights[3]?.resolve(rateResponse("EUR", "USD", "2"));
    expect((await reread).get(dailyFxKey(key))?.rate.atoms).toBe("2");
    expect(flights).toHaveLength(4);
  });

  test("write order lets a later same-tick request win when it settles first", async () => {
    const flights: ReturnType<typeof deferredResponse>[] = [];
    const writeOrder = createWriteOrder();
    const reader = createCoinbaseDailyFxReader({
      now: () => new Date("2026-09-10T12:00:00.000Z"), cacheMaxEntries: 1, writeOrder,
      fetchImpl: () => { const flight = deferredResponse(); flights.push(flight); return flight.promise; },
    });
    const key = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;
    const older = reader([key]);
    const newer = reader([key]);
    expect(flights).toHaveLength(2);
    const outstandingKeys = writeOrder.size;
    flights[1]!.resolve(rateResponse("EUR", "USD", "2"));
    await newer;
    const remainingKeys = writeOrder.size;
    flights[0]!.resolve(rateResponse("EUR", "USD", "1"));
    await older;
    expect((await reader([key])).get(dailyFxKey(key))?.rate.atoms).toBe("2");
    expect(outstandingKeys).toBe(1);
    expect(remainingKeys).toBe(1);
    expect(flights).toHaveLength(2);
    expect(writeOrder.size).toBe(0);
  });

  test("write order releases the first worker after a later worker's preparation fails", async () => {
    const writeOrder = createWriteOrder();
    const pending: Promise<unknown>[] = [];
    const settle = writeOrder.settle;
    writeOrder.settle = (key, request, write) => {
      const promise = settle(key, request, write);
      pending.push(promise);
      return promise;
    };
    const flights: ReturnType<typeof deferredResponse>[] = [];
    let nowCalls = 0;
    let failed = false;
    const reader = createCoinbaseDailyFxReader({
      cacheMaxEntries: 1, writeOrder,
      now: () => {
        nowCalls += 1;
        if (!failed && nowCalls === 3) { failed = true; return new Date(NaN); }
        return new Date("2026-09-10T12:00:00.000Z");
      },
      fetchImpl: () => { const flight = deferredResponse(); flights.push(flight); return flight.promise; },
    });
    const key = { base: "EUR", quote: "USD", date: "2026-09-01" } as const;
    await expect(reader([key, { ...key, date: "2026-09-02" }])).rejects.toBeInstanceOf(RangeError);
    expect(flights).toHaveLength(1);
    const outstandingKeys = writeOrder.size;
    flights[0]!.resolve(rateResponse("EUR", "USD", "1"));
    await Promise.all(pending);
    expect(writeOrder.size).toBe(0);
    expect(outstandingKeys).toBe(1);
    expect((await reader([key])).get(dailyFxKey(key))?.rate.atoms).toBe("1");
    expect(flights).toHaveLength(1);
    const eviction = reader([{ ...key, date: "2026-09-03" }]);
    flights[1]!.resolve(rateResponse("EUR", "USD", "3"));
    await eviction;
    const older = reader([key]);
    const newer = reader([key]);
    flights[3]!.resolve(rateResponse("EUR", "USD", "2"));
    await newer;
    flights[2]!.resolve(rateResponse("EUR", "USD", "1"));
    await older;
    expect((await reader([key])).get(dailyFxKey(key))?.rate.atoms).toBe("2");
    expect(writeOrder.size).toBe(0);
  });
});
