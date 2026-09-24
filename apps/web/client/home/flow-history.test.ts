import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { commitFlowUrl, flowHref } from "@/config/shell-location";

let pushes: string[] = [];
let restoreHistory: () => void = () => {};

beforeEach(() => {
  window.history.replaceState(null, "", "/home");
  pushes = [];
  const pushState = window.history.pushState;
  Object.defineProperty(window.history, "pushState", {
    configurable: true,
    value: (state: unknown, unused: string, url?: string | URL | null) => {
      pushes.push(String(url));
      pushState.call(window.history, state, unused, url);
    },
  });
  restoreHistory = () => {
    Object.defineProperty(window.history, "pushState", { configurable: true, value: pushState });
  };
});

afterEach(() => {
  restoreHistory();
});

describe("commitFlowUrl", () => {
  test("a repeated open of the same flow does not stack a second history entry", () => {
    commitFlowUrl(flowHref("/home", "send"));
    commitFlowUrl(flowHref("/home", "send"));

    expect(pushes).toEqual(["/home?flow=send"]);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/home?flow=send");
  });

  test("reports a push only when a new history entry was created", () => {
    window.history.replaceState(null, "", "/home?flow=send");

    expect(commitFlowUrl(flowHref("/home", "send"))).toBe(false);
    expect(commitFlowUrl(flowHref("/home", "add-money"))).toBe(true);
    expect(commitFlowUrl(flowHref("/home", "receive"), "replace")).toBe(false);
    expect(pushes).toEqual(["/home?flow=add-money"]);
  });

  test("opening a different flow still pushes an entry", () => {
    commitFlowUrl(flowHref("/home", "send"));
    commitFlowUrl(flowHref("/home", "add-money"));

    expect(pushes).toEqual(["/home?flow=send", "/home?flow=add-money"]);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/home?flow=add-money");
  });
});
