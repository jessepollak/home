import "@/client/account/dom-test-harness";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import { assetResolutionFixture, searchFixture, nonTrendingAddress } from "@/tests/browser/feature-map/search-fixtures";
import { hydrateServerRender } from "@/tests/helpers/hydration";
import { isRecord } from "@/shared/guards";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
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
const fixtureFetch: FetchLike = async (input) => Response.json(searchFixture(new URL(String(input), "http://localhost").searchParams.get("q") ?? ""));

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

describe("Invest search", () => {
  test("shows idle, results, empty, error and partial states", async () => {
    globalThis.fetch = (async (input) => {
      const query = new URL(String(input), "http://localhost").searchParams.get("q") ?? "";
      return query === "unavailable" ? new Response(null, { status: 503 }) : Response.json(searchFixture(query));
    }) as typeof fetch;
    render(<InvestExperience />);
    const input = page().getByRole("textbox", { name: "Search assets" });
    expect(page().getByRole("heading", { name: "Stocks" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "ORB" } });
    expect(page().getByLabelText("Loading search results")).toBeTruthy();
    expect(page().getByRole("status").textContent).toBe("Loading results");
    expect(page().getByRole("region", { name: "Search results" }).hasAttribute("aria-live")).toBe(false);
    await waitFor(() => expect(page().getAllByRole("button", { name: /Orbit/ })).toHaveLength(3));
    expect(page().getByRole("status").textContent).toBe("3 results");
    expect(page().getAllByText(/0x1111…1111/)).toHaveLength(2);
    expect(page().queryByRole("heading", { name: "Stocks" })).toBeNull();
    fireEvent.change(input, { target: { value: "nothing-found" } });
    await waitFor(() => expect(page().getByRole("status").textContent).toBe("No results"));
    expect(page().getAllByText("No results")).toHaveLength(2);
    fireEvent.change(input, { target: { value: "unavailable" } });
    await waitFor(() => expect(page().getByRole("status").textContent).toBe("Search unavailable"));
    expect(page().getAllByText("Search unavailable")).toHaveLength(2);
    fireEvent.change(input, { target: { value: "partial" } });
    await waitFor(() => expect(page().getByText("Some results couldn’t load.")).toBeTruthy());
    expect(page().getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("clear retains focus; Escape and submit blur without clearing", () => {
    globalThis.fetch = fixtureFetch as typeof fetch;
    render(<InvestExperience />);
    const input = page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "BTC" } });
    const searchState: unknown = window.history.state;
    if (!isRecord(searchState)) throw new Error("Expected search history state");
    expect(searchState.investSearchQuery).toBe("BTC");
    fireEvent.click(page().getByRole("button", { name: "Clear search" }));
    expect(input.value).toBe(""); expect(document.activeElement).toBe(input);
    const clearedState: unknown = window.history.state;
    if (!isRecord(clearedState)) throw new Error("Expected cleared search history state");
    expect(clearedState.investSearchQuery).toBe("");
    fireEvent.change(input, { target: { value: "Apple" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input); expect(input.value).toBe("Apple");
    input.focus(); fireEvent.submit(input.closest("form")!);
    expect(document.activeElement).not.toBe(input); expect(input.value).toBe("Apple");
  });

  test("hydrates a hub entry with a saved query without a mismatch, then restores the query", async () => {
    globalThis.fetch = fixtureFetch as typeof fetch;
    window.history.replaceState(null, "", "/invest");
    const fixture = await hydrateServerRender(<InvestExperience />, {
      beforeHydrate: () => window.history.replaceState({ investSearchQuery: "ORB" }, "", "/invest"),
    });
    try {
      await waitFor(() => expect((page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement).value).toBe("ORB"));
      await waitFor(() => expect(page().getAllByRole("button", { name: /Orbit/ })).toHaveLength(3));
      expect(fixture.hydrationErrors).toEqual([]);
    } finally {
      await fixture.unmount();
    }
  });

  test("restores results after detail Back and resolves non-trending deep link", async () => {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/invest/asset" ? Response.json(assetResolutionFixture(url.searchParams.get("assetId") ?? "")) : url.pathname.includes("/search") ? Response.json(searchFixture(url.searchParams.get("q") ?? "")) : Response.json({ version: 1, provider: "codex", assetId: `base:${nonTrendingAddress}`, range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] });
    }) as typeof fetch;
    render(<InvestExperience />);
    fireEvent.change(page().getByRole("textbox", { name: "Search assets" }), { target: { value: "ORB" } });
    fireEvent.click((await page().findAllByRole("button", { name: /Orbit/ }))[0]!);
    expect(window.location.pathname).toBe(`/invest/base:${nonTrendingAddress}`);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect((page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement).value).toBe("ORB"));
    expect(page().getAllByRole("button", { name: /Orbit/ })).toHaveLength(3);
    cleanup(); getHomeQueryClient().clear();
    window.history.replaceState(null, "", `/invest/base:${nonTrendingAddress}`);
    render(<InvestExperience initialView={{ screen: "detail", assetId: `base:${nonTrendingAddress}`, from: "hub" }} />);
    await waitFor(() => expect(page().getByRole("heading", { name: "Orbit" })).toBeTruthy());
  });
});
