import "@/client/account/dom-test-harness";
import { createElement, useEffect } from "react";
const { act, render } = await import("@testing-library/react");
import { describe, expect, test } from "bun:test";
import { shellViewportBottomInset, useShellKeyboardOpen, useShellViewportGeometry, visualViewportKeyboardFrame, visualViewportKeyboardInset } from "./visual-viewport";

describe("visualViewportKeyboardInset", () => {
  test("returns zero when the viewport is not occluded", () => {
    expect(visualViewportKeyboardInset(800, { height: 800, offsetTop: 0, scale: 1 })).toBe(0);
  });

  test("returns the keyboard inset when the viewport shrinks", () => {
    expect(visualViewportKeyboardInset(800, { height: 500, offsetTop: 0, scale: 1 })).toBe(300);
  });

  test("ignores a shrink of 60 pixels or less", () => {
    expect(visualViewportKeyboardInset(800, { height: 740, offsetTop: 0, scale: 1 })).toBe(0);
  });

  test("ignores zoomed viewports", () => {
    expect(visualViewportKeyboardInset(800, { height: 500, offsetTop: 0, scale: 1.2 })).toBe(0);
  });

  test("accounts for visual viewport offset from the top", () => {
    expect(visualViewportKeyboardInset(800, { height: 500, offsetTop: 100, scale: 1 })).toBe(200);
  });
});

describe("shell viewport geometry", () => {
  test("ignores unfocused toolbar mismatches but includes focused accessory rows and panning without zoom compensation", () => {
    expect(shellViewportBottomInset(800, { height: 730, offsetTop: 0, scale: 1 })).toBe(0);
    expect(shellViewportBottomInset(800, { height: 760, offsetTop: 0, scale: 1 }, true)).toBe(40);
    expect(shellViewportBottomInset(800, { height: 500.5, offsetTop: 100, scale: 1 }, true)).toBe(199.5);
    expect(shellViewportBottomInset(800, { height: 700, offsetTop: 120, scale: 1 }, true)).toBe(0);
    expect(shellViewportBottomInset(800, { height: 500, offsetTop: 0, scale: 1.01 }, true)).toBe(300);
    expect(shellViewportBottomInset(800, { height: 500, offsetTop: 0, scale: 1.02 }, true)).toBe(0);
    expect(shellViewportBottomInset(800, null, true)).toBe(0);
  });

  test("coalesces reads, writes only changes, shares subscriptions and cleans up the last reference", () => {
    const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    let reads = 0;
    let height = 760;
    let renders = 0;
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { get: () => { reads += 1; return height; } },
      offsetTop: { value: 0 }, scale: { value: 1 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    globalThis.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
    globalThis.cancelAnimationFrame = (frame) => { frames.delete(frame); };
    const flush = () => act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    });
    function Probe() {
      useShellViewportGeometry();
      const open = useShellKeyboardOpen();
      useEffect(() => { renders += 1; });
      return createElement("output", null, String(open));
    }
    const first = render(createElement(Probe));
    const second = render(createElement(Probe));
    const root = document.documentElement;
    const input = document.createElement("input");
    document.body.append(input);
    try {
      expect(frames.size).toBe(1);
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("orientationchange"));
      expect(reads).toBe(0);
      flush();
      expect(reads).toBe(1);
      expect(root.style.getPropertyValue("--shell-viewport-inset-bottom")).toBe("0px");
      const before = renders;
      const mutations: MutationRecord[] = [];
      const observer = new MutationObserver((records) => mutations.push(...records));
      observer.observe(root, { attributes: true });
      viewport.dispatchEvent(new Event("resize"));
      flush();
      expect(observer.takeRecords()).toHaveLength(0);
      observer.disconnect();
      expect(mutations).toHaveLength(0);
      expect(renders).toBe(before);
      input.focus();
      flush();
      expect(root.style.getPropertyValue("--shell-viewport-inset-bottom")).toBe("40px");
      expect(root.dataset.shellKeyboard).toBeUndefined();
      height = 500;
      viewport.dispatchEvent(new Event("resize"));
      flush();
      expect(root.dataset.shellKeyboard).toBe("open");
      expect(first.container.textContent).toBe("true");
      expect(second.container.textContent).toBe("true");
      const openRenders = renders;
      height = 510;
      viewport.dispatchEvent(new Event("scroll"));
      flush();
      expect(renders).toBe(openRenders);
      input.blur();
      flush();
      expect(root.style.getPropertyValue("--shell-viewport-inset-bottom")).toBe("0px");
      expect(root.dataset.shellKeyboard).toBeUndefined();
      input.focus();
      flush();
      expect(root.dataset.shellKeyboard).toBe("open");
      input.remove();
      expect(document.activeElement).toBe(document.body);
      expect(root.dataset.shellKeyboard).toBe("open");
      first.unmount();
      flush();
      expect(second.container.textContent).toBe("false");
      expect(root.dataset.shellKeyboard).toBeUndefined();
      height = 800;
      viewport.dispatchEvent(new Event("resize"));
      flush();
      expect(second.container.textContent).toBe("false");
      expect(root.dataset.shellKeyboard).toBeUndefined();
      viewport.dispatchEvent(new Event("resize"));
      expect(frames.size).toBe(1);
      second.unmount();
      expect(frames.size).toBe(0);
      expect(root.style.getPropertyValue("--shell-viewport-inset-bottom")).toBe("");
      viewport.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("orientationchange"));
      expect(frames.size).toBe(0);
    } finally {
      first.unmount();
      second.unmount();
      input.remove();
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
      if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
      else Reflect.deleteProperty(window, "visualViewport");
      if (originalHeight) Object.defineProperty(window, "innerHeight", originalHeight);
    }
  });
});

describe("visualViewportKeyboardFrame", () => {
  test("reports the visible top and bottom obstruction when the viewport is panned", () => {
    expect(visualViewportKeyboardFrame(800, { height: 500, offsetTop: 100, scale: 1 })).toEqual({ top: 100, inset: 200 });
  });

  test("keeps the top offset when panning consumes the bottom inset", () => {
    expect(visualViewportKeyboardFrame(800, { height: 500, offsetTop: 300, scale: 1 })).toEqual({ top: 300, inset: 0 });
  });

  test("reports no offset without a keyboard", () => {
    expect(visualViewportKeyboardFrame(800, { height: 800, offsetTop: 0, scale: 1 })).toEqual({ top: 0, inset: 0 });
    expect(visualViewportKeyboardFrame(800, { height: 500, offsetTop: 100, scale: 1.2 })).toEqual({ top: 0, inset: 0 });
  });
});
