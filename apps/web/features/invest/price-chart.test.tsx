import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import type { MarketPriceHistoryPoint, MarketPriceRange } from "@/server/market-data/codex/history-contract";
import { PriceChart } from "./price-chart";

function renderChart(
  points: readonly MarketPriceHistoryPoint[],
  range: MarketPriceRange = "1D",
) {
  render(
    <PriceChart
      range={range}
      history={{ status: "ready", points }}
      onRangeChange={() => {}}
    />,
  );
  const chart = within(document.body).getByRole("img", {
    name: `${range} price history`,
  });
  return Array.from(chart.querySelectorAll("text"), (label) => label.textContent ?? "");
}

afterEach(cleanup);

describe("PriceChart labels", () => {
  test("keeps close BTC-scale Y-axis ticks distinct and readable", () => {
    const labels = renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "64210" },
      { time: "2026-09-08T00:30:00.000Z", value: "64250" },
      { time: "2026-09-08T01:00:00.000Z", value: "64290" },
    ]);
    const priceLabels = labels.slice(0, 3);

    expect(new Set(priceLabels).size).toBe(3);
    expect(priceLabels).toEqual(["64.29k", "64.25k", "64.21k"]);
  });

  test("keeps tiny positive Y-axis ticks distinct instead of rounding to zero", () => {
    const labels = renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "0.000012" },
      { time: "2026-09-08T00:30:00.000Z", value: "0.000015" },
      { time: "2026-09-08T01:00:00.000Z", value: "0.000018" },
    ]);
    const priceLabels = labels.slice(0, 3);

    expect(new Set(priceLabels).size).toBe(3);
    expect(priceLabels).toEqual(["0.000018", "0.000015", "0.000012"]);
  });

  test("adds minute precision to sparse one-hour 1D labels", () => {
    const labels = renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "100" },
      { time: "2026-09-08T01:00:00.000Z", value: "101" },
    ]);
    const timeLabels = labels.slice(3);

    expect(new Set(timeLabels).size).toBe(4);
    expect(timeLabels.map((label) => label.match(/:(\d{2})/)?.[1])).toEqual([
      "00",
      "20",
      "40",
      "00",
    ]);
  });

  test("renders a single point with one price and one time label", () => {
    const labels = renderChart([
      { time: "2026-09-08T12:34:00.000Z", value: "64250" },
    ]);

    expect(labels).toHaveLength(2);
    expect(labels[0]).toBe("64.25k");
    expect(labels[1]).toMatch(/:34 [AP]M$/);
  });

  test("renders a flat series with one price label", () => {
    const labels = renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "2.5" },
      { time: "2026-09-08T01:00:00.000Z", value: "2.5" },
    ]);

    expect(labels.filter((label) => label === "2.50")).toHaveLength(1);
  });
});

describe("PriceChart states", () => {
  test("preserves loading, empty, and error states", () => {
    const { rerender } = render(
      <PriceChart
        range="1D"
        history={{ status: "loading", points: [] }}
        onRangeChange={() => {}}
      />,
    );
    expect(
      within(document.body).getByRole("status", { name: "Loading price history" }),
    ).toBeTruthy();

    rerender(
      <PriceChart
        range="1D"
        history={{ status: "empty", points: [] }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByText("No price history for this range.")).toBeTruthy();

    rerender(
      <PriceChart
        range="1D"
        history={{ status: "error", points: [] }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByText("Price history unavailable.")).toBeTruthy();
  });
});
