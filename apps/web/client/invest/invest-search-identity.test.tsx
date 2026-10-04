import "@/client/account/dom-test-harness";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { assetResolutionFixture, nonTrendingAddress, searchFixture } from "@/tests/browser/feature-map/search-fixtures";
import { parseInvestSearchResponse } from "@/shared/invest/contracts/search";
const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { InvestExperience } = await import("./invest-experience");
const { AssetSearch } = await import("./asset-search");
function SearchJourney() {
  const [assetId, setAssetId] = useState<string | null>(null);
  return assetId ? <InvestExperience initialView={{ screen: "detail", assetId, from: "search" }} />
    : <AssetSearch initialQuery={nonTrendingAddress} onInputReady={() => {}} onClose={() => {}} onQueryCommit={() => {}} onOpenAsset={(id, query) => {
      window.history.replaceState({ ...window.history.state, assetSearchDetailQuery: query }, ""); setAssetId(id);
    }} />;
}
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); getHomeQueryClient().clear(); globalThis.fetch = originalFetch; window.history.replaceState(null, "", "/invest"); });

const dynamicResult = searchFixture(nonTrendingAddress).results[0];
if (!dynamicResult || dynamicResult.kind !== "dynamic") throw new Error("Missing dynamic asset fixture");
const trendingAsset = { ...dynamicResult.asset, displayName: "Trending Orbit" };
const trendingMarket = {
  status: "ready" as const,
  snapshots: [{
    assetId: trendingAsset.id,
    displayPrice: "$7.35",
    asOf: "2026-09-26T12:00:00.000Z",
    sourceLabel: "Trending",
  }],
};

function mockMarketRequests(imageUrl?: string) {
  const paths: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), "http://localhost");
    paths.push(url.pathname);
    if (url.pathname === "/api/invest/search") {
      const fixture = searchFixture(url.searchParams.get("q") ?? "");
      return Response.json({ ...fixture, results: fixture.results.map((result) => result.kind === "dynamic" && imageUrl ? { ...result, asset: { ...result.asset, imageUrl } } : result) });
    }
    if (url.pathname === "/api/invest/asset") {
      const fixture = assetResolutionFixture(url.searchParams.get("assetId") ?? "");
      return Response.json(fixture.asset && imageUrl ? { ...fixture, asset: { ...fixture.asset, imageUrl } } : fixture);
    }
    return Response.json({
      version: 1, provider: "codex", assetId: trendingAsset.id, range: "1W",
      currency: "USD", fetchedAt: null, status: "empty", points: [],
    });
  }) as typeof fetch;
  return paths;
}

test("a trending meme opened from the Memes shelf retains its trending price", async () => {
  mockMarketRequests();
  render(<InvestExperience memeAssets={[trendingAsset]} memeMarket={trendingMarket} memeStatus="ready" />);
  const shelf = page().getByRole("region", { name: "Memes" });
  fireEvent.click(within(shelf).getByRole("button", { name: /Trending Orbit/ }));
  await waitFor(() => expect(page().getByText("$7.35")).toBeTruthy());
});

test("a trending meme deep link retains its trending price without search results", async () => {
  mockMarketRequests();
  window.history.replaceState(null, "", `/invest/${trendingAsset.id}`);
  render(<InvestExperience
    initialView={{ screen: "detail", assetId: trendingAsset.id, from: "hub" }}
    memeAssets={[trendingAsset]} memeMarket={trendingMarket} memeStatus="ready"
  />);
  await waitFor(() => expect(page().getByText("$7.35")).toBeTruthy());
});

test("a search-only detail uses its selected query price, not another cached query or a new resolution read", async () => {
  const paths = mockMarketRequests();
  const oldPage = parseInvestSearchResponse({ ...searchFixture(nonTrendingAddress), query: "OLD", snapshots: searchFixture(nonTrendingAddress).snapshots.map((snapshot) => ({ ...snapshot, displayPrice: "$99.00" })) });
  if (!oldPage) throw new Error("Invalid cached search fixture");
  getHomeQueryClient().setQueryData(["unauthenticated", "invest-search", "/api/invest/search", "OLD"], { pages: [oldPage], pageParams: [0] });
  render(<SearchJourney />);
  fireEvent.change(page().getByRole("textbox", { name: "Search assets" }), {
    target: { value: nonTrendingAddress },
  });
  fireEvent.click((await page().findAllByRole("button", { name: /Orbit/ }))[0]!);
  await waitFor(() => expect(page().getByText("$1.25")).toBeTruthy());
  expect(paths).not.toContain("/api/invest/asset");
  expect(page().queryByText("$99.00")).toBeNull();
});

