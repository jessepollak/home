import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { nextScrollOwner, scopedSavedScroll, useShellDocumentScrollRestoration } from "./use-shell-document-scroll-restoration";

const scrollKey = "__homeShellScrollY";
const ownerKey = "__homeShellScrollOwner";

describe("shell scroll restoration owner scope", () => {
  test("restores only a saved scroll owned by the current verified owner", () => {
    const saved = { [scrollKey]: 420, [ownerKey]: "A" };
    expect(scopedSavedScroll(saved, "A")?.y).toBe(420);
    expect(scopedSavedScroll(saved, "B")).toBeNull();
    expect(scopedSavedScroll(saved, null)).toBeNull();
    expect(scopedSavedScroll({ [scrollKey]: 420 }, "A")).toBeNull();
    expect(scopedSavedScroll({ [scrollKey]: 420, [ownerKey]: null }, null)).toBeNull();
    expect(scopedSavedScroll(null, "A")).toBeNull();
    expect(scopedSavedScroll({ [scrollKey]: -1, [ownerKey]: "A" }, "A")).toBeNull();
  });

  test("keeps the last verified owner and preserves a first verification owned by that owner", () => {
    expect(nextScrollOwner(null, "A", "A")).toEqual({ owner: "A", reset: false, clear: false });
    expect(nextScrollOwner(null, "A", null)).toEqual({ owner: "A", reset: false, clear: true });
    expect(nextScrollOwner("A", null, "A")).toEqual({ owner: "A", reset: false, clear: false });
    expect(nextScrollOwner("A", "A", "A")).toEqual({ owner: "A", reset: false, clear: false });
    expect(nextScrollOwner("A", "B", "A")).toEqual({ owner: "B", reset: true, clear: true });
    expect(nextScrollOwner(null, null, null)).toEqual({ owner: null, reset: false, clear: false });
  });
});

