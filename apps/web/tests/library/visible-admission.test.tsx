import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { SheetStory } from "@/stories/review/explorations/library/stories";

const { act, cleanup, render } = await import("@testing-library/react");
const { VariantSheet } = await import("@/stories/review/explorations/library/sheet");
const originalIntersection = globalThis.IntersectionObserver;
const originalTimeout = globalThis.setTimeout;
const originalClear = globalThis.clearTimeout;
const deadlines = new Map<number, () => void>();
let next = 0;

class Intersection {
  static instances: Intersection[] = [];
  target: Element | null = null;
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    Intersection.instances.push(this);
  }
  observe(target: Element) { this.target = target; }
  disconnect() { this.disconnected = true; }
  emit(ratio: number, height: number) {
    act(() => this.callback([{
      target: this.target!, isIntersecting: height > 0, intersectionRatio: ratio,
      intersectionRect: { height },
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
  }
}

beforeEach(() => {
  Intersection.instances = [];
  deadlines.clear();
  globalThis.IntersectionObserver = Intersection as unknown as typeof IntersectionObserver;
  globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 20_000) return originalTimeout(callback, delay, ...args);
    const id = ++next;
    deadlines.set(id, callback);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    if (!deadlines.delete(Number(timer))) originalClear(timer);
  }) as typeof clearTimeout;
});
afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = originalIntersection;
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClear;
});

function story(id: string, frame: SheetStory["frame"] = "Library override"): SheetStory {
  return { id, name: id, Story: () => <p>Document {id}</p>, portals: true, frame,
    argTypes: {}, initialArgs: {}, layout: "centered", themePinned: false };
}
function sheet(stories = [story("frame")], focused: string | null = null, root: HTMLElement | null = null) {
  const props = { root, component: "Fixture", changed: false, stories, theme: "light", focused,
    focusedArgs: null, annotating: false, frameSource: "blank" as const,
    onToggle: () => {}, onEscape: () => {}, onExitAnnotate: () => {} };
  const view = render(<VariantSheet {...props} />, root ? { container: root } : undefined);
  return { ...view, update: (patch: Partial<Parameters<typeof VariantSheet>[0]>) => {
    Object.assign(props, patch);
    view.rerender(<VariantSheet {...props} />);
  } };
}
function observers(index = 0) {
  return { nearby: Intersection.instances[index * 2], visible: Intersection.instances[index * 2 + 1] };
}
function show(index = 0) {
  const { nearby, visible } = observers(index);
  visible.emit(0.5, 300);
  nearby.emit(0.5, 300);
}

test("one-screen-ahead admission mounts offscreen frames without starting their deadline", () => {
  const root = document.createElement("div");
  document.body.append(root);
  try {
    const view = sheet(undefined, null, root);
    const { nearby, visible } = observers();
    expect(nearby.options).toEqual({ root, rootMargin: `${window.innerHeight}px 0px`, threshold: 0 });
    const placeholder = view.getByRole("status");
    expect(Number.parseFloat(placeholder.style.height)).toBe(844);
    nearby.emit(0, 0);
    expect(view.container.querySelector("iframe")).toBeNull();
    nearby.emit(0.01, 1);
    const frame = view.getByTitle("Fixture · frame");
    expect(nearby.disconnected).toBe(true);
    expect(deadlines.size).toBe(0);
    visible.emit(0.49, 200);
    expect(deadlines.size).toBe(0);
    visible.emit(0.5, 200);
    expect(deadlines.size).toBe(1);
    expect(visible.disconnected).toBe(true);
    visible.emit(0, 0);
    expect(view.getByTitle("Fixture · frame")).toBe(frame);
    expect(deadlines.size).toBe(1);
    act(() => [...deadlines.values()][0]());
    expect(view.getByRole("alert").textContent).toBe("Story did not finish rendering in 20 s");
    expect(deadlines.size).toBe(0);
  } finally { root.remove(); }
});

