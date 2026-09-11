import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { useEffect } from "react";
import type { LivelinePoint, LivelineProps } from "liveline";
import type { MarketPriceHistoryPoint, MarketPriceRange } from "@/shared/invest/history-contract";

const livelineCalls: LivelineProps[] = [];
const livelineMounts: string[] = [];

mock.module("liveline", () => ({
  Liveline: (props: LivelineProps) => {
    livelineCalls.push(props);
    useEffect(() => {
      livelineMounts.push("mount");
      return () => {
        livelineMounts.push("unmount");
      };
    }, []);
    return <canvas data-testid="liveline" />;
  },
}));

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  CHART_COVER_FADE_MS,
  LIVELINE_PLOT_PADDING,
  PriceChart,
  formatChartValue,
  toLivelinePoints,
  visibleWindowSeconds,
} = await import("./price-chart");

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
  return render(
    <PriceChart
      range={range}
      history={{ status: "ready", points }}
      onRangeChange={onRangeChange}
    />,
  );
}

async function waitForRevealed(range: MarketPriceRange = "1W") {
  return waitFor(
    () =>
      within(document.body).getByRole("img", {
        name: `${range} price history`,
      }),
    { timeout: CHART_COVER_FADE_MS + 200 },
  );
}

function livelineHadDegenerateFrame() {
  return livelineCalls.some(
    (call) =>
      call.loading === true ||
      call.value === 0 ||
      (Array.isArray(call.data) && call.data.length === 0),
  );
}

afterEach(() => {
  cleanup();
  livelineCalls.length = 0;
  livelineMounts.length = 0;
});

describe("PriceChart Liveline", () => {
  test("feeds converted history to Liveline with locked Direction 1 props", () => {
    stubMatchMedia(false);
    const points = [
      { time: "2026-09-01T00:00:00.000Z", value: "62000" },
      { time: "2026-09-07T00:00:00.000Z", value: "64210" },
    ];
    renderChart(points);

    expect(livelineCalls.length).toBeGreaterThanOrEqual(1);
    const chart = livelineCalls.at(-1)!;
    expect(chart.theme).toBe("light");
    expect(chart.color).toBe("#0052ff");
    expect(chart.fill).toBe(true);
    expect(chart.pulse).toBe(true);
    expect(chart.momentum).toBe(true);
    expect(chart.scrub).toBe(true);
    expect(chart.degen).toBe(false);
    expect(chart.badge).toBe(false);
    expect(chart.showValue).toBe(false);
    expect(chart.lerpSpeed).toBe(0.08);
    expect(chart.data).toEqual(toLivelinePoints(points));
    expect(chart.value).toBe(64210);
    expect(chart.window).toBeGreaterThanOrEqual(7 * 86_400);
    expect(chart.padding).toEqual(LIVELINE_PLOT_PADDING);
    expect(LIVELINE_PLOT_PADDING.right).toBeGreaterThanOrEqual(48);
    expect(LIVELINE_PLOT_PADDING.top).toBeGreaterThanOrEqual(28);
    expect(LIVELINE_PLOT_PADDING.left).toBeGreaterThanOrEqual(16);
  });

  test("wires range chips to the history callback", () => {
    const ranges: MarketPriceRange[] = [];
    renderChart(
      [{ time: "2026-09-07T00:00:00.000Z", value: "64210" }],
      "1W",
      (range) => ranges.push(range),
    );

    expect(within(document.body).getByText("USD")).toBeTruthy();
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
    expect(livelineCalls.at(-1)?.pulse).toBe(false);
    expect(livelineCalls.at(-1)?.momentum).toBe(false);
    expect(livelineCalls.at(-1)?.lerpSpeed).toBe(1);
  });
});

