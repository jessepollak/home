import { describe, expect, test } from "bun:test";
import { createCoinbaseDailyFxReader, dailyFxKey } from "./coinbase-daily-fx";

function rateResponse(base: string, currency: string, amount: string) {
  return Response.json({ data: { amount, base, currency } });
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
});
