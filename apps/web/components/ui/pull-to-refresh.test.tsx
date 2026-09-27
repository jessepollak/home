import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, test, mock, spyOn } from "bun:test";
import { useRef } from "react";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { PullToRefreshAction, PullToRefreshIndicator, usePullToRefresh } = await import("./pull-to-refresh");

type Props = { enabled?: boolean; refreshing?: boolean; onRefresh: () => void };

function Fixture({ enabled = true, refreshing = false, onRefresh }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gesture = usePullToRefresh({ scrollRef, contentRef, enabled, refreshing, onRefresh });
  return <div ref={scrollRef} data-phase={gesture.phase}><PullToRefreshAction label="Refresh Home" refreshing={refreshing} onRefresh={onRefresh} actionRef={gesture.actionRef} /><PullToRefreshIndicator phase={gesture.phase} indicatorRef={gesture.indicatorRef} /><div ref={contentRef} data-testid="content"><span data-testid="target">Balance</span><div data-testid="nested"><span data-testid="nested-target">Nested</span></div><div aria-modal="true"><span data-testid="modal-target">Modal</span></div><input data-testid="input" /><div data-pull-to-refresh-ignore=""><span data-testid="ignored">Ignored</span></div></div></div>;
}

function touch(x: number, y: number, identifier = 1) {
  return { identifier, clientX: x, clientY: y };
}

function send(node: HTMLElement, type: string, touches: ReturnType<typeof touch>[], changedTouches = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
  void act(() => node.dispatchEvent(event));
  return event;
}

function finish(content: HTMLElement) {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "transform" });
  void act(() => content.dispatchEvent(event));
}

function pull(node: HTMLElement, y: number) {
  send(node, "touchstart", [touch(0, 0)]);
  return send(node, "touchmove", [touch(0, y)]);
}

function capturePaint() {
  const frames: FrameRequestCallback[] = [];
  spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  return () => {
    for (const frame of frames.splice(0)) frame(0);
  };
}

beforeEach(() => {
  spyOn(window, "getSelection").mockReturnValue({ isCollapsed: true } as Selection);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }),
  });
});

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  cleanup();
  mock.restore();
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
});

test("an active text selection never starts a pull", () => {
  spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  expect(pull(node, 350).defaultPrevented).toBe(false);
  send(node, "touchend", [], [touch(0, 350)]);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(onRefresh).not.toHaveBeenCalled();
});

test("below threshold releases without refresh and returns to idle", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  expect(pull(node, 60).defaultPrevented).toBe(true);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("pulling");
  send(node, "touchend", [], [touch(0, 60)]);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  finish(view.getByTestId("content"));
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(onRefresh).not.toHaveBeenCalled();
});

test("armed release refreshes exactly once, then settles when refreshing finishes", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  pull(node, 350);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("armed");
  send(node, "touchend", [], [touch(0, 350)]);
  send(node, "touchend", [], [touch(0, 350)]);
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("refreshing");
  view.rerender(<Fixture onRefresh={onRefresh} refreshing />);
  view.rerender(<Fixture onRefresh={onRefresh} />);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  finish(view.getByTestId("content"));
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
});

test("reduced motion keeps pulling still, holds content clear while refreshing, and resets instantly", () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({
      matches: media === "(prefers-reduced-motion: reduce)",
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  const flushPaint = capturePaint();
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  const content = view.getByTestId("content");
  const indicator = view.container.querySelector<HTMLElement>("[data-slot='pull-to-refresh-indicator']")!;

  pull(node, 60);
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("pulling");
  expect(content.style.transform).toBe("");
  expect(Number(indicator.style.opacity)).toBeGreaterThan(0);

  send(node, "touchmove", [touch(0, 350)]);
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("armed");
  expect(content.style.transform).toBe("");
  expect(Number(indicator.style.opacity)).toBeGreaterThan(0);

  send(node, "touchend", [], [touch(0, 350)]);
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("refreshing");
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  expect(content.style.transition).toContain("transform 0ms");
  expect(Number(indicator.style.opacity)).toBeGreaterThan(0);
  expect(onRefresh).toHaveBeenCalledTimes(1);

  view.rerender(<Fixture onRefresh={onRefresh} refreshing />);
  view.rerender(<Fixture onRefresh={onRefresh} />);
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
  expect(content.style.transition).toContain("transform 0ms");
  finish(content);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
});

test.each([
  { distance: 60, phase: "pulling" },
  { distance: 350, phase: "armed" },
])("touchcancel from $phase settles without refreshing", ({ distance, phase }) => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  pull(node, distance);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe(phase);
  send(node, "touchcancel", [], [touch(0, distance)]);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  finish(view.getByTestId("content"));
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(onRefresh).not.toHaveBeenCalled();
});

test("armed release keeps its hold offset when refreshing becomes true", () => {
  const flushPaint = capturePaint();
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  const content = view.getByTestId("content");
  pull(node, 350);
  send(node, "touchend", [], [touch(0, 350)]);
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  const holdTransition = content.style.transition;
  expect(holdTransition).toContain("transform 220ms");

  view.rerender(<Fixture onRefresh={onRefresh} refreshing />);
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  expect(content.style.transition).toBe(holdTransition);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("refreshing");
});

