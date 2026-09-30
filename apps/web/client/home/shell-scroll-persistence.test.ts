import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { backClientHistory, commitClientUrl } from "@/config/shell-location";
import { subscribeShellScrollPersistence } from "./shell-scroll-persistence";

let scroller: HTMLElement;
let unsubscribe: (() => void) | null;
let writes: { kind: "replace" | "push"; url: string; priorScrollTop: number | undefined; scrollTop: number | undefined }[];
let restoreHistory: () => void;

beforeEach(() => {
  window.history.replaceState(null, "", "/activity");
  jest.useFakeTimers();
  scroller = document.createElement("main");
  unsubscribe = null;
  writes = [];
  const replaceState = window.history.replaceState;
  const pushState = window.history.pushState;
  Object.defineProperty(window.history, "replaceState", {
    configurable: true,
    value: (state: Record<string, unknown>, unused: string, url?: string | URL | null) => {
      writes.push({ kind: "replace", url: String(url ?? ""), priorScrollTop: window.history.state?.__homeShellScrollTop, scrollTop: state?.__homeShellScrollTop as number | undefined });
      replaceState.call(window.history, state, unused, url);
    },
  });
  Object.defineProperty(window.history, "pushState", {
    configurable: true,
    value: (state: Record<string, unknown>, unused: string, url?: string | URL | null) => {
      writes.push({ kind: "push", url: String(url ?? ""), priorScrollTop: window.history.state?.__homeShellScrollTop, scrollTop: state?.__homeShellScrollTop as number | undefined });
      pushState.call(window.history, state, unused, url);
    },
  });
  restoreHistory = () => {
    Object.defineProperty(window.history, "replaceState", { configurable: true, value: replaceState });
    Object.defineProperty(window.history, "pushState", { configurable: true, value: pushState });
  };
});

afterEach(() => {
  unsubscribe?.();
  restoreHistory();
  jest.useRealTimers();
});

function subscribe(supportsScrollEnd: boolean) {
  if (supportsScrollEnd) Object.defineProperty(scroller, "onscrollend", { configurable: true, value: null });
  unsubscribe = subscribeShellScrollPersistence(scroller);
}

function scrollTo(top: number) {
  scroller.scrollTop = top;
  scroller.dispatchEvent(new Event("scroll"));
}

function cleanup() {
  unsubscribe?.();
  unsubscribe = null;
}

