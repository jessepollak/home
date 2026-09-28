import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { page } from "@/tests/helpers/dom";
import { investAssets } from "@/config/invest-assets";
import { getHomeQueryClient } from "@/client/query/query-client";
import { INVEST_HIDE_ALL } from "@/shared/operator-settings/invest";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";

test("categories left on with every asset hidden show the empty state instead of empty shelves", () => {
  const hiddenAssets = investAssets.filter((asset) => asset.category !== "meme").map((asset) => asset.id);
  render(<InvestExperience investVisibility={{ hiddenCategories: ["meme"], hiddenAssets }} />);
  expect(page().getByText("Nothing to invest in right now.")).toBeTruthy();
  expect(page().queryByRole("region", { name: "Stocks" })).toBeNull();
  expect(page().queryByRole("region", { name: "Crypto" })).toBeNull();
  expect(page().queryByRole("textbox", { name: "Search assets" })).toBeNull();
});

test("an emptied category keeps the visible categories and search available", () => {
  const hiddenAssets = investAssets.filter((asset) => asset.category === "stock").map((asset) => asset.id);
  render(<InvestExperience investVisibility={{ hiddenCategories: [], hiddenAssets }} />);
  expect(page().queryByRole("region", { name: "Stocks" })).toBeNull();
  expect(page().queryByRole("region", { name: "Crypto" })).toBeTruthy();
  expect(page().getByRole("textbox", { name: "Search assets" })).toBeTruthy();
});

test("a deep link to an emptied category renders the hub", () => {
  const hiddenAssets = investAssets.filter((asset) => asset.category === "stock").map((asset) => asset.id);
  window.history.replaceState(null, "", "/invest/stocks");
  render(<InvestExperience initialView={{ screen: "category", shelfId: "stocks" }}
    investVisibility={{ hiddenCategories: [], hiddenAssets }} />);
  expect(page().queryByRole("region", { name: "Stocks" })).toBeNull();
  expect(page().getByRole("region", { name: "Crypto" })).toBeTruthy();
  expect(page().queryByText("No assets available")).toBeNull();
});

test("hiding every listed meme keeps the memes shelf because its rows come from trending", () => {
  const hiddenAssets = investAssets.filter((asset) => asset.category === "meme").map((asset) => asset.id);
  render(<InvestExperience investVisibility={{ hiddenCategories: [], hiddenAssets }} />);
  expect(page().getByRole("region", { name: "Memes" })).toBeTruthy();
  expect(page().getByRole("textbox", { name: "Search assets" })).toBeTruthy();
});



const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { InvestExperience } = await import("./invest-experience");
const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup(); getHomeQueryClient().clear(); globalThis.fetch = originalFetch;
  window.history.replaceState(null, "", "/invest");
});

test("hidden shelves and assets disappear, while the stock preview fills visible slots", () => {
  render(<InvestExperience investVisibility={{ hiddenCategories: ["meme"], hiddenAssets: ["nvdac", "cbbtc"] }} />);
  expect(page().queryByRole("region", { name: "Memes" })).toBeNull();
  const stocks = within(page().getByRole("region", { name: "Stocks" }));
  expect(stocks.queryByRole("button", { name: /NVIDIA/ })).toBeNull();
  expect(stocks.getAllByRole("button")).toHaveLength(7);
  expect(stocks.getByRole("button", { name: /Strategy/ })).toBeTruthy();
  const crypto = within(page().getByRole("region", { name: "Crypto" }));
  expect(crypto.queryByRole("button", { name: /Bitcoin/ })).toBeNull();
  expect(crypto.getByRole("button", { name: /Cardano/ })).toBeTruthy();
  expect(page().getByRole("textbox", { name: "Search assets" })).toBeTruthy();
});

test("a visible category excludes individually hidden assets", () => {
  window.history.replaceState(null, "", "/invest/stocks");
  render(<InvestExperience initialView={{ screen: "category", shelfId: "stocks" }}
    investVisibility={{ hiddenCategories: [], hiddenAssets: ["nvdac"] }} />);
  const category = within(page().getByRole("region", { name: "Stocks" }));
  expect(category.queryByRole("button", { name: /NVIDIA/ })).toBeNull();
  expect(category.getByRole("button", { name: /Meta/ })).toBeTruthy();
});

test("a hidden category deep link renders the hub, not the category list", () => {
  window.history.replaceState(null, "", "/invest/stocks");
  render(<InvestExperience initialView={{ screen: "category", shelfId: "stocks" }}
    investVisibility={{ hiddenCategories: ["stock"], hiddenAssets: [] }} />);
  expect(page().queryByRole("region", { name: "Stocks" })).toBeNull();
  expect(page().getByRole("region", { name: "Crypto" })).toBeTruthy();
  expect(page().getByRole("textbox", { name: "Search assets" })).toBeTruthy();
});

test("hidden category hub persists search and restores it on remount", () => {
  window.history.replaceState(null, "", "/invest/stocks");
  const props = { initialView: { screen: "category" as const, shelfId: "stocks" as const },
    investVisibility: { hiddenCategories: ["stock" as const], hiddenAssets: [] } };
  const first = render(<InvestExperience {...props} />);
  fireEvent.change(page().getByRole("textbox", { name: "Search assets" }), { target: { value: "BTC" } });
  expect(window.history.state.investSearchQuery).toBe("BTC");
  first.unmount();
  render(<InvestExperience {...props} />);
  expect((page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement).value).toBe("BTC");
});

test("when all shelves are hidden the owned empty state replaces shelves and search", () => {
  render(<InvestExperience investVisibility={INVEST_HIDE_ALL} />);
  expect(page().getByText("Nothing to invest in right now.")).toBeTruthy();
  expect(page().queryByRole("textbox", { name: "Search assets" })).toBeNull();
  expect(page().queryByRole("region", { name: "Stocks" })).toBeNull();
  expect(page().queryByRole("region", { name: "Crypto" })).toBeNull();
  expect(page().queryByRole("region", { name: "Memes" })).toBeNull();
});

test("client search drops hidden configured assets and dynamic memes even if the API returns them", async () => {
  globalThis.fetch = (async () => Response.json({ ...searchFixture("ORB"), results: [
    { kind: "configured", assetId: "cbbtc", match: "exact" },
    { kind: "configured", assetId: "aaplc", match: "partial" },
    ...searchFixture("ORB").results,
  ] })) as unknown as typeof fetch;
  render(<InvestExperience investVisibility={{ hiddenCategories: ["meme"], hiddenAssets: ["cbbtc"] }} />);
  fireEvent.change(page().getByRole("textbox", { name: "Search assets" }), { target: { value: "ORB" } });
  const results = await page().findByRole("region", { name: "Search results" });
  await waitFor(() => expect(within(results).getByRole("button", { name: /Apple/ })).toBeTruthy());
  expect(within(results).queryByRole("button", { name: /Bitcoin|Orbit/ })).toBeNull();
  expect(within(results).getByRole("status").textContent).toBe("1 results");
});

test("a hidden asset direct detail link stays available", () => {
  window.history.replaceState(null, "", "/invest/cbbtc");
  render(<InvestExperience initialView={{ screen: "detail", assetId: "cbbtc", from: "hub" }}
    investVisibility={INVEST_HIDE_ALL} />);
  expect(page().getByRole("heading", { name: "Bitcoin" })).toBeTruthy();
});
