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
  return within(document.body).getByRole("img", {
    name: `${range} price history`,
  });
}

function chartLabels(chart: HTMLElement) {
  return Array.from(chart.querySelectorAll("text"), (label) => label.textContent ?? "");
}

afterEach(cleanup);

describe("PriceChart labels", () => {
  test("keeps close BTC-scale Y-axis ticks distinct and readable", () => {
    const labels = chartLabels(renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "64210" },
      { time: "2026-09-08T00:30:00.000Z", value: "64250" },
      { time: "2026-09-08T01:00:00.000Z", value: "64290" },
    ]));
    const priceLabels = labels.slice(0, 3);

    expect(new Set(priceLabels).size).toBe(3);
    expect(priceLabels).toEqual(["64.29k", "64.25k", "64.21k"]);
  });

  test("keeps tiny positive Y-axis ticks distinct instead of rounding to zero", () => {
    const labels = chartLabels(renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "0.000012" },
      { time: "2026-09-08T00:30:00.000Z", value: "0.000015" },
      { time: "2026-09-08T01:00:00.000Z", value: "0.000018" },
    ]));
    const priceLabels = labels.slice(0, 3);

    expect(new Set(priceLabels).size).toBe(3);
    expect(priceLabels).toEqual(["0.000018", "0.000015", "0.000012"]);
  });

  test("keeps high-precision scientific ticks distinct and clear of the plot", () => {
    const chart = renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "0.0000120000001" },
      { time: "2026-09-08T00:30:00.000Z", value: "0.0000120000002" },
      { time: "2026-09-08T01:00:00.000Z", value: "0.0000120000003" },
    ]);
    const priceLabels = chartLabels(chart).slice(0, 3);
    const line = chart.querySelectorAll("path")[1]?.getAttribute("d") ?? "";
    const plotRight = Math.max(
      ...Array.from(line.matchAll(/[ML]([\d.]+) /g), (match) => Number(match[1])),
    );

    expect(priceLabels).toEqual([
      "1.20000003e-5",
      "1.20000002e-5",
      "1.20000001e-5",
    ]);
    expect(new Set(priceLabels).size).toBe(3);
    expect(plotRight).toBeLessThanOrEqual(230);
  });

  test("preserves representable scientific differences beyond ten fraction digits", () => {
    const labels = chartLabels(renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "0.0000120000000001" },
      { time: "2026-09-08T01:00:00.000Z", value: "0.0000120000000003" },
    ])).slice(0, 3);

    expect(labels).toEqual([
      "1.20000000003e-5",
      "1.20000000002e-5",
      "1.20000000001e-5",
    ]);
    expect(new Set(labels).size).toBe(3);
  });

  test("adds minute precision and inward anchors to sparse one-hour 1D labels", () => {
    const chart = renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "100" },
      { time: "2026-09-08T01:00:00.000Z", value: "101" },
    ]);
    const timeLabels = Array.from(chart.querySelectorAll("text")).slice(3);

    expect(new Set(timeLabels.map((label) => label.textContent)).size).toBe(4);
    expect(
      timeLabels.map((label) => label.textContent?.match(/:(\d{2})/)?.[1]),
    ).toEqual(["00", "20", "40", "00"]);
    expect(timeLabels.map((label) => label.getAttribute("text-anchor"))).toEqual([
      "start",
      "middle",
      "middle",
      "end",
    ]);
  });

  test("reduces 1D time ticks when long scientific labels narrow the plot", () => {
    const chart = renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "1.200000000000001e-300" },
      { time: "2026-09-08T01:00:00.000Z", value: "1.200000000000003e-300" },
    ]);
    const labels = Array.from(chart.querySelectorAll("text"));
    const priceLabels = labels.slice(0, 3);
    const timeLabels = labels.slice(3);
    const estimatedBounds = timeLabels.map((label) => {
      const x = Number(label.getAttribute("x"));
      const width = (label.textContent?.length ?? 0) * 6;
      const anchor = label.getAttribute("text-anchor");
      return anchor === "start"
        ? { left: x, right: x + width }
        : anchor === "end"
          ? { left: x - width, right: x }
          : { left: x - width / 2, right: x + width / 2 };
    });
    const line = chart.querySelectorAll("path")[1]?.getAttribute("d") ?? "";
    const plotXs = Array.from(
      line.matchAll(/[ML]([\d.e+-]+) /g),
      (match) => Number(match[1]),
    );
    const plotLeft = Math.min(...plotXs);
    const plotRight = Math.max(...plotXs);

    expect(new Set(priceLabels.map((label) => label.textContent)).size).toBe(3);
    expect(timeLabels).toHaveLength(3);
    expect(new Set(timeLabels.map((label) => label.textContent)).size).toBe(3);
    expect(
      timeLabels.map((label) => label.textContent?.match(/:(\d{2})/)?.[1]),
    ).toEqual(["00", "30", "00"]);
    expect(timeLabels.map((label) => label.getAttribute("text-anchor"))).toEqual([
      "start",
      "middle",
      "end",
    ]);
    expect(timeLabels.map((label) => Number(label.getAttribute("x")))).toEqual([
      plotLeft,
      (plotLeft + plotRight) / 2,
      plotRight,
    ]);
    expect(
      estimatedBounds.every(
        (bounds, index) =>
          bounds.left >= plotLeft &&
          bounds.right <= plotRight &&
          (index === 0 || estimatedBounds[index - 1]!.right <= bounds.left),
      ),
    ).toBe(true);
  });

  test("keeps seven 1W time ticks when the plot has room", () => {
    const chart = renderChart([
      { time: "2026-09-01T00:00:00.000Z", value: "100" },
      { time: "2026-09-07T00:00:00.000Z", value: "101" },
    ], "1W");
    const timeLabels = Array.from(chart.querySelectorAll("text")).slice(3);

    expect(timeLabels).toHaveLength(7);
    expect(new Set(timeLabels.map((label) => label.textContent)).size).toBe(7);
    expect(timeLabels.map((label) => label.getAttribute("text-anchor"))).toEqual([
      "start",
      "middle",
      "middle",
      "middle",
      "middle",
      "middle",
      "end",
    ]);
  });

  test("renders a single point with one price and one centered time label", () => {
    const chart = renderChart([
      { time: "2026-09-08T12:34:00.000Z", value: "64250" },
    ]);
    const labels = Array.from(chart.querySelectorAll("text"));

    expect(labels).toHaveLength(2);
    expect(labels[0]?.textContent).toBe("64.25k");
    expect(labels[1]?.textContent).toMatch(/:34 [AP]M$/);
    expect(labels[1]?.getAttribute("text-anchor")).toBe("middle");
  });

  test("renders a flat series with one price label", () => {
    const labels = chartLabels(renderChart([
      { time: "2026-09-08T00:00:00.000Z", value: "2.5" },
      { time: "2026-09-08T01:00:00.000Z", value: "2.5" },
    ]));

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
