import "@/client/account/dom-test-harness";

import { afterAll, afterEach, expect, test } from "bun:test";
import { createElement } from "react";

const originalMatchMedia = window.matchMedia;
let reducedMotion = false;
const changeListeners = new Set<EventListenerOrEventListenerObject>();
const reducedMotionMedia = {
  get matches() { return reducedMotion; },
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "change") changeListeners.add(listener);
  },
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "change") changeListeners.delete(listener);
  },
  addListener(listener: EventListenerOrEventListenerObject) { changeListeners.add(listener); },
  removeListener(listener: EventListenerOrEventListenerObject) { changeListeners.delete(listener); },
  dispatchEvent: () => true,
} as MediaQueryList;
window.matchMedia = (() => reducedMotionMedia) as typeof window.matchMedia;

const { act, cleanup, render } = await import("@testing-library/react");
const {
  MoneyMotionProvider,
  MoneyTicker,
  moneyTickerAnimationsEnabled,
  splitMoneyTickerValue,
} = await import("./money-ticker");

function setReducedMotion(next: boolean) {
  reducedMotion = next;
  const event = new Event("change");
  for (const listener of changeListeners) {
    if (typeof listener === "function") listener(event);
    else listener.handleEvent(event);
  }
}

afterEach(() => {
  cleanup();
  act(() => setReducedMotion(false));
});
afterAll(() => {
  window.matchMedia = originalMatchMedia;
});

const trickyValues = [
  "R$ 1.234,56",
  "Rp 78.123.456,00",
  "$0.0000001234",
  "−0,67 %",
] as const;

test("the default ticker animates normally and disables animation when reduced motion changes", () => {
  const view = render(createElement(MoneyTicker, { value: "$250.00" }));
  const ticker = view.getByRole("img", { name: "$250.00" });
  expect(ticker.getAttribute("data-animated")).toBe("true");

  act(() => setReducedMotion(true));
  expect(ticker.getAttribute("data-animated")).toBe("false");
  expect(ticker.getAttribute("aria-label")).toBe("$250.00");
});

test("a scoped review fixture can force reduced motion without changing the system preference", () => {
  const view = render(createElement(
    MoneyMotionProvider,
    { reducedMotion: true },
    createElement(MoneyTicker, { value: "$250.00" }),
  ));
  expect(view.getByRole("img", { name: "$250.00" }).getAttribute("data-animated")).toBe("false");
  expect(reducedMotion).toBe(false);
});

test("reduced motion disables digit transitions without suppressing value updates", () => {
  expect(moneyTickerAnimationsEnabled(true, true)).toBe(false);
  expect(moneyTickerAnimationsEnabled(true, false)).toBe(true);
});

test("formatted money values round-trip without numeric coercion", () => {
  for (const value of trickyValues) {
    const parts = splitMoneyTickerValue(value);
    expect(`${parts.prefix}${parts.numeric}${parts.suffix}`).toBe(value);
  }
});
