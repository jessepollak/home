import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { LivelinePoint, LivelineProps } from "liveline";
import type { MarketPriceHistoryPoint, MarketPriceRange } from "@/server/market-data/codex/history-contract";

const livelineCalls: LivelineProps[] = [];

mock.module("liveline", () => ({
  Liveline: (props: LivelineProps) => {
    livelineCalls.push(props);
    return <canvas data-testid="liveline" />;
  },
}));

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { PriceChart, toLivelinePoints, visibleWindowSeconds } = await import("./price-chart");

function stubMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: reducedMotion && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }),
  });
}

function renderChart(
  points: readonly MarketPriceHistoryPoint[],
  range: MarketPriceRange = "1W",
  onRangeChange: (range: MarketPriceRange) => void = () => {},
) {
  render(
    <PriceChart
      range={range}
      history={{ status: "ready", points }}
      onRangeChange={onRangeChange}
    />,
  );
  return within(document.body).getByRole("img", {
    name: `${range} price history`,
  });
}

afterEach(() => {
  cleanup();
  livelineCalls.length = 0;
});

describe("PriceChart Liveline", () => {
  test("feeds converted history to Liveline with locked Direction 1 props", () => {
    stubMatchMedia(false);
    const points = [
      { time: "2026-09-01T00:00:00.000Z", value: "62000" },
      { time: "2026-09-07T00:00:00.000Z", value: "64210" },
    ];
    renderChart(points);

    expect(livelineCalls).toHaveLength(1);
    const chart = livelineCalls[0]!;
    expect(chart.theme).toBe("light");
    expect(chart.color).toBe("#0052ff");
    expect(chart.fill).toBe(true);
    expect(chart.pulse).toBe(true);
    expect(chart.momentum).toBe(true);
    expect(chart.scrub).toBe(true);
    expect(chart.degen).toBe(false);
    expect(chart.badge).toBe(false);
    expect(chart.showValue).toBe(false);
    expect(chart.data).toEqual(toLivelinePoints(points));
    expect(chart.value).toBe(64210);
    expect(chart.window).toBeGreaterThanOrEqual(7 * 86_400);
  });

  test("wires range chips to the history callback", () => {
    const ranges: MarketPriceRange[] = [];
    renderChart(
      [{ time: "2026-09-07T00:00:00.000Z", value: "64210" }],
      "1W",
      (range) => ranges.push(range),
    );

    const group = within(document.body).getByRole("group", { name: "Price range" });
    expect(group.textContent).toContain("1D");
    expect(group.textContent).toContain("1Y");
    fireEvent.click(within(group).getByRole("button", { name: "1D" }));
    fireEvent.click(within(group).getByRole("button", { name: "1Y" }));
    expect(ranges).toEqual(["1D", "1Y"]);
  });

  test("turns pulse and momentum off when motion is reduced", () => {
    stubMatchMedia(true);
    renderChart([{ time: "2026-09-07T00:00:00.000Z", value: "64210" }]);
    expect(livelineCalls[0]?.pulse).toBe(false);
    expect(livelineCalls[0]?.momentum).toBe(false);
    expect(livelineCalls[0]?.lerpSpeed).toBe(1);
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
    expect(livelineCalls[0]?.loading).toBe(true);

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

describe("Liveline adapters", () => {
  test("converts ISO points to unix-second Liveline points", () => {
    expect(
      toLivelinePoints([
        { time: "2026-09-08T00:00:00.000Z", value: "64210" },
        { time: "not-a-time", value: "1" },
        { time: "2026-09-08T01:00:00.000Z", value: "nope" },
      ]),
    ).toEqual<LivelinePoint[]>([
      { time: Date.parse("2026-09-08T00:00:00.000Z") / 1000, value: 64210 },
    ]);
  });

  test("keeps the selected range visible even when the last tick is slightly stale", () => {
    const first = Date.parse("2026-09-01T00:00:00.000Z") / 1000;
    const last = Date.parse("2026-09-07T00:00:00.000Z") / 1000;
    const window = visibleWindowSeconds("1W", [
      { time: first, value: 62000 },
      { time: last, value: 64210 },
    ]);

    expect(window).toBeGreaterThanOrEqual(7 * 86_400);
    expect(window).toBeGreaterThanOrEqual(Date.now() / 1000 - first);
  });
});
