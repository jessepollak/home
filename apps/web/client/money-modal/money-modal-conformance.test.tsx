import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyModal, MoneyModalStep } = await import("./money-modal");

const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");

type RecordedAnimation = {
  target: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
  animation: Animation;
};

function animationHarness(reduced: boolean) {
  const records: RecordedAnimation[] = [];
  const reads = new Map<string, number>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && reduced, media: query, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute("data-slot") !== "money-modal-steps") return 0;
      const step = this.querySelector("[data-money-step]")?.getAttribute("data-money-step") ?? "";
      const count = reads.get(step) ?? 0;
      reads.set(step, count + 1);
      if (step === "amount") return 100;
      if (step === "review") return 180;
      if (step === "result") return count === 0 ? 140 : 240;
      return count === 0 ? 200 : 300;
    },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) { queueMicrotask(() => this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)); }
      disconnect() {}
    },
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      const record: RecordedAnimation = {
        target: this, frames, options, cancelled: false,
        animation: { cancel() { record.cancelled = true; }, finished: Promise.resolve() } as unknown as Animation,
      };
      records.push(record);
      return record.animation;
    },
  });
  return records;
}

function Journey() {
  const [index, setIndex] = useState(0);
  const steps = ["amount", "review", "result", "finished"];
  const step = steps[index]!;
  return <MoneyModal open labelledBy="conformance-title" immediate onCancel={() => {}} onClose={() => {}}>
    <MoneyModalStep step={step} depth={index}>
      <h2 id="conformance-title">Journey</h2>
      {index < 3 ? <button type="button" onClick={() => setIndex(index + 1)}>Continue</button> : <input aria-label="Final amount" data-money-amount-input />}
    </MoneyModalStep>
  </MoneyModal>;
}

afterEach(async () => {
  cleanup();
  for (const [name, descriptor, target] of [
    ["animate", animateDescriptor, HTMLElement.prototype],
    ["matchMedia", matchMediaDescriptor, window],
    ["offsetHeight", heightDescriptor, HTMLElement.prototype],
    ["ResizeObserver", resizeObserverDescriptor, globalThis],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
  await waitFor(() => expect(document.querySelector("[data-base-ui-portal]")).toBeNull());
  document.body.style.overflow = "";
  document.body.style.overflowX = "";
  document.body.style.overflowY = "";
  document.documentElement.style.scrollbarGutter = "";
});

test("rapid transitions cancel prior step and height animations, keep one sheet, and focus the final step", async () => {
  const animations = animationHarness(false);
  render(<Journey />);
  const host = document.querySelector<HTMLElement>("[data-slot=money-modal-steps]")!;
  await act(async () => {});
  for (let index = 0; index < 3; index++) {
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Continue" })));
    expect(page().getAllByRole("dialog")).toHaveLength(1);
  }
  const steps = animations.filter(({ target }) => target.hasAttribute("data-money-step"));
  const heights = animations.filter(({ target }) => target === host);
  expect(steps).toHaveLength(3);
  expect(heights).toHaveLength(3);
  expect(steps.slice(0, 2).every(({ cancelled }) => cancelled)).toBe(true);
  expect(heights.slice(0, 2).every(({ cancelled }) => cancelled)).toBe(true);
  expect(document.activeElement).toBe(page().getByRole("textbox", { name: "Final amount" }));
  expect(host.style.overflow).toBe("hidden");
  heights[0]!.animation.onfinish?.(new Event("finish") as AnimationPlaybackEvent);
  expect(host.style.overflow).toBe("hidden");
  heights[2]!.animation.onfinish?.(new Event("finish") as AnimationPlaybackEvent);
  expect(host.style.overflow).toBe("");
});

test("reduced motion uses opacity only without a height lock", async () => {
  const animations = animationHarness(true);
  render(<Journey />);
  const host = document.querySelector<HTMLElement>("[data-slot=money-modal-steps]")!;
  await act(async () => fireEvent.click(page().getByRole("button", { name: "Continue" })));
  expect(page().getAllByRole("dialog")).toHaveLength(1);
  expect(animations).toHaveLength(1);
  expect(animations[0]!.frames).toEqual([{ opacity: 0.4 }, { opacity: 1 }]);
  expect(animations[0]!.options.duration).toBe(120);
  expect(host.style.overflow).toBe("");
});
