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

test("price ranges use shared radio semantics and preserve controlled selection", () => {
  render(<PriceChartProbe />);
  const group = page().getByRole("radiogroup", { name: "Price range" });
  const day = page().getByRole("radio", { name: "1D", checked: true });
  const month = page().getByRole("radio", { name: "1M" });
  expect(group.classList.contains("home-ui-segmented-control")).toBe(true);
  fireEvent.click(month);
  expect(month.getAttribute("aria-checked")).toBe("true");
  expect(day.getAttribute("aria-checked")).toBe("false");
});
