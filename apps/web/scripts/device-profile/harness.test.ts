import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { activitySourcesAttribute } from "@/client/activity/activity-sources";
import { activityPartialSources, activityReadinessMarkers, activityReadinessProblems, activityRecentRows, activityRowCount, activitySourceStates, activityUnsettledSources, mergePartialSources } from "./activity-rows";

afterEach(() => { document.body.innerHTML = ""; });

function mainWith(markup: string) {
  document.body.innerHTML = "";
  const root = document.createElement("main");
  root.setAttribute("data-app-main-authenticated", "");
  root.innerHTML = markup;
  document.body.append(root);
  return root;
}

const moneySummary = (rows: number) => `<section aria-labelledby="your-money-heading"><ul data-money-summary="">${Array.from({ length: rows }, (_, index) => `<li>Summary ${index + 1}</li>`).join("")}</ul></section>`;

test("row counting ignores lists outside the activity surface", () => {
  expect(activityRowCount(mainWith(moneySummary(3)))).toBe(0);
  expect(activityRowCount(mainWith(`<section id="navigation-panel" aria-label="Activity"><ul><li>Home</li><li>Activity</li></ul></section>`))).toBe(0);
});

test("pending-only activity counts its own rows, not the money summary beside it", () => {
  const root = mainWith(`${moneySummary(3)}<section data-activity-feed=""><div><ul><li>Pending</li><li>Pending</li></ul></div></section>`);
  expect(activityRowCount(root)).toBe(2);
});

test("recent rows report the virtual list size and ignore neighbouring lists", () => {
  const listed = (setsize: number) => mainWith(`${moneySummary(3)}<section data-activity-feed=""><div><ul><li aria-posinset="1" aria-setsize="-1">Recent</li><li aria-posinset="2" aria-setsize="${setsize}">Recent</li></ul></div></section>`);
  expect(activityRowCount(listed(300))).toBe(300);
  expect(activityRowCount(listed(-1))).toBe(2);
});

test("an Activity-labelled page section is a feed surface while the navigation panel is not", () => {
  const root = mainWith(`${moneySummary(3)}<section aria-label="Activity" aria-busy="true"><ul><li aria-posinset="1" aria-setsize="-1">Recent</li></ul></section>`);
  expect(activityRowCount(root)).toBe(1);
});

test("pending rows add to the reported total when Recent rows are present too", () => {
  const root = mainWith(`${moneySummary(3)}<section data-activity-feed=""><div><ul><li>Pending</li><li>Pending</li></ul></div><div><ul><li aria-posinset="1" aria-setsize="300">Recent</li><li aria-posinset="2" aria-setsize="300">Recent</li></ul></div></section>`);
  expect(activityRowCount(root)).toBe(302);
  expect(activityRecentRows(root)).toBe(300);
});

test("each visible virtual activity list contributes its logical size across window changes", () => {
  const surface = (pending = false) => `<section data-activity-feed="">${pending ? "<ul><li>Pending</li></ul>" : ""}<ul>${Array.from({ length: 3 }, (_, index) => `<li aria-posinset="${index + 1}" aria-setsize="300">Recent</li>`).join("")}</ul></section>`;
  const root = mainWith(`${surface(true)}${surface()}`);
  expect(activityRowCount(root)).toBe(601);
  const second = root.querySelectorAll("section[data-activity-feed]")[1]!;
  for (const row of [...second.querySelectorAll("li[aria-posinset]")].slice(1)) row.remove();
  expect(activityRowCount(root)).toBe(601);
});

test("partial activity sources are reported so a run is not published as complete", () => {
  const root = mainWith(`<section data-activity-feed=""><p role="status">Onchain transfers are unavailable. Recorded Home actions are still shown.</p><ul><li aria-posinset="1" aria-setsize="4">Recent</li></ul></section>`);
  expect(activityPartialSources(root)).toHaveLength(1);
  expect(activityPartialSources(root)[0]).toStartWith("Onchain transfers are unavailable.");
  expect(activityPartialSources(mainWith(`<section data-activity-feed=""><p role="status">End of activity</p><ul><li aria-posinset="1" aria-setsize="4">Recent</li></ul></section>`))).toEqual([]);
  expect(activityPartialSources(mainWith(`<section data-activity-feed=""><p role="status">Card purchases may be out of date.</p><ul><li aria-posinset="1" aria-setsize="4">Recent</li></ul></section>`))).toHaveLength(1);
  expect(activityPartialSources(mainWith(`${moneySummary(3)}<p role="status">Transfers are unavailable</p>`))).toEqual([]);
  const pageFailed = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="4">Recent</li></ul><p role="alert">More activity could not be loaded. Your current results are unchanged.</p></section>`);
  expect(activityPartialSources(pageFailed)).toHaveLength(1);
  expect(activityPartialSources(pageFailed)[0]).toStartWith("More activity could not be loaded.");
  expect(activityRecentRows(mainWith(`${moneySummary(3)}<section data-activity-feed=""><div><ul><li>Pending</li><li>Pending</li></ul></div></section>`))).toBe(0);
});

test("a source that fails after the feed fill still marks the run partial", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="4">Recent</li></ul></section>`);
  const before = activityPartialSources(root);
  expect(before).toEqual([]);
  root.querySelector("ul")?.insertAdjacentHTML("beforebegin", `<p role="status">Add money and cash-out orders are unavailable.</p>`);
  expect(mergePartialSources(before, activityPartialSources(root))).toEqual(["Add money and cash-out orders are unavailable."]);
});