test("the preload margin follows scrolling viewport height rather than its width, including resize", () => {
  const root = document.createElement("div");
  let height = 760;
  Object.defineProperty(root, "clientHeight", { get: () => height });
  Object.defineProperty(root, "clientWidth", { value: 390 });
  document.body.append(root);
  try {
    sheet(undefined, null, root);
    const nearby = observers().nearby;
    expect(nearby.options?.rootMargin).toBe("760px 0px");
    height = 640;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(nearby.disconnected).toBe(true);
    expect(Intersection.instances.filter((observer) => observer.options?.rootMargin).at(-1)?.options?.rootMargin).toBe("640px 0px");
    expect(deadlines.size).toBe(0);
  } finally { root.remove(); }
});

test("a frame already visible starts its deadline at mount", () => {
  const view = sheet();
  observers().visible.emit(0.5, 300);
  expect(deadlines.size).toBe(0);
  observers().nearby.emit(0.5, 300);
  expect(view.getByTitle("Fixture · frame")).toBeTruthy();
  expect(deadlines.size).toBe(1);
});

test("tall frames start their deadline at half the viewport height below half the frame", () => {
  const rect = spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 2000 } as DOMRect);
  try {
    const view = sheet();
    const { nearby, visible } = observers();
    expect(visible.options?.threshold).toContain(window.innerHeight / 4000);
    nearby.emit(0.2, 100);
    expect(view.getByTitle("Fixture · frame")).toBeTruthy();
    visible.emit(0.2, window.innerHeight / 2 - 1);
    expect(deadlines.size).toBe(0);
    visible.emit(0.2, window.innerHeight / 2);
    expect(deadlines.size).toBe(1);
  } finally { rect.mockRestore(); }
});

test("without IntersectionObserver, admission and the mount deadline start immediately", () => {
  globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
  const view = sheet();
  expect(view.getByTitle("Fixture · frame")).toBeTruthy();
  expect(deadlines.size).toBe(1);
  expect(Intersection.instances).toHaveLength(0);
});

test("unmount disconnects offscreen observers and cancels admitted deadlines", () => {
  const view = sheet([story("visible"), story("offscreen")]);
  show();
  expect(observers(1).nearby.disconnected).toBe(false);
  expect(deadlines.size).toBe(1);
  view.unmount();
  expect(Intersection.instances.every((observer) => observer.disconnected)).toBe(true);
  expect(deadlines.size).toBe(0);
});

test("the Library keeps three loading slots, excluding sections outside the preload margin", () => {
  const view = sheet([story("offscreen"), ...[1, 2, 3, 4].map((id) => story(String(id)))]);
  for (let index = 1; index <= 4; index++) show(index);
  expect(view.container.querySelectorAll("iframe")).toHaveLength(3);
  expect(view.queryByTitle("Fixture · offscreen")).toBeNull();
  expect(view.queryByTitle("Fixture · 4")).toBeNull();
  expect(deadlines.size).toBe(3);
  act(() => [...deadlines.values()][0]());
  expect(view.getByTitle("Fixture · 4")).toBeTruthy();
  expect(deadlines.size).toBe(3);
});

test("restored focus scrolls once, then awaits admission; later selection does not scroll", () => {
  const scroll = spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  const root = document.createElement("div");
  document.body.append(root);
  try {
    const view = sheet([story("first"), story("restored")], "restored", root);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(view.container.querySelector('[data-library-section="restored"]'));
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(deadlines.size).toBe(0);
    show(1);
    expect(view.getByTitle("Fixture · restored")).toBeTruthy();
    view.update({ focused: "first" });
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally { scroll.mockRestore(); root.remove(); }
});

test("in-document stories render offscreen without observers or deadlines", () => {
  const view = sheet([story("plain", null)]);
  expect(view.getByText("Document plain")).toBeTruthy();
  expect(Intersection.instances).toHaveLength(0);
  expect(deadlines.size).toBe(0);
});
