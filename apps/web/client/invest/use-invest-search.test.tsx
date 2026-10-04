import "@/client/account/dom-test-harness";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import { assetResolutionFixture, searchFixture, nonTrendingAddress } from "@/tests/browser/feature-map/search-fixtures";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { useInvestSearch } = await import("./use-invest-search");
const { InvestExperience } = await import("./invest-experience");

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup(); getHomeQueryClient().clear(); globalThis.fetch = originalFetch;
  window.history.replaceState(null, "", "/invest");
});
function Probe({ query, fetchImpl }: { query: string; fetchImpl: FetchLike }) {
  const search = useInvestSearch(query, false, { fetchImpl });
  return <output data-testid="assets">{search.results.map((result) => result.asset.id).join(",")}</output>;
}

describe("useInvestSearch", () => {
  test("ignores a delayed previous query when the new one resolves", async () => {
    let resolvePrevious: ((response: Response) => void) | undefined;
    const fetchImpl: FetchLike = async (input) => {
      const query = new URL(String(input), "http://localhost").searchParams.get("q") ?? "";
      if (query === "BTC") return new Promise<Response>((resolve) => { resolvePrevious = resolve; });
      return Response.json(searchFixture(query));
    };
    const { rerender } = render(<Probe query="BTC" fetchImpl={fetchImpl} />);
    await waitFor(() => expect(resolvePrevious).toBeDefined());
    rerender(<Probe query="Apple" fetchImpl={fetchImpl} />);
    await waitFor(() => expect(page().getByTestId("assets").textContent).toBe("aaplc"));
    await act(async () => { resolvePrevious?.(Response.json(searchFixture("BTC"))); });
    expect(page().getByTestId("assets").textContent).toBe("aaplc");
  });
});

test("resolves a non-trending detail deep link without paginated search", async () => {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/invest/asset" ? Response.json(assetResolutionFixture(url.searchParams.get("assetId") ?? "")) : url.pathname.includes("/search") ? Response.json(searchFixture(url.searchParams.get("q") ?? "")) : Response.json({ version: 1, provider: "codex", assetId: `base:${nonTrendingAddress}`, range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] });
    }) as typeof fetch;
    window.history.replaceState(null, "", `/invest/base:${nonTrendingAddress}`);
    render(<InvestExperience initialView={{ screen: "detail", assetId: `base:${nonTrendingAddress}`, from: "hub" }} />);
    await waitFor(() => expect(page().getByRole("heading", { name: "Orbit" })).toBeTruthy());
  });
