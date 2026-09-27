import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { getHomeQueryClient } from "@/client/query/query-client";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AssetDetailScreen } = await import("./asset-detail-screen");
const { ChartLoadFallback } = await import("./chart-load-fallback");
const originalFetch = window.fetch;
const asset = investAssets.find((item) => item.id === "cbbtc")!;

afterEach(() => { cleanup(); getHomeQueryClient().clear(); window.fetch = originalFetch; });

test("asset details show an accessible chart loading state before the chart resolves", async () => {
  window.fetch = (async () => Response.json({ version: 1, provider: "codex", assetId: asset.id,
    range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] })) as unknown as typeof fetch;
  const view = render(<AssetDetailScreen asset={asset} market={{ status: "loading" }}
    ownership={<div>Position</div>} onBack={() => {}} />);
  expect(view.getByRole("region", { name: "Market price history" })).toBeTruthy();
  expect(view.getByRole("status", { name: "Loading price history" })).toBeTruthy();
  await waitFor(() => expect(view.getByRole("status", { name: "No price history for this range." })).toBeTruthy());
  expect(view.queryByRole("status", { name: "Loading price history" })).toBeNull();
  expect(view.getByRole("group", { name: "Price range" })).toBeTruthy();
});

test("failed chart loading preserves the chart region and offers retry", () => {
  let retries = 0;
  const view = render(<ChartLoadFallback failed retry={() => { retries += 1; }} />);
  const chart = view.getByRole("region", { name: "Market price history" });
  expect(view.getByRole("status", { name: "Couldn't load price history" })).toBeTruthy();
  expect(view.getByText("Couldn't load price history")).toBeTruthy();
  expect(view.queryByRole("status", { name: "Loading price history" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(retries).toBe(1);
  expect(chart.isConnected).toBe(true);
});
