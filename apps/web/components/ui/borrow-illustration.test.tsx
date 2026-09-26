import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { BorrowIllustration } from "./borrow-illustration";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");

const originalMatchMedia = window.matchMedia;
const originalObserver = globalThis.IntersectionObserver;

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  globalThis.IntersectionObserver = originalObserver;
});

function controllableReducedMotion() {
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
  return (matches: boolean) => {
    media.matches = matches;
    for (const listener of listeners) listener();
  };
}

test("the entrance never replays after reduced motion is switched on and off again", async () => {
  const setReduced = controllableReducedMotion();
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
  const view = render(<BorrowIllustration />);
  const svg = () => view.container.querySelector("[data-slot=borrow-illustration]");

  await waitFor(() => expect(svg()?.getAttribute("data-state")).toBe("playing"));
  act(() => setReduced(true));
  expect(svg()?.getAttribute("data-state")).toBe("idle");
  act(() => setReduced(false));
  expect(svg()?.getAttribute("data-state")).toBe("idle");
});