describe("shell pending scroll lifecycle", () => {
  let now = 0;
  let nextId = 0;
  let maximum = 300;
  const timers = new Map<number, { callback: () => void; at: number }>();
  const frames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    now = 0;
    nextId = 0;
    maximum = 300;
    timers.clear();
    frames.clear();
    window.history.replaceState(null, "", "/home");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    spyOn(performance, "now").mockImplementation(() => now);
    const scheduleTimer = (callback: TimerHandler, delay?: number) => {
      if (typeof callback !== "function") throw new Error("Expected timer callback");
      const id = ++nextId;
      timers.set(id, { callback: () => callback(), at: now + Number(delay ?? 0) });
      return id;
    };
    const browserTimers: Pick<Window, "setTimeout"> = globalThis;
    spyOn(browserTimers, "setTimeout").mockImplementation(scheduleTimer);
    spyOn(globalThis, "clearTimeout").mockImplementation((id) => { timers.delete(Number(id)); });
    spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    });
    spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    spyOn(window, "scrollTo").mockImplementation((x?: number | ScrollToOptions, y?: number) => {
      const target = typeof x === "number" ? y ?? 0 : x?.top ?? 0;
      Object.defineProperty(window, "scrollY", { configurable: true, value: Math.min(maximum, target) });
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  function mount(pathname = "/home") {
    const initialProps: { path: string; owner: string | null } = { path: pathname, owner: "A" };
    return renderHook(({ path, owner }: { path: string; owner: string | null }) => useShellDocumentScrollRestoration(path, owner),
      { initialProps });
  }

  function pop(path = "/home", y = 5_000) {
    const state = { [scrollKey]: y, [ownerKey]: "A" };
    window.history.replaceState(state, "", path);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate", { state })); });
  }

  function flushFrames() {
    for (let pass = 0; pass < 2; pass++) {
      const queued = [...frames];
      frames.clear();
      act(() => { queued.forEach(([, callback]) => callback(now)); });
    }
  }

  function pendingTimeout() {
    const timer = timers.values().next().value;
    if (!timer) throw new Error("Expected pending restore timeout");
    return timer.callback;
  }

  function advance(ms: number) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      timers.delete(id);
      act(timer.callback);
    }
  }

  function persistAt(y: number) {
    window.scrollTo(0, y);
    window.dispatchEvent(new Event("scrollend"));
  }

  test("successful restore releases persistence and cancels its deadline", () => {
    mount();
    pop("/home", 200);
    flushFrames();
    expect(timers.size).toBe(0);
    persistAt(100);
    expect(window.history.state[scrollKey]).toBe(100);
  });

  test("short or unavailable content expires without mutation and persists its bounded position", () => {
    mount();
    pop();
    flushFrames();
    persistAt(100);
    expect(window.history.state[scrollKey]).toBe(5_000);
    advance(4_999);
    expect(window.history.state[scrollKey]).toBe(5_000);
    advance(1);
    expect(window.history.state[scrollKey]).toBe(100);
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(0);
  });

  test("pop followed by the matching React pathname retains the legitimate pending restore", () => {
    const hook = mount();
    pop("/activity");
    flushFrames();
    hook.rerender({ path: "/activity", owner: "A" });
    persistAt(100);
    expect(window.history.state[scrollKey]).toBe(5_000);
    expect(timers.size).toBe(1);
    maximum = 6_000;
    flushFrames();
    expect(window.scrollY).toBe(5_000);
    expect(timers.size).toBe(0);
  });

  test("pathname departure clears pending work promptly and isolates a late timeout", () => {
    const hook = mount();
    pop();
    const lateTimeout = pendingTimeout();
    window.history.replaceState({ keep: true }, "", "/activity");
    hook.rerender({ path: "/activity", owner: "A" });
    expect(timers.size).toBe(0);
    expect(frames.size).toBe(0);
    persistAt(100);
    expect(window.history.state[scrollKey]).toBe(100);
    window.scrollTo(0, 200);
    lateTimeout();
    expect(window.history.state[scrollKey]).toBe(100);
    expect(window.history.state.keep).toBe(true);
  });

  test("browser path departure cancels a queued retry before React catches up", () => {
    mount();
    pop();
    window.history.replaceState({ keep: true }, "", "/activity");
    flushFrames();
    expect(timers.size).toBe(0);
    persistAt(100);
    expect(window.history.state[scrollKey]).toBe(100);
  });

  test("replacement pop keeps its own deadline despite a late callback from the first restore", () => {
    mount();
    pop();
    const lateTimeout = pendingTimeout();
    advance(1_000);
    pop("/home", 6_000);
    expect(timers.size).toBe(1);
    lateTimeout();
    persistAt(100);
    expect(window.history.state[scrollKey]).toBe(6_000);
    advance(4_999);
    expect(window.history.state[scrollKey]).toBe(6_000);
    advance(1);
    expect(window.history.state[scrollKey]).toBe(100);
  });

  test("owner switch cancels pending frames and deadline without letting a late timer write", () => {
    const hook = mount();
    pop();
    const lateTimeout = pendingTimeout();
    hook.rerender({ path: "/home", owner: "B" });
    expect(window.scrollY).toBe(0);
    expect(timers.size).toBe(0);
    expect(frames.size).toBe(0);
    persistAt(100);
    lateTimeout();
    expect(window.history.state[ownerKey]).toBe("B");
    expect(window.history.state[scrollKey]).toBe(100);
  });

  test.each(["wheel", "touchstart", "pointerdown", "keydown"])("user %s cancels pending work", (event) => {
    mount();
    pop();
    const lateTimeout = pendingTimeout();
    if (event === "keydown") document.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    else window.dispatchEvent(new Event(event));
    expect(timers.size).toBe(0);
    expect(frames.size).toBe(0);
    persistAt(100);
    lateTimeout();
    expect(window.history.state[scrollKey]).toBe(100);
  });

  test("unmount cancels all pending work and removes persistence listeners", () => {
    const previous = window.history.scrollRestoration;
    const hook = mount();
    pop();
    const lateTimeout = pendingTimeout();
    hook.unmount();
    expect(timers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(window.history.scrollRestoration).toBe(previous);
    persistAt(100);
    lateTimeout();
    expect(window.history.state[scrollKey]).toBe(5_000);
  });
});
