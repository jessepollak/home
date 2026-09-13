import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const { cleanup, render } = await import("@testing-library/react");
const { MoneyTicker, splitMoneyTickerValue } = await import("./money-ticker");

afterEach(cleanup);

const trickyValues = [
  "R$ 1.234,56",
  "Rp 78.123.456,00",
  "$0.0000001234",
  "−0,67 %",
] as const;

test("formatted money values round-trip without numeric coercion", () => {
  for (const value of trickyValues) {
    const parts = splitMoneyTickerValue(value);
    expect(`${parts.prefix}${parts.numeric}${parts.suffix}`).toBe(value);
    expect(renderToStaticMarkup(<MoneyTicker value={value} />)).toContain(value);
  }
});

test("a placeholder replaces animated digits immediately", () => {
  const view = render(<MoneyTicker value="$12.34" />);
  expect(view.container.querySelectorAll("number-flow-react")).toHaveLength(4);

  view.rerender(<MoneyTicker value="—" />);

  const ticker = view.container.querySelector<HTMLElement>(
    '[data-slot="money-ticker"]',
  );
  expect(ticker?.getAttribute("aria-label")).toBe("—");
  expect(
    ticker?.querySelector('[data-slot="money-ticker-track"]')?.textContent,
  ).toBe("—");
  expect(view.container.querySelector("number-flow-react")).toBeNull();
});

test("character reservation follows its configured growth behavior", () => {
  const view = render(<MoneyTicker value="$0" reserveDigits={false} />);
  const ticker = view.container.querySelector<HTMLElement>(
    '[data-slot="money-ticker"]',
  );
  const rightmostDigit = view.container.querySelector("number-flow-react")!;
  expect(ticker?.style.minInlineSize).toBe("2ch");
  expect(ticker?.getAttribute("data-reserve-digits")).toBe("false");

  view.rerender(<MoneyTicker value="$25" reserveDigits={false} />);
  expect(ticker?.style.minInlineSize).toBe("3ch");
  expect(view.container.querySelectorAll("number-flow-react")[1]).toBe(
    rightmostDigit,
  );

  view.rerender(<MoneyTicker value="$258" reserveDigits={false} />);
  expect(ticker?.style.minInlineSize).toBe("4ch");
  expect(view.container.querySelectorAll("number-flow-react")[2]).toBe(
    rightmostDigit,
  );

  view.rerender(<MoneyTicker value="$0" reserveDigits={false} />);
  expect(ticker?.style.minInlineSize).toBe("2ch");

  view.rerender(<MoneyTicker value="$258" />);
  expect(ticker?.style.minInlineSize).toBe("4ch");
  expect(ticker?.getAttribute("data-reserve-digits")).toBe("true");

  view.rerender(<MoneyTicker value="$0" />);
  expect(ticker?.style.minInlineSize).toBe("4ch");
});