test("a search-only result displays its provider image in the row and detail", async () => {
  const imageUrl = "https://example.com/orbit.png";
  mockMarketRequests(imageUrl);
  render(<SearchJourney />);
  fireEvent.change(page().getByRole("textbox", { name: "Search assets" }), { target: { value: nonTrendingAddress } });
  const row = (await page().findAllByRole("button", { name: /Orbit/ }))[0]!;
  expect(within(row).getByRole("img", { name: "Orbit icon" }).querySelector("img")?.getAttribute("src")).toBe(imageUrl);
  fireEvent.click(row);
  await waitFor(() => expect(page().getByRole("heading", { name: "Orbit" })).toBeTruthy());
  expect(page().getByRole("img", { name: "Orbit icon" }).querySelector("img")?.getAttribute("src")).toBe(imageUrl);
});

test("a search-only result without an image falls back to initials", async () => {
  mockMarketRequests();
  render(<SearchJourney />);
  fireEvent.change(page().getByRole("textbox", { name: "Search assets" }), { target: { value: nonTrendingAddress } });
  const row = (await page().findAllByRole("button", { name: /Orbit/ }))[0]!;
  const mark = within(row).getByRole("img", { name: "Orbit icon" });
  expect(mark.querySelector("img")).toBeNull();
  expect(mark.textContent).toContain("OR");
});

test("a search-only deep link resolves its provider image", async () => {
  const id = `base:${nonTrendingAddress}`;
  const imageUrl = "https://example.com/orbit.png";
  mockMarketRequests(imageUrl);
  window.history.replaceState(null, "", `/invest/${id}`);
  render(<InvestExperience initialView={{ screen: "detail", assetId: id, from: "hub" }} />);
  await waitFor(() => expect(page().getByRole("img", { name: "Orbit icon" }).querySelector("img")?.getAttribute("src")).toBe(imageUrl));
});

test("an unpriced onchain identity resolves on deep link without a fabricated quote", async () => {
  const id = `base:${nonTrendingAddress}`;
  window.history.replaceState(null, "", `/invest/${id}`);
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/invest/asset") {
      return Response.json({ ...assetResolutionFixture(id), snapshot: null, source: "onchain" });
    }
    return Response.json({ version: 1, provider: "codex", assetId: id, range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] });
  }) as typeof fetch;
  render(<InvestExperience initialView={{ screen: "detail", assetId: id, from: "hub" }} />);
  await waitFor(() => expect(page().getByRole("heading", { name: "Orbit" })).toBeTruthy());
  expect(page().queryByRole("img", { name: /^\$/ })).toBeNull();
  expect(page().queryByText("$0.00")).toBeNull();
});

test.each(["missing", "error"] as const)("exact address with %s resolution only offers fallback when resolution failed", async (status) => {
  const id = `base:${nonTrendingAddress}`;
  window.history.replaceState(null, "", `/invest/${id}`);
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/invest/asset") {
      return Response.json({ version: 1, assetId: id, asset: null, source: null, snapshot: null, provider: status === "missing" ? "ok" : "error" });
    }
    return Response.json({ version: 1, provider: "codex", assetId: id, range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] });
  }) as typeof fetch;
  render(<AccountWalletClientProvider client={createBlockedAccountWalletClient("provider-unavailable")}><InvestExperience initialView={{ screen: "detail", assetId: id, from: "hub" }} /></AccountWalletClientProvider>);
  if (status === "missing") {
    await waitFor(() => expect(page().getByText("Asset unavailable")).toBeTruthy());
    expect(page().queryByRole("heading", { name: "0x1111…1111" })).toBeNull();
  } else {
    await waitFor(() => expect(page().getByRole("heading", { name: "0x1111…1111" })).toBeTruthy());
    expect(page().queryByText("Asset unavailable")).toBeNull();
  }
});

test("a priced deep link resolves directly without issuing a search request", async () => {
  const id = `base:${nonTrendingAddress}`;
  const paths: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), "http://localhost");
    paths.push(url.pathname);
    if (url.pathname === "/api/invest/asset") return Response.json(assetResolutionFixture(url.searchParams.get("assetId") ?? ""));
    return Response.json({ version: 1, provider: "codex", assetId: id, range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] });
  }) as typeof fetch;
  render(<InvestExperience initialView={{ screen: "detail", assetId: id, from: "hub" }} />);
  await waitFor(() => expect(page().getByText("$1.25")).toBeTruthy());
  expect(paths).toContain("/api/invest/asset");
  expect(paths).not.toContain("/api/invest/search");
});
