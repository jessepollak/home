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
  test("native scrollend writes once after 200 frames of scrolling", () => {
    subscribe(true);
    for (let index = 1; index <= 200; index++) {
      scrollTo(index * 3);
      jest.advanceTimersByTime(17);
    }
    expect(writes).toHaveLength(0);
    scroller.dispatchEvent(new Event("scrollend"));
    expect(writes).toEqual([{ kind: "replace", url: "", priorScrollTop: undefined, scrollTop: 600 }]);
    cleanup();
    expect(writes).toHaveLength(1);
  });

  test("fallback scroll debounce waits for quiet then writes only the final value", () => {
    subscribe(false);
    for (let index = 1; index <= 200; index++) {
      scrollTo(index);
      jest.advanceTimersByTime(17);
    }
    expect(writes).toHaveLength(0);
    jest.advanceTimersByTime(132);
    expect(writes).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(writes.map((write) => write.scrollTop)).toEqual([200]);
  });

  test("a URL push persists the prior entry synchronously and cancels a pending timer", () => {
    subscribe(false);
    scrollTo(375);
    commitClientUrl("/home", "push");
    expect(writes).toEqual([
      { kind: "replace", url: "", priorScrollTop: undefined, scrollTop: 375 },
      { kind: "push", url: "/home", priorScrollTop: 375, scrollTop: 0 },
    ]);
    jest.advanceTimersByTime(150);
    expect(writes).toHaveLength(2);
  });

  test("in-app Back persists an unsettled scroll before invoking history.back", () => {
    subscribe(false);
    scrollTo(375);
    const back = window.history.back;
    const stateAtBack: number[] = [];
    Object.defineProperty(window.history, "back", {
      configurable: true,
      value: () => { stateAtBack.push(window.history.state?.__homeShellScrollTop); },
    });
    try {
      backClientHistory();
      expect(writes).toEqual([{ kind: "replace", url: "", priorScrollTop: undefined, scrollTop: 375 }]);
      expect(stateAtBack).toEqual([375]);
      jest.advanceTimersByTime(150);
      expect(writes).toHaveLength(1);
    } finally {
      Object.defineProperty(window.history, "back", { configurable: true, value: back });
    }
  });

  test("pagehide and hidden visibility persist, while visible visibility does not", () => {
    subscribe(false);
    scrollTo(48);
    window.dispatchEvent(new Event("pagehide"));
    expect(writes.map((write) => write.scrollTop)).toEqual([48]);
    scrollTo(90);
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

  test("popstate drops the pending timer without writing to the newly active entry", () => {
    subscribe(false);
    scrollTo(71);
    window.dispatchEvent(new Event("popstate"));
    jest.advanceTimersByTime(200);
    expect(writes).toHaveLength(0);
    expect(window.history.state).toBeNull();
  });

  test("cleanup persists once, cancels the timer, and removes every listener", () => {
    subscribe(false);
    scrollTo(52);
    cleanup();
    expect(writes.map((write) => write.scrollTop)).toEqual([52]);
    jest.advanceTimersByTime(200);
    scrollTo(100);
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("popstate"));
    expect(writes).toHaveLength(1);
    commitClientUrl("/home", "push");
    expect(writes.map((write) => write.kind)).toEqual(["replace", "push"]);
  });

  test("duplicate entry values skip history writes on every persist trigger", () => {
    window.history.replaceState({ __homeShellScrollTop: 29 }, "", "/activity");
    writes = [];
    subscribe(true);
    scroller.scrollTop = 29;
    scroller.dispatchEvent(new Event("scrollend"));
    window.dispatchEvent(new Event("pagehide"));
    cleanup();
    expect(writes).toHaveLength(0);
  });
});
