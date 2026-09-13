import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import type { MarketPriceRange } from "@/shared/invest/history-contract";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { PriceChart } = await import("./price-chart");

afterEach(cleanup);

function PriceChartProbe() {
  const [range, setRange] = useState<MarketPriceRange>("1D");
  return (
    <PriceChart
      range={range}
      history={{ status: "empty", points: [] }}
      onRangeChange={setRange}
    />
  );
}

test("price ranges preserve controlled single selection", () => {
  render(<PriceChartProbe />);
  expect(page().getByRole("group", { name: "Price range" })).toBeTruthy();
  const day = page().getByRole("button", { name: "1D", pressed: true });
  const month = page().getByRole("button", { name: "1M", pressed: false });
  fireEvent.click(month);
  expect(month.getAttribute("aria-pressed")).toBe("true");
  expect(day.getAttribute("aria-pressed")).toBe("false");
});
