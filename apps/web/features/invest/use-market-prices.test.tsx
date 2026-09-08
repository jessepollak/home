import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import {
  MARKET_PRICE_DISPLAY_FRESHNESS_MS,
  type MarketPricesResponse,
} from "@/server/market-data/codex/public-contract";
import type { UseMarketPricesOptions } from "./use-market-prices";

const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const { useMarketPrices } = await import("./use-market-prices");

function page() {
  return within(document.body);
}

function responseWithSnapshot(asOf: string): MarketPricesResponse {
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
          },
        ],
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
    </div>
  );
}

afterEach(() => cleanup());

describe("useMarketPrices", () => {
  test("loads the public snapshot without auth and preserves a stable market props object", async () => {
    const renderedProps: ReturnType<typeof useMarketPrices>[] = [];
    const options: UseMarketPricesOptions = {
      fetchImpl: (async () =>
        Response.json(responseWithSnapshot(new Date().toISOString()))),
      refreshCooldownMs: 60_000,
    };
    const view = render(
      <HookProbe options={options} onRender={(props) => renderedProps.push(props)} />,
    );

    await waitFor(() =>
      expect(page().getByTestId("stock-detail").textContent).toBe(
        "$123.4567890123456789",
      ),
    );
    const readyProps = renderedProps.at(-1);

    view.rerender(
      <HookProbe options={options} onRender={(props) => renderedProps.push(props)} />,
    );
    expect(renderedProps.at(-1)).toBe(readyProps);
  });

  test("ages a ready source snapshot out while mounted instead of presenting it as perpetually live", async () => {
    const freshnessMs = 20;
    const options: UseMarketPricesOptions = {
      fetchImpl: (async () =>
        Response.json(responseWithSnapshot(new Date().toISOString()))),
      freshnessMs,
      refreshCooldownMs: 60_000,
    };
    render(<HookProbe options={options} />);

    await waitFor(() =>
      expect(page().getByTestId("stock-status").textContent).toBe("ready"),
    );
    await waitFor(
      () =>
        expect(page().getByTestId("stock-detail").textContent).toBe(
          "Price snapshot is stale.",
        ),
      { timeout: 1_000 },
    );
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
