import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { activityPartialSources, activityRecentRows, activityRowCount, mergePartialSources } from "./activity-rows";

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

test("the browser harness bundle stays a classic script a page can load", async () => {
  const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "harness.ts")], target: "browser", minify: true });
  expect(build.success).toBe(true);
  const source = await build.outputs[0]!.text();
  expect(() => new Function(source)).not.toThrow();
});
