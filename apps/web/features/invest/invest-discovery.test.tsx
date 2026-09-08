import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MarketDataState } from "./invest-market";

mock.module("@/features/trading/trade-actions", () => ({
  TradeActions: ({ asset }: { asset: { displayName: string } }) => (
    <div aria-label={`Trade ${asset.displayName}`}>
      <button type="button">Buy</button>
      <button type="button">Sell</button>
    </div>
  ),
}));

const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { InvestExperience } = await import("./invest-experience");

function page() {
  return within(document.body);
}

const readyCrypto: MarketDataState = {
  status: "ready",
  snapshots: [
    {
      assetId: "cbbtc",
      displayPrice: "$64210",
      asOf: "2026-09-07T20:00:00.000Z",
      sourceLabel: "Codex",
    },
  ],
};

afterEach(() => {
  cleanup();
  window.fetch = originalFetch;
});

const originalFetch = window.fetch;

describe("invest discovery flow", () => {
  test("opens Crypto category from See all and includes Cardano", async () => {
    render(<InvestExperience cryptoMarket={readyCrypto} />);

    fireEvent.click(page().getAllByRole("button", { name: "See all ›" })[1]!);
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Crypto" })).toBeTruthy(),
    );
    expect(page().getByText("Cardano")).toBeTruthy();
    expect(page().getByText("ADA")).toBeTruthy();
    expect(page().queryByText("Buy")).toBeNull();
    expect(page().queryByText("Sell")).toBeNull();
  });

  test("opens Bitcoin detail with compact header, chart ranges, and trade CTA only there", async () => {
    window.fetch = (async () =>
      Response.json({
        version: 1,
        provider: "codex",
        assetId: "cbbtc",
        range: "1W",
        fetchedAt: "2026-09-07T20:00:00.000Z",
        status: "empty",
        points: [],
      })) as unknown as typeof fetch;

    render(<InvestExperience cryptoMarket={readyCrypto} />);
    fireEvent.click(page().getByRole("button", { name: "Bitcoin details" }));

    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Bitcoin" })).toBeTruthy(),
    );
    expect(page().getByText("$64,210.00")).toBeTruthy();
    expect(page().getByText("cbBTC · Base")).toBeTruthy();
    expect(page().getByRole("group", { name: "Price range" }).textContent).toContain(
      "1D",
    );
    expect(page().getByRole("group", { name: "Price range" }).textContent).toContain(
      "1Y",
    );
    expect(page().getByRole("button", { name: "Buy" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Sell" })).toBeTruthy();
    await waitFor(() =>
      expect(page().getByText("No price history for this range.")).toBeTruthy(),
    );
  });

  test("renders a real history series and never substitutes a fake line", async () => {
    window.fetch = (async () =>
      Response.json({
        version: 1,
        provider: "codex",
        assetId: "cbbtc",
        range: "1W",
        fetchedAt: "2026-09-07T20:00:00.000Z",
        status: "ready",
        points: [
          { time: "2026-09-01T00:00:00.000Z", value: "62000" },
          { time: "2026-09-07T00:00:00.000Z", value: "64210" },
        ],
      })) as unknown as typeof fetch;

    render(<InvestExperience cryptoMarket={readyCrypto} />);
    fireEvent.click(page().getByRole("button", { name: "Bitcoin details" }));

    await waitFor(() =>
      expect(page().getByRole("img", { name: "1W price history" })).toBeTruthy(),
    );
    expect(page().queryByText("No price history for this range.")).toBeNull();
  });

  test("uses a real AssetIcon instead of letter initials as the primary mark", () => {
    render(<InvestExperience />);
    expect(page().getByRole("img", { name: "NVIDIA icon" }).querySelector("svg")).toBeTruthy();
    expect(page().getByRole("img", { name: "Bitcoin icon" }).querySelector("svg")).toBeTruthy();
    const nvidia = page().getByRole("img", { name: "NVIDIA icon" }).textContent ?? "";
    expect(nvidia).not.toBe("NV");
  });
});
