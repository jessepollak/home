import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import {
  MARKET_PRICE_DISPLAY_FRESHNESS_MS,
  type MarketPricesResponse,
} from "@/shared/invest/contracts/market-prices";
import type { UseMarketPricesOptions } from "./use-market-prices";

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { ageMarketPricesResponse, useMarketPrices } = await import("./use-market-prices");

function responseWithSnapshot(
  asOf: string,
  extras: { changeLabel?: string } = {},
): MarketPricesResponse {
  return {
    version: 1,
    provider: "codex",
    fetchedAt: new Date().toISOString(),
    markets: {
      stock: {
        status: "ready",
        snapshots: [
          {
            assetId: "nvdac",
            displayPrice: "$123.4567890123456789",
            asOf,
            sourceLabel: "Codex",
            sourceUrl:
              "https://docs.codex.io/api-reference/queries/gettokenprices",
            ...extras,
          },
        ],
      },
      crypto: {
        status: "ready",
        snapshots: extras.changeLabel
          ? [
              {
                assetId: "cbbtc",
                displayPrice: "$64210",
                asOf,
                sourceLabel: "Codex",
                changeLabel: extras.changeLabel,
              },
            ]
          : [],
      },
      meme: { status: "ready", snapshots: [] },
    },
  };
}

function HookProbe({
  options,
  onRender,
}: {
  options: UseMarketPricesOptions;
  onRender?: (props: ReturnType<typeof useMarketPrices>) => void;
}) {
  const props = useMarketPrices(options);
  onRender?.(props);
  return (
    <div>
      <output data-testid="stock-status">{props.stockMarket.status}</output>
      <output data-testid="stock-detail">
        {props.stockMarket.status === "error"
          ? props.stockMarket.message
          : props.stockMarket.status === "ready"
            ? props.stockMarket.snapshots[0]?.displayPrice ?? "empty"
            : props.stockMarket.status}
      </output>
      <output data-testid="stock-change">
        {props.stockMarket.status === "ready"
          ? props.stockMarket.snapshots[0]?.changeLabel ?? "none"
          : "n/a"}
      </output>
      <output data-testid="crypto-status">{props.cryptoMarket?.status}</output>
      <output data-testid="crypto-change">
        {props.cryptoMarket?.status === "ready"
          ? props.cryptoMarket.snapshots[0]?.changeLabel ?? "none"
          : "n/a"}
      </output>
    </div>
  );
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("useMarketPrices", () => {
  test("keeps a recently checked weekend close but expires an unchecked classification", () => {
    const asOf = "2026-09-25T20:00:00.000Z";
    const mondayMorning = Date.parse("2026-09-28T12:00:00.000Z");
    const base = responseWithSnapshot(asOf);
    const stock = base.markets.stock;
    if (stock?.status !== "ready") throw new Error("expected a ready stock market");
    const checked = (checkedAt: string) => ({ ...base, markets: { stock: { status: "ready" as const, snapshots: stock.snapshots.map((snapshot) => ({ ...snapshot, session: "closed" as const, checkedAt })) } } });
    const recent = checked("2026-09-28T11:58:00.000Z");
    expect(ageMarketPricesResponse(recent, mondayMorning)).toBe(recent);
    expect(ageMarketPricesResponse(checked("2026-09-28T11:50:00.000Z"), mondayMorning).markets.stock).toEqual({ status: "error", message: "Price snapshot is stale." });
    expect(ageMarketPricesResponse(base, mondayMorning).markets.stock).toEqual({ status: "error", message: "Price snapshot is stale." });
  });

  test("ages a ready source snapshot out while mounted instead of presenting it as perpetually live", async () => {
    const freshnessMs = 20;
    const sourceTime = Date.parse("2026-01-01T00:00:00.000Z");
    let clock = sourceTime;
    let nowCalls = 0;
    const options: UseMarketPricesOptions = {
      fetchImpl: (async () =>
        Response.json(responseWithSnapshot(new Date(sourceTime).toISOString()))),
      now: () => {
        nowCalls += 1;
        return clock;
      },
      freshnessMs,
      refreshCooldownMs: 60_000,
    };
    render(<HookProbe options={options} />);

    await waitFor(() =>
      expect(page().getByTestId("stock-detail").textContent).toBe(
        "$123.4567890123456789",
      ),
    );
    const callsWhenReady = nowCalls;
    await waitFor(() => expect(nowCalls).toBeGreaterThan(callsWhenReady + 4));
    expect(page().getByTestId("stock-status").textContent).toBe("ready");

    clock = sourceTime + freshnessMs + 1;
    await waitFor(() =>
      expect(page().getByTestId("stock-detail").textContent).toBe(
        "Price snapshot is stale.",
      ),
    );
  });

  test("rechecks an unavailable stock market while mounted and recovers when the reference returns", async () => {
    let requests = 0;
    const ready = responseWithSnapshot(new Date().toISOString());
    const options: UseMarketPricesOptions = {
      fetchImpl: (async () => {
        requests += 1;
        return Response.json(requests === 1
          ? { ...ready, markets: { ...ready.markets, stock: { status: "error", message: "Current market prices are unavailable." } } }
          : ready);
      }),
      refreshCooldownMs: 0,
      sessionRecheckMs: 20,
    };
    render(<HookProbe options={options} />);
    await waitFor(() => expect(page().getByTestId("stock-status").textContent).toBe("error"));
    await waitFor(() => expect(page().getByTestId("stock-detail").textContent).toBe("$123.4567890123456789"));
    expect(requests).toBeGreaterThanOrEqual(2);
  });

  test("keeps a thinner-market Codex indication older than five minutes", async () => {
    const asOf = new Date(Date.now() - 17 * 60_000).toISOString();
    render(
      <HookProbe
        options={{
          fetchImpl: (async () => Response.json(responseWithSnapshot(asOf))),
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("stock-detail").textContent).toBe(
        "$123.4567890123456789",
      ),
    );
    expect(page().getByTestId("stock-status").textContent).toBe("ready");
  });

  test("uses the source timestamp, not fetchedAt, for immediate staleness", async () => {
    const staleAsOf = new Date(
      Date.now() - MARKET_PRICE_DISPLAY_FRESHNESS_MS - 1,
    ).toISOString();
    render(
      <HookProbe
        options={{
          fetchImpl: (async () =>
            Response.json(responseWithSnapshot(staleAsOf))),
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("stock-detail").textContent).toBe(
        "Price snapshot is stale.",
      ),
    );
  });

  test("preserves ready stock data from a valid partial 502 response", async () => {
    const ready = responseWithSnapshot(new Date().toISOString());
    const partial = { ...ready, markets: { ...ready.markets, crypto: { status: "error", message: "Provider unavailable" } } };
    render(<HookProbe options={{ fetchImpl: async () => Response.json(partial, { status: 502 }) }} />);
    await waitFor(() => expect(page().getByTestId("stock-status").textContent).toBe("ready"));
    expect(page().getByTestId("stock-detail").textContent).toBe("$123.4567890123456789");
    expect(page().getByTestId("crypto-status").textContent).toBe("error");
  });

  test("surfaces failed or malformed reads as an error, never an empty price", async () => {
    for (const response of [
      Response.json({ markets: "invalid" }, { status: 500 }),
      Response.json({ markets: "invalid" }, { status: 502 }),
      new Response("Provider down", { status: 502 }),
      new Response("{", { status: 200 }),
    ]) {
      const { unmount } = render(<HookProbe options={{ fetchImpl: async () => response }} />);
      await waitFor(() => expect(page().getByTestId("stock-status").textContent).toBe("error"));
      expect(page().getByTestId("stock-detail").textContent).toBe("Current market prices are unavailable.");
      unmount();
      getHomeQueryClient().clear();
    }
  });

  test("rejects malformed public payloads into a generic error state", async () => {
    render(
      <HookProbe
        options={{
          fetchImpl: (async () =>
            Response.json({ provider: "codex", markets: "malformed" })),
        }}
      />,
    );

    await waitFor(() =>
      expect(page().getByTestId("stock-detail").textContent).toBe(
        "Current market prices are unavailable.",
      ),
    );
  });
});
