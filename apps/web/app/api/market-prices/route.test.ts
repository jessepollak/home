import { describe, expect, test } from "bun:test";
import { createErrorMarketPricesResponse } from "@/server/market-data/codex/client";
import type { MarketPricesResponse } from "@/shared/invest/contracts/market-prices";
import { createMarketPricesHandler } from "@/server/market-data/handlers/market-prices";
import { readStockMarket } from "@/server/market-data/tokenized-equity/market-snapshots";
import type { TokenizedEquityReference } from "@/server/market-data/tokenized-equity/reader";
import { investAssets } from "@/config/invest-assets";
import { parseMarketPricesResponse } from "@/shared/invest/contracts/market-prices";
import { getMarketDisplay } from "@/shared/invest/invest-market";

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
  test("returns the bounded public market-state contract", async () => {
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

  const block = { number: "51886274", timestamp: "2026-09-28T02:18:15.000Z" };
  const common = { multiplierWad: "1000000000000000000", block };
  const references: TokenizedEquityReference[] = [
    { ...common, assetId: "nvdac", status: "open", price: { atoms: "17725000000", scale: 8 }, updatedAt: "2026-09-25T19:00:00.000Z", roundId: "7" },
    { ...common, assetId: "metac", status: "closed", price: { atoms: "51200000000", scale: 8 }, updatedAt: "2026-09-25T20:00:00.000Z", roundId: "8" },
    { ...common, assetId: "aaplc", status: "paused", lastPrice: null, updatedAt: null },
    { ...common, assetId: "googlc", status: "stale", lastPrice: { atoms: "25000000000", scale: 8 }, updatedAt: "2026-09-20T20:00:00.000Z" },
    { assetId: "amznc", status: "unavailable", reason: "read-failed", block: null },
  ];
  const codexWithStock: MarketPricesResponse = {
    ...publicPayload,
    markets: {
      ...publicPayload.markets,
      stock: { status: "ready", snapshots: [{ assetId: "nvdac", displayPrice: "$1", asOf: "2026-09-07T20:30:00.000Z", sourceLabel: "Codex" }] },
    },
  };

  test("stock prices come from the reference reader, never Codex, and round-trip through the shared parser", async () => {
    let requested: string[] = [];
    const GET = createMarketPricesHandler(async () => codexWithStock, null, () => readStockMarket(async (feeds) => {
      requested = feeds.map(({ assetId }) => assetId);
      return references;
    }));
    const response = await GET();
    expect(response.status).toBe(200);
    const parsed = parseMarketPricesResponse(await response.json());
    expect(parsed).not.toBeNull();
    expect(requested).toEqual(investAssets.filter(({ category }) => category === "stock").map(({ id }) => id));
    const stock = parsed!.markets.stock;
    if (stock?.status !== "ready") throw new Error("expected a ready stock market");
    expect(stock.snapshots.every(({ sourceLabel }) => sourceLabel === "Chainlink")).toBeTrue();
    expect(stock.snapshots.map(({ assetId, session, displayPrice }) => [assetId, session, displayPrice])).toEqual([
      ["nvdac", "open", "$177.25"],
      ["metac", "closed", "$512"],
      ["aaplc", "paused", "—"],
      ["googlc", "stale", "—"],
    ]);
    expect(parsed!.markets.meme).toEqual(publicPayload.markets.meme);

    const cases = [
      ["nvdac", "$177.25", undefined],
      ["metac", "$512.00", "Last close"],
      ["aaplc", "—", "Paused"],
      ["googlc", "—", "Price delayed"],
      ["amznc", "—", undefined],
    ] as const;
    for (const [assetId, value, context] of cases) {
      const display = getMarketDisplay(assetId, stock, { regionId: "US" });
      expect([assetId, display.value, display.context]).toEqual([assetId, value, context]);
    }
  });

  test("a failed stock reader leaves stocks unpriced instead of falling back to Codex", async () => {
    const GET = createMarketPricesHandler(async () => codexWithStock, null, () => readStockMarket(async () => {
      throw new Error("rpc down");
    }));
    const parsed = parseMarketPricesResponse(await (await GET()).json());
    expect(parsed?.markets.stock).toEqual({ status: "error", message: "Current market prices are unavailable." });
  });

  test("an all-unavailable stock read is a failed market, not an empty ready one", async () => {
    const GET = createMarketPricesHandler(async () => codexWithStock, null, () => readStockMarket(async (feeds) =>
      feeds.map(({ assetId }) => ({ assetId, status: "unavailable" as const, reason: "read-failed" as const, block: null }))));
    const parsed = parseMarketPricesResponse(await (await GET()).json());
    expect(parsed?.markets.stock).toEqual({ status: "error", message: "Current market prices are unavailable." });
  });

  test("stock references survive a Codex failure", async () => {
    const GET = createMarketPricesHandler(async () => {
      throw new Error("codex down");
    }, null, () => readStockMarket(async () => references));
    const response = await GET();
    expect(response.status).toBe(502);
    const parsed = parseMarketPricesResponse(await response.json());
    expect(parsed?.markets.crypto?.status).toBe("error");
    const stock = parsed?.markets.stock;
    expect(stock?.status === "ready" ? stock.snapshots.length : 0).toBe(4);
  });

  test("the parser admits a reference session only on a checked configured stock snapshot", () => {
    const snapshot = { displayPrice: "$1", asOf: "2026-09-25T20:00:00.000Z", sourceLabel: "Chainlink" };
    const parse = (category: string, value: Record<string, unknown>) => parseMarketPricesResponse({
      ...publicPayload, markets: { [category]: { status: "ready", snapshots: [{ ...snapshot, ...value }] } },
    });
    const cases = [
      ["stock", { assetId: "nvdac", session: "closed", checkedAt: "2026-09-28T12:00:00.000Z" }, true],
      ["stock", { assetId: "nvdac", session: "closed" }, false],
      ["stock", { assetId: "nvdac", checkedAt: "2026-09-28T12:00:00.000Z" }, false],
      ["crypto", { assetId: "cbbtc", session: "closed", checkedAt: "2026-09-28T12:00:00.000Z" }, false],
      ["stock", { assetId: "nvdac", session: "live", checkedAt: "2026-09-28T12:00:00.000Z" }, false],
    ] as const;
    for (const [category, value, accepted] of cases) {
      expect([category, value, parse(category, value) !== null]).toEqual([category, value, accepted]);
    }
  });
});