describe("shell scroll persistence", () => {
  test("the first scroll writes immediately and the next quiet-window scroll writes immediately", () => {
    subscribe(true);
    scrollTo(71);
    expect(writes.map((write) => write.scrollTop)).toEqual([71]);
    jest.advanceTimersByTime(250);
    scrollTo(90);
    expect(writes.map((write) => write.scrollTop)).toEqual([71, 90]);
  });

  test("native scrollend keeps 200 frames of scrolling within the throttled write budget", () => {
    subscribe(true);
    for (let index = 1; index <= 200; index++) {
      scrollTo(index * 3);
      jest.advanceTimersByTime(17);
    }
    expect(writes.length).toBeGreaterThan(1);
    scroller.dispatchEvent(new Event("scrollend"));
    expect(writes.length).toBeLessThanOrEqual(Math.ceil(200 * 17 / 250) + 1);
    expect(writes.at(-1)?.scrollTop).toBe(600);
    const writeCount = writes.length;
    cleanup();
    expect(writes).toHaveLength(writeCount);
  });

  test("fallback scroll throttling writes the final value without scrollend", () => {
    subscribe(false);
    for (let index = 1; index <= 200; index++) {
      scrollTo(index);
      jest.advanceTimersByTime(17);
    }
    jest.advanceTimersByTime(250);
    expect(writes.length).toBeLessThanOrEqual(Math.ceil(200 * 17 / 250) + 1);
    expect(writes.at(-1)?.scrollTop).toBe(200);
    const writeCount = writes.length;
    jest.advanceTimersByTime(250);
    expect(writes).toHaveLength(writeCount);
  });

  test("each dirty window writes the latest value and keeps the next window throttled", () => {
    subscribe(false);
    scrollTo(10);
    scrollTo(20);
    jest.advanceTimersByTime(249);
    expect(writes.map((write) => write.scrollTop)).toEqual([10]);
    jest.advanceTimersByTime(1);
    expect(writes.map((write) => write.scrollTop)).toEqual([10, 20]);
    scrollTo(30);
    expect(writes).toHaveLength(2);
    jest.advanceTimersByTime(250);
    expect(writes.map((write) => write.scrollTop)).toEqual([10, 20, 30]);
  });

  test("a URL push persists the prior entry synchronously and cancels a pending timer", () => {
    subscribe(false);
    scrollTo(375);
    scrollTo(400);
    commitClientUrl("/home", "push");
    expect(writes).toEqual([
      { kind: "replace", url: "", priorScrollTop: undefined, scrollTop: 375 },
      { kind: "replace", url: "", priorScrollTop: 375, scrollTop: 400 },
      { kind: "push", url: "/home", priorScrollTop: 400, scrollTop: 0 },
    ]);
    jest.advanceTimersByTime(500);
    expect(writes).toHaveLength(3);
  });

  test("in-app Back persists an unsettled scroll before invoking history.back", () => {
    subscribe(false);
    scrollTo(375);
    scrollTo(400);
    const back = window.history.back;
    const stateAtBack: number[] = [];
    Object.defineProperty(window.history, "back", {
      configurable: true,
      value: () => { stateAtBack.push(window.history.state?.__homeShellScrollTop); },
    });
    try {
      backClientHistory();
      expect(writes.map((write) => write.scrollTop)).toEqual([375, 400]);
      expect(stateAtBack).toEqual([400]);
      jest.advanceTimersByTime(500);
      expect(writes).toHaveLength(2);
    } finally {
      Object.defineProperty(window.history, "back", { configurable: true, value: back });
    }
  });

  test("pagehide and hidden visibility persist, while visible visibility does not", () => {
    subscribe(false);
    scroller.scrollTop = 48;
    window.dispatchEvent(new Event("pagehide"));
    expect(writes.map((write) => write.scrollTop)).toEqual([48]);
    scroller.scrollTop = 90;
    const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(writes).toHaveLength(1);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(writes.map((write) => write.scrollTop)).toEqual([48, 90]);
    } finally {
      if (original) Object.defineProperty(document, "visibilityState", original);
      else Reflect.deleteProperty(document, "visibilityState");
    }
  });

  test("popstate preserves the first-scroll outgoing value and drops dirty trailing writes", () => {
    subscribe(false);
    scrollTo(71);
    expect(window.history.state?.__homeShellScrollTop).toBe(71);
    scrollTo(90);
    window.history.replaceState({ __homeShellScrollTop: 12 }, "", "/home");
    writes = [];
    window.dispatchEvent(new Event("popstate"));
    jest.advanceTimersByTime(500);
    expect(writes).toHaveLength(0);
    expect(window.history.state?.__homeShellScrollTop).toBe(12);
    scroller.scrollTop = 12;
    scrollTo(22);
    expect(writes.map((write) => write.scrollTop)).toEqual([22]);
  });

  test("cleanup persists once, cancels the timer, and removes every listener", () => {
    subscribe(false);
    scrollTo(52);
    scrollTo(73);
    cleanup();
    expect(writes.map((write) => write.scrollTop)).toEqual([52, 73]);
    jest.advanceTimersByTime(500);
    scrollTo(100);
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("popstate"));
    expect(writes).toHaveLength(2);
    commitClientUrl("/home", "push");
    expect(writes.map((write) => write.kind)).toEqual(["replace", "replace", "push"]);
  });

  test("duplicate entry values skip history writes on every persist trigger", () => {
    window.history.replaceState({ __homeShellScrollTop: 29 }, "", "/activity");
    writes = [];
    subscribe(true);
    scrollTo(29);
    scrollTo(29);
    jest.advanceTimersByTime(250);
    scroller.dispatchEvent(new Event("scrollend"));
    window.dispatchEvent(new Event("pagehide"));
    cleanup();
    expect(writes).toHaveLength(0);
  });
});
