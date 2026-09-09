import { describe, expect, test } from "bun:test";
import { createErrorMarketPricesResponse } from "@/server/market-data/codex/client";
import type { MarketPricesResponse } from "@/server/market-data/codex/public-contract";
import { createMarketPricesHandler } from "./handler";
import { dynamic, runtime } from "./route";

const publicPayload: MarketPricesResponse = {
  version: 1,
  provider: "codex",
  fetchedAt: "2026-09-07T20:30:00.000Z",
  markets: {
    stock: { status: "ready", snapshots: [] },
    meme: { status: "ready", snapshots: [] },
  },
};

describe("GET /api/market-prices", () => {
  test("is a public Node route and returns the bounded market-state contract without authentication", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");

    const GET = createMarketPricesHandler(async () => publicPayload);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=30",
    );
    expect(await response.json()).toEqual(publicPayload);
  });

  test("returns a useful unavailable response when Codex is not configured", async () => {
    const unavailable: MarketPricesResponse = {
      ...publicPayload,
      fetchedAt: null,
      unavailableReason: "not-configured",
      markets: {
        stock: { status: "unavailable" },
        meme: { status: "unavailable" },
      },
    };
    const response = await createMarketPricesHandler(async () => unavailable)();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(await response.json()).toEqual(unavailable);
  });

  test("attaches presentation FX quotes without changing USD snapshots", async () => {
    const GET = createMarketPricesHandler(async () => publicPayload, async () => ({
      quotes: [
        {
          baseCurrency: "USD",
          quoteCurrency: "IDR",
          quoteUnitsPerUsd: { atoms: "16425", scale: 0 },
          sourceValue: "16425",
          status: "fresh",
          source: {
            provider: "Coinbase Exchange Rates",
            method: "USD exchange rates",
            fetchedAt: "2026-09-07T20:30:00.000Z",
            asOf: null,
            timeBasis: "retrieved-at",
          },
        },
      ],
    }));
    const response = await GET();
    expect(await response.json()).toEqual({
      ...publicPayload,
      fx: [
        {
          quoteCurrency: "IDR",
          quoteUnitsPerUsd: { atoms: "16425", scale: 0 },
          status: "fresh",
        },
      ],
    });
  });

  test("does not leak upstream errors or credentials", async () => {
    const GET = createMarketPricesHandler(async () => {
      throw new Error("upstream body and fixture-secret");
    });
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toBe(JSON.stringify(createErrorMarketPricesResponse()));
    expect(body).not.toContain("upstream body");
    expect(body).not.toContain("fixture-secret");
  });
});