test("keyboard focus reveals the refresh action and holds idle content clear until blur", () => {
  const flushPaint = capturePaint();
  const view = render(<Fixture onRefresh={() => {}} />);
  const action = view.getByRole("button", { name: "Refresh Home" });
  const content = view.getByTestId("content");
  const indicator = view.container.querySelector<HTMLElement>("[data-slot='pull-to-refresh-indicator']")!;
  spyOn(action, "matches").mockImplementation((selector) => selector === ":focus-visible");
  act(() => action.focus());
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  expect(indicator.style.opacity).toBe("0");
  act(() => action.blur());
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
});

test("refresh completion preserves focused action clearance through settling and releases it on blur", () => {
  const flushPaint = capturePaint();
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} refreshing />);
  const action = view.getByRole("button", { name: "Refresh Home" });
  const content = view.getByTestId("content");
  spyOn(action, "matches").mockImplementation((selector) => selector === ":focus-visible");
  act(() => action.focus());
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  view.rerender(<Fixture onRefresh={onRefresh} />);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  finish(content);
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  expect(onRefresh).not.toHaveBeenCalled();
  act(() => action.blur());
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
});

test("focus during settling clears the action while preserving its completion", () => {
  const flushPaint = capturePaint();
  const view = render(<Fixture onRefresh={() => {}} refreshing />);
  const action = view.getByRole("button", { name: "Refresh Home" });
  const content = view.getByTestId("content");
  spyOn(action, "matches").mockImplementation((selector) => selector === ":focus-visible");
  flushPaint();
  view.rerender(<Fixture onRefresh={() => {}} />);
  act(() => action.focus());
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  finish(content);
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
});

test("blur while refreshing lets completion settle to no offset", () => {
  const flushPaint = capturePaint();
  const view = render(<Fixture onRefresh={() => {}} refreshing />);
  const action = view.getByRole("button", { name: "Refresh Home" });
  const content = view.getByTestId("content");
  spyOn(action, "matches").mockImplementation((selector) => selector === ":focus-visible");
  act(() => action.focus());
  flushPaint();
  act(() => action.blur());
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  view.rerender(<Fixture onRefresh={() => {}} />);
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
  finish(content);
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
});

test("blur during settling animates back to no offset before idle", () => {
  const flushPaint = capturePaint();
  const view = render(<Fixture onRefresh={() => {}} refreshing />);
  const action = view.getByRole("button", { name: "Refresh Home" });
  const content = view.getByTestId("content");
  spyOn(action, "matches").mockImplementation((selector) => selector === ":focus-visible");
  act(() => action.focus());
  flushPaint();
  view.rerender(<Fixture onRefresh={() => {}} />);
  flushPaint();
  act(() => action.blur());
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
  expect(content.style.transition).toContain("transform 220ms");
  finish(content);
  flushPaint();
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
});

test("refresh completion animates from hold through settling before idle", () => {
  const flushPaint = capturePaint();
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} refreshing />);
  const content = view.getByTestId("content");
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");

  view.rerender(<Fixture onRefresh={onRefresh} />);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  expect(content.style.transform).toBe("translate3d(0, 52px, 0)");
  expect(content.style.transition).toContain("transform 220ms");
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 0px, 0)");
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  finish(content);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
});

test("hold offset uses indicator geometry and subtracts content top padding", () => {
  const flushPaint = capturePaint();
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const indicator = view.container.querySelector<HTMLElement>("[data-slot='pull-to-refresh-indicator']")!;
  const content = view.getByTestId("content");
  Object.defineProperties(indicator, { offsetTop: { value: 18 }, offsetHeight: { value: 40 } });
  content.style.paddingTop = "12px";
  view.rerender(<Fixture onRefresh={onRefresh} refreshing />);
  flushPaint();
  expect(content.style.transform).toBe("translate3d(0, 64px, 0)");
});

test("hold offset falls back when layout measurements are zero", () => {
  const flushPaint = capturePaint();
  const view = render(<Fixture onRefresh={() => {}} refreshing />);
  flushPaint();
  expect(view.getByTestId("content").style.transform).toBe("translate3d(0, 52px, 0)");
});