describe("PriceChart states", () => {
  test("reserves the chart stage with Direction 1 shimmer and no degenerate Liveline on cold open", () => {
    const { rerender } = render(
      <PriceChart
        range="1D"
        history={{ status: "loading", points: [] }}
        onRangeChange={() => {}}
      />,
    );
    const loadingStage = within(document.body).getByRole("status", {
      name: "Loading price history",
    });
    expect(loadingStage).toBeTruthy();
    expect(loadingStage.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector("[data-plot-cover='first']")).toBeTruthy();
    expect(document.querySelector("[data-plot-cover='first']")?.className).toContain("shimmer");
    expect(within(document.body).queryByTestId("liveline")).toBeNull();
    expect(livelineCalls).toEqual([]);
    expect(livelineHadDegenerateFrame()).toBe(false);

    rerender(
      <PriceChart
        range="1D"
        history={{ status: "empty", points: [] }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByText("No price history for this range.")).toBeTruthy();
    expect(within(document.body).queryByTestId("liveline")).toBeNull();
    expect(document.querySelector("[data-plot-cover]")).toBeNull();

    rerender(
      <PriceChart
        range="1D"
        history={{ status: "error", points: [] }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByText("Price history unavailable.")).toBeTruthy();
    expect(within(document.body).queryByTestId("liveline")).toBeNull();
    expect(livelineHadDegenerateFrame()).toBe(false);
  });

  test("fades the first-load shimmer over the same Liveline once a complete series is ready", async () => {
    stubMatchMedia(false);
    const week = [
      { time: "2026-09-01T00:00:00.000Z", value: "62000" },
      { time: "2026-09-07T00:00:00.000Z", value: "64210" },
    ];
    const { rerender } = render(
      <PriceChart
        range="1W"
        history={{ status: "loading", points: [] }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).queryByTestId("liveline")).toBeNull();
    expect(document.querySelector("[data-plot-cover='first']")).toBeTruthy();

    rerender(
      <PriceChart
        range="1W"
        history={{ status: "ready", points: week }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByRole("status", { name: "Loading price history" })).toBeTruthy();
    expect(document.querySelector("[data-liveline-hold='reveal']")).toBeTruthy();
    expect(document.querySelector("[data-plot-cover='first'][data-fading='true']")).toBeTruthy();
    const first = livelineCalls.at(-1)!;
    expect(first.data).toEqual(toLivelinePoints(week));
    expect(first.value).toBe(64210);
    expect(first.loading).toBe(false);
    expect(first.lerpSpeed).toBe(0.08);
    expect(livelineHadDegenerateFrame()).toBe(false);
    expect(livelineMounts).toEqual(["mount"]);

    await waitForRevealed("1W");
    expect(document.querySelector("[data-plot-cover]")).toBeNull();
    expect(document.querySelector("[data-liveline-hold]")).toBeNull();
    expect(livelineCalls.at(-1)?.value).toBe(64210);
    expect(livelineMounts).toEqual(["mount"]);
    expect(livelineHadDegenerateFrame()).toBe(false);
  });

  test("keeps one Liveline instance and tweens last-good into the next series", async () => {
    stubMatchMedia(false);
    const week = [
      { time: "2026-09-01T00:00:00.000Z", value: "62000" },
      { time: "2026-09-07T00:00:00.000Z", value: "64210" },
    ];
    const { rerender } = render(
      <PriceChart
        range="1W"
        history={{ status: "ready", points: week }}
        onRangeChange={() => {}}
      />,
    );
    await waitForRevealed("1W");
    const settled = livelineCalls.at(-1)!;
    const weekPoints = toLivelinePoints(week);
    expect(settled.data).toEqual(weekPoints);
    expect(settled.value).toBe(64210);
    expect(settled.loading).toBe(false);
    expect(settled.lerpSpeed).toBe(0.08);
    const frozenWindow = settled.window;
    const frozenValue = settled.value;
    livelineCalls.length = 0;

    rerender(
      <PriceChart
        range="1D"
        history={{ status: "loading", points: week }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByRole("img", { name: "1W price history" })).toBeTruthy();
    expect(within(document.body).getByRole("img").getAttribute("aria-busy")).toBe("true");
    expect(within(document.body).getByRole("button", { name: "1D" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(document.querySelector("[data-liveline-hold='chip']")).toBeTruthy();
    expect(document.querySelector("[data-plot-cover='chip']")).toBeTruthy();
    const held = livelineCalls[0]!;
    expect(held.loading).toBe(false);
    expect(held.data).toEqual(weekPoints);
    expect(held.data).toBe(settled.data);
    expect(held.value).toBe(frozenValue);
    expect(held.window).toBe(frozenWindow);
    expect(held.lerpSpeed).toBe(0.08);
    expect(document.querySelectorAll("[data-testid='liveline']").length).toBe(1);
    expect(livelineMounts).toEqual(["mount"]);
    expect(livelineHadDegenerateFrame()).toBe(false);

    const day = [
      { time: "2026-09-08T00:00:00.000Z", value: "64100" },
      { time: "2026-09-08T12:00:00.000Z", value: "64300" },
    ];
    rerender(
      <PriceChart
        range="1D"
        history={{ status: "ready", points: day }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByRole("img", { name: "1D price history" })).toBeTruthy();
    expect(document.querySelector("[data-liveline-hold]")).toBeNull();
    expect(document.querySelector("[data-plot-cover]")).toBeNull();
    expect(document.querySelector("[data-plot-range]")?.getAttribute("data-plot-range")).toBe("1D");
    expect(document.querySelectorAll("[data-testid='liveline']").length).toBe(1);
    expect(livelineMounts).toEqual(["mount"]);
    const ready = livelineCalls.at(-1)!;
    expect(ready.data).toEqual(toLivelinePoints(day));
    expect(ready.value).toBe(64300);
    expect(ready.window).not.toBe(frozenWindow);
    expect(ready.loading).toBe(false);
    expect(ready.lerpSpeed).toBe(0.08);
    expect(livelineHadDegenerateFrame()).toBe(false);
  });

  test("swaps the series immediately when motion is reduced", () => {
    stubMatchMedia(true);
    const week = [
      { time: "2026-09-01T00:00:00.000Z", value: "62000" },
      { time: "2026-09-07T00:00:00.000Z", value: "64210" },
    ];
    const { rerender } = render(
      <PriceChart
        range="1W"
        history={{ status: "ready", points: week }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByRole("img", { name: "1W price history" })).toBeTruthy();
    expect(document.querySelector("[data-plot-cover]")).toBeNull();
    expect(livelineCalls.at(-1)?.lerpSpeed).toBe(1);

    const day = [
      { time: "2026-09-08T00:00:00.000Z", value: "64100" },
      { time: "2026-09-08T12:00:00.000Z", value: "64300" },
    ];
    rerender(
      <PriceChart
        range="1D"
        history={{ status: "ready", points: day }}
        onRangeChange={() => {}}
      />,
    );
    expect(within(document.body).getByRole("img", { name: "1D price history" })).toBeTruthy();
    expect(document.querySelector("[data-plot-cover]")).toBeNull();
    expect(livelineCalls.at(-1)?.data).toEqual(toLivelinePoints(day));
    expect(livelineCalls.at(-1)?.lerpSpeed).toBe(1);
    expect(livelineMounts).toEqual(["mount"]);
  });
});

describe("Liveline adapters", () => {
  test("formats chart values as explicit USD without collapsing tiny prices", () => {
    expect(formatChartValue(64210)).toBe("$64.21K");
    expect(formatChartValue(0.0123456)).toBe("$0.012346");
    expect(formatChartValue(0.00001234)).toBe("$0.00001234");
    expect(formatChartValue(1.234e-7)).toBe("$0.0000001234");
    expect(formatChartValue(2e-7)).toBe("$0.0000002");
    expect(formatChartValue(3e-7)).toBe("$0.0000003");
  });

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
