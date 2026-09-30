import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import { formatPresentationDate } from "@/shared/formatting";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { AssetStats, formatStatUsd } = await import("./asset-stats");
const originalFetch = window.fetch;
const now = Date.parse("2026-09-25T12:00:00.000Z");
const clock = { value: now, read: () => now, refresh: () => {} };
const bitcoin = investAssets.find((asset) => asset.id === "cbbtc")!;
const degen = investAssets.find((asset) => asset.id === "degen")!;
const stock = investAssets.find((asset) => asset.id === "nvdac")!;

function mockFetch(stats: "ready" | "error") {
  const requested: string[] = [];
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const assetId = url.searchParams.get("assetId") ?? "";
    requested.push(`${url.pathname}?${assetId}`);
    if (url.pathname.endsWith("/stats")) {
      if (stats === "error") return new Response("{}", { status: 502 });
      return Response.json({ version: 1, provider: "codex", assetId, currency: "USD", fetchedAt: new Date(now).toISOString(),
        status: "ready", stats: {
          marketCapUsd: { atoms: "2410000000000", scale: 0 },
          volume24hUsd: { atoms: "382000005", scale: 1 },
          liquidityUsd: { atoms: "850000", scale: 0 },
        } });
    }
    return Response.json({ version: 1, provider: "codex", assetId, range: url.searchParams.get("range"), currency: "USD",
      fetchedAt: null, status: "empty", points: [] });
  }) as typeof fetch;
  return requested;
}

function show(asset: InvestAsset, regionId: "US" | "ID" = "US") {
  return render(<PresentationRegionProvider regionId={regionId}>
    <AssetStats asset={asset} market={{ status: "loading" }} clock={clock} />
  </PresentationRegionProvider>);
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); window.fetch = originalFetch; });