test("refresh action is icon-only, named, and stays focusable but disabled while busy", () => {
  const onRefresh = mock(() => {});
  const view = render(<PullToRefreshAction label="Refresh Home" refreshing={false} onRefresh={onRefresh} />);
  const action = view.getByRole("button", { name: "Refresh Home" });
  expect(action.textContent).toBe("");
  expect(action.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(1);
  fireEvent.click(action);
  expect(onRefresh).toHaveBeenCalledTimes(1);
  view.rerender(<PullToRefreshAction label="Refresh Home" refreshing onRefresh={onRefresh} />);
  expect(action.textContent).toBe("");
  expect(action.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(1);
  expect(action.getAttribute("aria-busy")).toBe("true");
  expect(action.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(action);
  expect(onRefresh).toHaveBeenCalledTimes(1);
  action.focus();
  expect(document.activeElement).toBe(action);
  expect(action.tabIndex).toBeGreaterThanOrEqual(0);
});

test("refreshing changes do not rebind touch listeners", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const owner = view.container.firstElementChild as HTMLElement;
  const add = spyOn(owner, "addEventListener");
  const action = view.getByRole("button", { name: "Refresh Home" });
  const actionAdd = spyOn(action, "addEventListener");

  view.rerender(<Fixture onRefresh={onRefresh} refreshing />);
  view.rerender(<Fixture onRefresh={onRefresh} />);
  expect(add.mock.calls.filter(([name]) => String(name).startsWith("touch"))).toHaveLength(0);
  expect(actionAdd.mock.calls.filter(([name]) => name === "focus" || name === "blur")).toHaveLength(0);
});

test("scrolled owner never captures and horizontal motion leaves native gesture alone", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  const owner = view.container.firstElementChild as HTMLElement;
  owner.scrollTop = 5;
  expect(pull(node, 350).defaultPrevented).toBe(false);
  owner.scrollTop = 0;
  send(node, "touchstart", [touch(0, 0)]);
  expect(send(node, "touchmove", [touch(50, 9)]).defaultPrevented).toBe(false);
  expect(send(node, "touchmove", [touch(0, 350)]).defaultPrevented).toBe(false);
  expect(owner.getAttribute("data-phase")).toBe("idle");
  expect(onRefresh).not.toHaveBeenCalled();
});

test("multi-touch aborts an active pull and does not refresh", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  pull(node, 350);
  expect(send(node, "touchstart", [touch(0, 350), touch(2, 350, 2)]).defaultPrevented).toBe(false);
  send(node, "touchend", [], [touch(0, 350)]);
  expect(onRefresh).not.toHaveBeenCalled();
});

test("nested scrolled targets and modal targets never capture", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const nested = view.getByTestId("nested");
  Object.defineProperties(nested, { scrollHeight: { value: 400 }, clientHeight: { value: 100 } });
  nested.style.overflowY = "auto";
  nested.scrollTop = 25;
  expect(pull(view.getByTestId("nested-target"), 350).defaultPrevented).toBe(false);
  expect(pull(view.getByTestId("modal-target"), 350).defaultPrevented).toBe(false);
  expect(pull(view.getByTestId("ignored"), 350).defaultPrevented).toBe(false);
  expect(pull(view.getByTestId("input"), 350).defaultPrevented).toBe(false);
  expect(onRefresh).not.toHaveBeenCalled();
});

test("external refresh ignores pulls and finishes at idle", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} refreshing />);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("refreshing");
  expect(pull(view.getByTestId("target"), 350).defaultPrevented).toBe(false);
  view.rerender(<Fixture onRefresh={onRefresh} />);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("settling");
  finish(view.getByTestId("content"));
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("idle");
  expect(onRefresh).not.toHaveBeenCalled();
});

test("preventDefault only follows downward axis lock; upward and short moves remain native", () => {
  const view = render(<Fixture onRefresh={() => {}} />);
  const node = view.getByTestId("target");
  send(node, "touchstart", [touch(0, 0)]);
  expect(send(node, "touchmove", [touch(0, 6)]).defaultPrevented).toBe(false);
  expect(send(node, "touchmove", [touch(0, 15)]).defaultPrevented).toBe(true);
  send(node, "touchend", [], [touch(0, 15)]);
  finish(view.getByTestId("content"));
  send(node, "touchstart", [touch(0, 0)]);
  expect(send(node, "touchmove", [touch(0, -30)]).defaultPrevented).toBe(false);
});

test("armed pull disarms when the finger retreats below threshold", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  pull(node, 350);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("armed");
  send(node, "touchmove", [touch(0, 40)]);
  expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("pulling");
  send(node, "touchend", [], [touch(0, 40)]);
  expect(onRefresh).not.toHaveBeenCalled();
});

test("scroll movement during a pull abandons capture", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  pull(node, 350);
  (view.container.firstElementChild as HTMLElement).scrollTop = 10;
  expect(send(node, "touchmove", [touch(0, 400)]).defaultPrevented).toBe(false);
  send(node, "touchend", [], [touch(0, 400)]);
  expect(onRefresh).not.toHaveBeenCalled();
});

test("disabling resets; unmount removes owner listeners", () => {
  const onRefresh = mock(() => {});
  const view = render(<Fixture onRefresh={onRefresh} />);
  const node = view.getByTestId("target");
  const owner = view.container.firstElementChild as HTMLElement;
  const remove = mock(owner.removeEventListener.bind(owner));
  owner.removeEventListener = remove;
  pull(node, 350);
  view.rerender(<Fixture onRefresh={onRefresh} enabled={false} />);
  expect(owner.getAttribute("data-phase")).toBe("idle");
  expect(pull(node, 350).defaultPrevented).toBe(false);
  view.unmount();
  expect(remove.mock.calls.filter(([name]) => String(name).startsWith("touch")).length).toBeGreaterThanOrEqual(4);
  expect(pull(node, 350).defaultPrevented).toBe(false);
  expect(onRefresh).not.toHaveBeenCalled();
});
