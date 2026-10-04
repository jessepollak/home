import { isolateFrameDocuments, requireValue, requireInstance } from "./fixtures/runtime";
import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, test } from "bun:test";
import { useLayoutEffect } from "react";
import type { SheetStory } from "@/stories/review/explorations/library/stories";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { VariantSheet } = await import("@/stories/review/explorations/library/sheet");

const originalResize = globalThis.ResizeObserver;
const originalIntersection = globalThis.IntersectionObserver;
const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const callbacks = new Map<number, FrameRequestCallback>();
let restoreFrameDocuments: () => void;
let next = 0;
let width = 390;
class Resize implements ResizeObserver {
  unobserve(target: Element) { this.targets.delete(target); }
  static all: Resize[] = [];
  targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { Resize.all.push(this); }
  observe(target: Element) { this.targets.add(target); }
  disconnect() { this.targets.clear(); }
}
class Intersection implements IntersectionObserver {
  root = null;
  rootMargin = "0px";
  thresholds = [0];
  takeRecords() { return []; }
  unobserve() {}
  observe() {}
  disconnect() {}
}
beforeEach(() => {
  restoreFrameDocuments = isolateFrameDocuments();
  Resize.all = [];
  callbacks.clear();
  width = 390;
  globalThis.ResizeObserver = Resize;
  globalThis.IntersectionObserver = Intersection;
  globalThis.requestAnimationFrame = (callback) => { callbacks.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => { callbacks.delete(id); };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
});
afterEach(() => {
  restoreFrameDocuments();
  cleanup();
  globalThis.ResizeObserver = originalResize;
  globalThis.IntersectionObserver = originalIntersection;
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
  if (originalWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
});
const tick = () => act(() => {
  for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); }
});
const resize = () => act(() => {
  for (const observer of [...Resize.all]) observer.callback([], observer);
});
function story(id: string, viewport?: { width: number; height: number }): SheetStory {
  return { id, name: id, Story: () => null, frame: "Library override", portals: false, layout: "centered",
    argTypes: {}, initialArgs: {}, themePinned: false, viewport };
}
const defaults = { root: null, component: "Fixture", changed: false, theme: "light", focused: null,
  focusedArgs: null, annotating: false, frameSource: "story" as const,
  onToggle: () => {}, onEscape: () => {}, onExitAnnotate: () => {} };

for (const interrupt of [false, true]) {
  test(`restored focus waits for committed preceding widths and ${interrupt ? "stops on user input" : "corrects at most once"}`, () => {
    width = 800;
    const entries = [story("desktop", { width: 1440, height: 900 }), story("target")];
    const root = document.createElement("div");
    document.body.append(root);
    let calls = 0;
    let additionalOffset = 0;
    let committedHeight = 0;
    const Target = () => {
      useLayoutEffect(() => {
        const section = requireValue(root.querySelector<HTMLElement>('[data-library-section="target"]'));
        const offset = () => {
          const placeholder = requireValue(root.querySelector<HTMLElement>('[role="status"]'));
          committedHeight = Number.parseFloat(placeholder.style.height);
          return 50 + committedHeight + additionalOffset;
        };
        section.getBoundingClientRect = () => new DOMRect(0, offset() - root.scrollTop);
        section.scrollIntoView = () => { calls++; root.scrollTop = offset() - 24; };
      }, []);
      return null;
    };
    const view = render(<VariantSheet {...defaults} root={root} focused="target"
      stories={[entries[0], { ...entries[1], frame: null, Story: Target }]} />, { container: root });
    expect(calls).toBe(0);
    tick();
    expect(calls).toBe(1);
    expect(committedHeight).toBe(500);
    expect(requireValue(root.querySelector<HTMLElement>('[data-library-section="target"]')).getBoundingClientRect().top).toBe(24);
    additionalOffset = 80;
    if (interrupt) fireEvent.wheel(root);
    tick();
    expect(calls).toBe(interrupt ? 1 : 2);
    if (!interrupt) expect(requireValue(root.querySelector<HTMLElement>('[data-library-section="target"]')).getBoundingClientRect().top).toBe(24);
    fireEvent.wheel(root);
    root.scrollTop = 10;
    width = 640;
    resize();
    tick();
    tick();
    expect(calls).toBe(interrupt ? 1 : 2);
    expect(root.scrollTop).toBe(10);
    view.unmount();
    expect(callbacks.size).toBe(0);
    root.remove();
  });
}

test("width changes refit rendered content without replacing the iframe or looping on stable sizes", () => {
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
  const view = render(<VariantSheet {...defaults} stories={[story("wrap")]} />);
  const frame = requireInstance(view.getByTitle("Fixture · wrap"), HTMLIFrameElement);
  const src = frame.src;
  let measurements = 0;
  const content = requireValue(frame.contentDocument).createElement("div");
  content.id = "storybook-root";
  Object.defineProperty(content, "scrollHeight", { get: () => { measurements++; return Number(frame.width) < 350 ? 400 : 100; } });
  requireValue(frame.contentDocument).body.append(content);
  Object.defineProperty(frame, "contentWindow", { configurable: true, value: {
    __STORYBOOK_PREVIEW__: { currentRender: { id: "wrap", story: { id: "wrap" }, phase: "finished" } },
  } });
  fireEvent.load(frame);
  tick();
  expect(frame.height).toBe("160");
  width = 320;
  resize();
  expect(frame.width).toBe("320");
  expect(frame.height).toBe("448");
  expect(view.getByTitle("Fixture · wrap")).toBe(frame);
  expect(frame.src).toBe(src);
  const fittedMeasurements = measurements;
  for (let turn = 0; turn < 5; turn++) { resize(); tick(); }
  expect(measurements).toBe(fittedMeasurements);
  expect(frame.height).toBe("448");
  width = 390;
  resize();
  expect(frame.height).toBe("160");
  view.unmount();
  expect(callbacks.size).toBe(0);
});
