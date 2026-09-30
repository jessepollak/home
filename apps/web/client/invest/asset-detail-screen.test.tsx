import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { getHomeQueryClient } from "@/client/query/query-client";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AssetDetailScreen } = await import("./asset-detail-screen");
const { ChartLoadFallback } = await import("./chart-load-fallback");
const originalFetch = window.fetch;
const asset = investAssets.find((item) => item.id === "cbbtc")!;
const NOW = Date.parse("2026-09-25T12:00:00.000Z");
beforeEach(() => setSystemTime(new Date(NOW)));

afterEach(() => { cleanup(); getHomeQueryClient().clear(); window.fetch = originalFetch; setSystemTime(); });

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

test("a stock header keeps the reference price while the DEX chart change stays in the chart caption", async () => {
  const stock = investAssets.find((item) => item.id === "nvdac")!;
  const now = NOW;
  window.fetch = (async (input: RequestInfo | URL) => {
    const range = new URL(String(input), "http://localhost").searchParams.get("range") ?? "1W";
    return Response.json({ version: 1, provider: "codex", assetId: stock.id, range, currency: "USD",
      fetchedAt: new Date(now).toISOString(), status: "ready", points: [
        { time: new Date(now - 5 * 86400000).toISOString(), value: "100" },
        { time: new Date(now - 60000).toISOString(), value: "120" },
      ] });
  }) as unknown as typeof fetch;
  const view = render(<AccountWalletClientProvider client={createBlockedAccountWalletClient("provider-unavailable")}><AssetDetailScreen asset={stock} ownership={<div>Position</div>} onBack={() => {}} market={{
    status: "ready", snapshots: [{ assetId: stock.id, displayPrice: "$225.125", asOf: new Date(now - 3600000).toISOString(),
      sourceLabel: "Chainlink", session: "closed" }],
  }} /></AccountWalletClientProvider>);
  await waitFor(() => expect(view.getByText(/^DEX market price · .*20/)).toBeTruthy());
  expect(view.getByText("Last close")).toBeTruthy();
  expect(view.container.querySelector("[data-money-change]")).toBeNull();
});

test("a removed stock detail says it is no longer listed instead of inventing a price", () => {
  const stock = { ...investAssets.find((item) => item.id === "nvdac")!, listing: "removed" as const };
  window.fetch = (async () => Response.json({ version: 1, provider: "codex", assetId: stock.id, range: "1W",
    currency: "USD", fetchedAt: null, status: "empty", points: [] })) as unknown as typeof fetch;
  const view = render(<AccountWalletClientProvider client={createBlockedAccountWalletClient("provider-unavailable")}><AssetDetailScreen
    asset={stock} ownership={<div>Position</div>} onBack={() => {}} market={{ status: "ready", snapshots: [] }} /></AccountWalletClientProvider>);
  expect(view.getByText("No longer listed")).toBeTruthy();
  expect(view.queryByText("No price supplied")).toBeNull();
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