test("Activity readiness reports orders still loading after transfers settle", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:loading"><ul><li>Recent</li></ul></section>`);
  expect(activityUnsettledSources(root)).toEqual(["orders"]);
});

test("Activity readiness reports transfers still loading after the other sources settle", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:loading actions:ready orders:ready"><ul><li>Recent</li></ul></section>`);
  expect(activityUnsettledSources(root)).toEqual(["transfers"]);
});

test("Activity readiness parses settled source states", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:unavailable"><ul><li>Recent</li></ul></section>`);
  expect(activitySourceStates(root)).toEqual([{ name: "transfers", status: "ready" }, { name: "actions", status: "ready" }, { name: "orders", status: "unavailable" }]);
  expect(activityUnsettledSources(root)).toEqual([]);
  expect(activityUnsettledSources(mainWith(`<section data-activity-feed="" data-activity-sources="transfers:error actions:ready orders:ready"></section>`))).toEqual([]);
});

test("an Activity surface without readiness reports no source states", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li>Recent</li></ul></section>`);
  expect(activitySourceStates(root)).toEqual([]);
  expect(activityUnsettledSources(root)).toEqual([]);
});

test("failed Activity readiness marks cached rows partial without visible unavailable prose", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:error"><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessMarkers(root)).toEqual(["Activity source orders reported error"]);
});

test("visible unavailable prose does not hide failed Activity readiness markers", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:error"><p role="status">Add money and cash-out orders are unavailable.</p><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessMarkers(root)).toEqual(["Activity source orders reported error"]);
});

test("Activity readiness markers preserve readiness problems", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready"><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessMarkers(root)).toEqual(["Activity source orders did not report readiness"]);
});

test("complete Activity source readiness reports no problems", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:ready"><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual([]);
});

test("incomplete Activity source readiness reports the missing source", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready"><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual(["Activity source orders did not report readiness"]);
});

test("unrecognised Activity source readiness reports the unknown source", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:ready cards:ready"><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual(["Activity source cards is unrecognised"]);
});

test("an Activity surface without readiness reports a readiness problem", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual(["Activity sources did not report readiness"]);
});

test("each row-bearing Activity surface must report complete readiness even when their union is complete", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready"><ul><li>Recent</li></ul></section><section data-activity-feed="" data-activity-sources="orders:ready"><ul><li>Pending</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual(["Activity source orders did not report readiness", "Activity source transfers did not report readiness", "Activity source actions did not report readiness"]);
});

test("a complete Activity surface does not mask a row-bearing surface without readiness", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:ready"><ul><li>Recent</li></ul></section><section data-activity-feed=""><ul><li>Pending</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual(["Activity sources did not report readiness"]);
});

test("duplicate Activity source names report a readiness problem", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:ready transfers:ready"><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual(["Activity source transfers is reported twice"]);
});

test("a row-less Activity surface without readiness is ignored beside a complete row-bearing surface", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:ready"><ul><li>Recent</li></ul></section><section data-activity-feed=""></section>`);
  expect(activityReadinessProblems(root)).toEqual([]);
});

test("masked Activity readiness does not satisfy the visible feed contract", () => {
  const root = mainWith(`<section data-activity-feed="" style="visibility:hidden" data-activity-sources="transfers:ready actions:ready orders:ready"></section><section data-activity-feed=""><ul><li>Recent</li></ul></section>`);
  expect(activityReadinessProblems(root)).toEqual(["Activity sources did not report readiness"]);
});

test("malformed and unrecognised Activity readiness tokens stay unsettled", () => {
  for (const token of ["orders", "orders:weird", "orders:ready:extra"]) {
    const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready ${token}"></section>`);
    expect(activityUnsettledSources(root)).toEqual([token === "orders:ready:extra" ? token : "orders"]);
  }
});

test("the Activity producer and profiling parser share the exact readiness contract", () => {
  const sources = activitySourcesAttribute({ transfers: "ready", actions: "ready", orders: "loading" });
  expect(sources).toBe("transfers:ready actions:ready orders:loading");
  expect(activityUnsettledSources(mainWith(`<section data-activity-feed="" data-activity-sources="${sources}"></section>`))).toEqual(["orders"]);
});

test("the browser harness bundle stays a classic script a page can load", async () => {
  const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "harness.ts")], target: "browser", minify: true });
  expect(build.success).toBe(true);
  const source = await build.outputs[0]!.text();
  expect(() => new Function(source)).not.toThrow();
});