describe("AssetStats", () => {
  test("crypto shows market cap and volume but not liquidity", async () => {
    mockFetch("ready");
    const view = show(bitcoin);
    await waitFor(() => expect(view.getByText("Market cap")).toBeTruthy());
    expect(view.getByText("24h volume")).toBeTruthy();
    expect(view.queryByText("Liquidity")).toBeNull();
  });

  test("both historical Stats ranges use speculative priority", async () => {
    mockFetch("ready");
    const fetchFixture = window.fetch;
    const priorities: Array<[string, string | null]> = [];
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/history")) {
        priorities.push([url.searchParams.get("range") ?? "", new Headers(init?.headers).get("x-home-history-priority")]);
      }
      return fetchFixture(input, init);
    }) as unknown as typeof fetch;
    show(bitcoin);
    await waitFor(() => expect(priorities).toHaveLength(2));
    expect(priorities).toEqual([["1D", "prefetch"], ["1Y", "prefetch"]]);
  });

  test("range extrema are labelled as closing prices, not intraperiod highs and lows", async () => {
    mockFetch("error");
    const fetchFixture = window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/history") && url.searchParams.get("range") === "1D") {
        return Response.json({ version: 1, provider: "codex", assetId: "cbbtc", range: "1D", currency: "USD",
          fetchedAt: new Date(now).toISOString(), status: "ready", points: [
            { time: new Date(now - 23 * 3600000).toISOString(), value: "100" },
            { time: new Date(now - 60000).toISOString(), value: "120" },
          ] });
      }
      return fetchFixture(input, init);
    }) as unknown as typeof fetch;
    const view = show(bitcoin);
    await waitFor(() => expect(view.getByRole("group", { name: /closing-price low \$100/ })).toBeTruthy());
    expect(view.getByText("· Closing prices")).toBeTruthy();
  });

  test("without a market snapshot the year marker uses the freshest merged close", async () => {
    mockFetch("error");
    const fetchFixture = window.fetch;
    const points: Record<string, Array<{ time: string; value: string }>> = {
      "1Y": [
        { time: new Date(now - 300 * 86400000).toISOString(), value: "80" },
        { time: new Date(now - 86400000).toISOString(), value: "110" },
      ],
      "1D": [
        { time: new Date(now - 23 * 3600000).toISOString(), value: "100" },
        { time: new Date(now - 60000).toISOString(), value: "120" },
      ],
    };
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const range = url.searchParams.get("range") ?? "";
      if (url.pathname.endsWith("/history") && points[range]) {
        return Response.json({ version: 1, provider: "codex", assetId: "cbbtc", range, currency: "USD",
          fetchedAt: new Date(now).toISOString(), status: "ready", points: points[range] });
      }
      return fetchFixture(input, init);
    }) as unknown as typeof fetch;
    const view = show(bitcoin);
    await waitFor(() => expect(view.getByRole("group", { name: /low \$80.*high \$120.*current \$120/ })).toBeTruthy());
  });

  test.each([
    { name: "both ranges fail with an older daily close", failedRanges: ["1D", "1Y"], dayWarning: 48, yearWarning: 48 },
    { name: "daily fails while yearly refreshes", failedRanges: ["1D"], dayWarning: 48, yearWarning: 48 },
    { name: "yearly fails while daily refreshes", failedRanges: ["1Y"], dayWarning: null, yearWarning: 1 },
  ])("cached closing-price rows retain the earliest failed contributing age when $name", async ({ failedRanges, dayWarning, yearWarning }) => {
    mockFetch("error");
    const fixture = window.fetch;
    let refetching = false;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (!url.pathname.endsWith("/history")) return fixture(input, init);
      const range = url.searchParams.get("range");
      const failures: readonly string[] = failedRanges;
      if (refetching && failures.includes(range ?? "")) return Response.json({ invalid: true }, { status: 502 });
      return Response.json({ version: 1, provider: "codex", assetId: "cbbtc", range, currency: "USD",
        fetchedAt: new Date(now - (range === "1D" ? 48 : 1) * 3600000).toISOString(), status: "ready", points: [
          { time: new Date(now - (range === "1D" ? 23 : 300 * 24) * 3600000).toISOString(), value: "100" },
          { time: new Date(now - 60000).toISOString(), value: "120" },
        ] });
    }) as typeof fetch;
    const view = show(bitcoin);
    await waitFor(() => expect(view.getAllByRole("group", { name: /closing-price low/ })).toHaveLength(2));
    refetching = true;
    await act(async () => { await getHomeQueryClient().invalidateQueries({ queryKey: publicQueryKey("price-history", "cbbtc") }); });
    await waitFor(() => {
      const [dayRow, yearRow] = view.getAllByRole("group", { name: /closing-price low/ });
      if (dayWarning === null) expect(dayRow?.querySelector('[role="status"]')).toBeNull();
      else expect(dayRow?.querySelector('[role="status"]')?.textContent).toContain(`Couldn't refresh history · last updated ${formatPresentationDate(now - dayWarning * 3600000, { regionId: "US", style: "date-time-zone" })}`);
      expect(yearRow?.querySelector('[role="status"]')?.textContent).toContain(`Couldn't refresh history · last updated ${formatPresentationDate(now - yearWarning * 3600000, { regionId: "US", style: "date-time-zone" })}`);
    });
    expect(view.getAllByRole("group", { name: /closing-price low/ })).toHaveLength(2);
  });

  test("market tiles use the presentation region", async () => {
    mockFetch("ready");
    const view = show(bitcoin, "ID");
    await waitFor(() => expect(view.getByText("$2,41T")).toBeTruthy());
  });

  test("memes add liquidity", async () => {
    mockFetch("ready");
    const view = show(degen);
    await waitFor(() => expect(view.getByText("Liquidity")).toBeTruthy());
  });

  test("stocks show no market tiles and never request market stats", async () => {
    const requested = mockFetch("ready");
    const view = show(stock);
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested.some((path) => path.includes("/stats"))).toBe(false);
    expect(view.queryByText("Market cap")).toBeNull();
  });

  test("a failed stats read hides tiles instead of inventing values", async () => {
    const requested = mockFetch("error");
    const view = show(bitcoin);
    await waitFor(() => expect(requested.some((path) => path.includes("/stats"))).toBe(true));
    expect(view.queryByText("Market cap")).toBeNull();
  });
});

describe("formatStatUsd", () => {
  test("rounds exact decimals to three significant digits", () => {
    const large = formatStatUsd({ atoms: "2410000000000", scale: 0 });
    const scaled = formatStatUsd({ atoms: "382000005", scale: 1 });
    expect(large).toMatch(/2\.41/);
    expect(scaled).toMatch(/38\.2/);
    expect(large).not.toEqual(scaled);
    expect(formatStatUsd({ atoms: "123456789012345678901234567890", scale: 0 })).toMatch(/\S/);
  });

  test("keeps USD but follows the presentation region's separators and abbreviations", () => {
    expect(formatStatUsd({ atoms: "2410000000000", scale: 0 }, "ID")).toBe("$2,41T");
    expect(formatStatUsd({ atoms: "382000005", scale: 1 }, "BR")).toBe("$38,2\u00A0mi");
    expect(formatStatUsd({ atoms: "382000000", scale: 0 }, "ID")).toBe("$382\u00A0jt");
    expect(formatStatUsd({ atoms: "382000000", scale: 0 })).toBe("$382M");
  });
});
