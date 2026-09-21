import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";

const { cleanup, render } = await import("@testing-library/react");
const { PriceChart } = await import("./price-chart");

afterEach(cleanup);

test("keeps the last good plot while a new range loads", () => {
  const ready = {
    status: "ready" as const,
    points: [
      { time: "2026-09-13T12:00:00.000Z", value: "1" },
      { time: "2026-09-13T13:00:00.000Z", value: "2" },
    ],
  };
  const view = render(
    <PriceChart range="1D" history={ready} onRangeChange={() => {}} />,
  );
  const firstPlot = view.container.querySelector("[data-plot-range]");
  expect(firstPlot?.getAttribute("data-plot-range")).toBe("1D");

  view.rerender(
    <PriceChart
      range="1W"
      history={{ status: "loading", points: [] }}
      onRangeChange={() => {}}
    />,
  );

  expect(view.container.querySelector("[data-plot-range]")).toBe(firstPlot);
  expect(firstPlot?.getAttribute("data-plot-range")).toBe("1D");
});
