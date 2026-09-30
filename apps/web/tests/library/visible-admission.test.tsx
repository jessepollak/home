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

function story(id: string, frame: SheetStory["frame"] = "Play function"): SheetStory {
  return { id, name: id, Story: () => <p>Document {id}</p>, portals: true, frame,
    argTypes: {}, initialArgs: {}, layout: "centered", themePinned: false };
}
function sheet(stories = [story("frame")], focused: string | null = null, root: HTMLElement | null = null) {
  const props = { root, component: "Fixture", changed: false, stories, theme: "light", focused,
    focusedArgs: null, annotating: false, frameSource: "blank" as const,
    onToggle: () => {}, onActivate: () => {}, onEscape: () => {}, onExitAnnotate: () => {} };
  const view = render(<VariantSheet {...props} />, root ? { container: root } : undefined);
  return { ...view, update: (patch: Partial<Parameters<typeof VariantSheet>[0]>) => {
    Object.assign(props, patch);
    view.rerender(<VariantSheet {...props} />);
  } };
}

test("offscreen placeholders reserve height without admission or a deadline; visible frames stay mounted", () => {
  const view = sheet();
  const observer = Intersection.instances[0];
  const placeholder = view.getByRole("status");
  expect(placeholder.getBoundingClientRect().height || Number.parseFloat(placeholder.style.height)).toBe(844);
  observer.emit(0, 0);
  observer.emit(0.49, 200);
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(deadlines.size).toBe(0);
  observer.emit(0.5, 200);
  const frame = view.getByTitle("Fixture · frame");
  expect(deadlines.size).toBe(1);
  expect(observer.disconnected).toBe(true);
  observer.emit(0, 0);
  expect(view.getByTitle("Fixture · frame")).toBe(frame);
  expect(deadlines.size).toBe(1);
  act(() => [...deadlines.values()][0]());
  expect(view.getByRole("alert").textContent).toBe("Story did not finish rendering in 20 s");
  expect(deadlines.size).toBe(0);
});

test("tall frames admit at half the viewport height even below half the frame", () => {
  const rect = spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 2000 } as DOMRect);
  try {
    const view = sheet();
    const observer = Intersection.instances[0];
    expect(observer.options?.threshold).toContain(window.innerHeight / 4000);
    observer.emit(0.2, window.innerHeight / 2 - 1);
    expect(view.container.querySelector("iframe")).toBeNull();
    observer.emit(0.2, window.innerHeight / 2);
    expect(view.getByTitle("Fixture · frame")).toBeTruthy();
    expect(deadlines.size).toBe(1);
    expect(observer.disconnected).toBe(true);
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
  Intersection.instances[0].emit(0.5, 300);
  const waiting = Intersection.instances[1];
  expect(waiting.disconnected).toBe(false);
  expect(deadlines.size).toBe(1);
  view.unmount();
  expect(Intersection.instances.every((observer) => observer.disconnected)).toBe(true);
  expect(deadlines.size).toBe(0);
});

test("offscreen stories do not consume the three loading slots", () => {
  const view = sheet([story("offscreen"), ...[1, 2, 3, 4].map((id) => story(String(id)))]);
  for (const observer of Intersection.instances.slice(1)) observer.emit(0.5, 300);
  expect(view.container.querySelectorAll("iframe")).toHaveLength(3);
  expect(view.queryByTitle("Fixture · offscreen")).toBeNull();
  expect(view.queryByTitle("Fixture · 4")).toBeNull();
  expect(deadlines.size).toBe(3);
  act(() => [...deadlines.values()][0]());
  expect(view.getByTitle("Fixture · 4")).toBeTruthy();
  expect(deadlines.size).toBe(3);
});

test("restored focus scrolls once, then awaits normal visibility admission; later selection does not scroll", () => {
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
    Intersection.instances[1].emit(0.5, 300);
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
