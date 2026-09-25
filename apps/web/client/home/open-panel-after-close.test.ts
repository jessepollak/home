import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import type { ShellPanelId } from "@/config/navigation";
import { openPanelAfterClose } from "./panel-routing";

afterEach(() => window.history.replaceState(null, "", "/"));

function recorder() {
  const events: string[] = [];
  return { events, routing: { openPanel: (panel: ShellPanelId) => { events.push(`open:${panel}`); } } };
}

test("waits for a history traversal started by close before opening the panel", () => {
  const { events, routing } = recorder();
  const scheduled: Array<() => void> = [];
  openPanelAfterClose(routing, "activity", () => { events.push("close"); }, (open) => { scheduled.push(open); });
  expect(events).toEqual(["close"]);
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(events).toEqual(["close", "open:activity"]);
  scheduled.forEach((open) => open());
  expect(events).toEqual(["close", "open:activity"]);
});

test("opens immediately when close already replaced the URL", () => {
  const { events, routing } = recorder();
  window.history.replaceState(null, "", "/home?flow=send");
  openPanelAfterClose(routing, "activity", () => {
    events.push("close");
    window.history.replaceState(null, "", "/home");
  }, () => { throw new Error("no fallback expected"); });
  expect(events).toEqual(["close", "open:activity"]);
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(events).toEqual(["close", "open:activity"]);
});

test("falls back once when close leaves history unchanged", () => {
  const { events, routing } = recorder();
  const scheduled: Array<() => void> = [];
  openPanelAfterClose(routing, "activity", () => { events.push("close"); }, (open) => { scheduled.push(open); });
  scheduled.forEach((open) => open());
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(events).toEqual(["close", "open:activity"]);
});

test("only closes without shell routing", () => {
  const events: string[] = [];
  openPanelAfterClose(null, "activity", () => { events.push("close"); });
  expect(events).toEqual(["close"]);
});
