import "@/client/account/dom-test-harness";

import { afterEach, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { activitySourcesAttribute } from "@/client/activity/activity-sources";
import { activityDetailOpener, activityRowFacts, activityPartialSources, activityReadinessMarkers, activityReadinessProblems, activityRecentRows, activityRowCount, feedCounts, activityScrollHost, activitySourceStates, activityUnsettledSources, mergePartialSources, mergeRowFacts, visibleIn, type ActivityRowFacts } from "./activity-rows";
import { waitForQuietFeed } from "./model";

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

test("detail-capable Recent rows exclude grouped disclosures and retry controls", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="3"><button aria-label="Retry">Retry</button><button aria-describedby="d1">Sent</button><span id="d1" hidden>Sent USDC</span></li><li aria-posinset="2" aria-setsize="3"><button aria-describedby="d2" aria-expanded="false">Received ×3</button><span id="d2" hidden>3 Received USDC transfers</span></li><li aria-posinset="3" aria-setsize="3"><button aria-label="Retry">Retry</button></li></ul></section>`);
  expect(activityRowFacts(root)).toEqual([{ posinset: 1, key: null, detail: true, group: null }, { posinset: 2, key: null, detail: false, group: { count: 3, expanded: false } }, { posinset: 3, key: null, detail: false, group: null }]);
  expect(activityDetailOpener(root, 1)?.textContent).toBe("Sent");
  expect(activityDetailOpener(root, 2)).toBeNull();
  expect(activityDetailOpener(root, 3)).toBeNull();
});

test("grouped rows parse transfer counts from the accessible description, not visible text", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="2" aria-setsize="4" data-row-key="received-usdc"><button aria-describedby="d2" aria-expanded="false">Received ×99</button><span id="d2" hidden> 3 Received USDC transfers</span></li><li aria-posinset="3" aria-setsize="4" data-row-key="received-eth"><button aria-describedby="d3" aria-expanded="true">Received ×2</button><span id="d3" hidden>2 Received ETH transfers</span></li></ul></section>`);
  expect(activityRowFacts(root)).toEqual([{ posinset: 2, key: "received-usdc", detail: false, group: { count: 3, expanded: false } }, { posinset: 3, key: "received-eth", detail: false, group: { count: 2, expanded: true } }]);
});

test("collapsed grouped rows report list and underlying counts separately including Pending", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li>Pending</li></ul><ul><li aria-posinset="1" aria-setsize="4">Sent</li><li aria-posinset="2" aria-setsize="4"><button aria-describedby="d2" aria-expanded="false">Received ×3</button><span id="d2" hidden>3 Received USDC transfers</span></li><li aria-posinset="3" aria-setsize="4">Sent</li><li aria-posinset="4" aria-setsize="4">Sent</li></ul></section>`);
  expect(activityRowCount(root)).toBe(5);
  expect(activityRecentRows(root)).toBe(4);
  expect(feedCounts(activityRowFacts(root), activityRowCount(root))).toEqual({ grouped: 1, underlying: 7, unreadable: 0 });
});

test("expanded grouped rows count mounted children without double counting transfers", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="4"><button aria-describedby="d1" aria-expanded="true">Received ×3</button><span id="d1" hidden>3 Received USDC transfers</span></li>${[2, 3, 4].map((position) => `<li aria-posinset="${position}" aria-setsize="4"><button aria-describedby="child${position}">Received</button><span id="child${position}" hidden>Received USDC</span></li>`).join("")}</ul></section>`);
  expect(activityRecentRows(root)).toBe(4);
  expect(feedCounts(activityRowFacts(root), activityRecentRows(root))).toEqual({ grouped: 1, underlying: 3, unreadable: 0 });
});

test("grouped rows without a safe positive leading count are unreadable", () => {
  for (const description of ["Received USDC transfers", "0 Received USDC transfers", "9007199254740992 Received USDC transfers", "3x Received USDC transfers"]) {
    const root = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="1"><button aria-describedby="d1" aria-expanded="false">Received ×3</button><span id="d1" hidden>${description}</span></li></ul></section>`);
    expect(activityRowFacts(root)).toEqual([{ posinset: 1, key: null, detail: false, group: { count: null, expanded: false } }]);
    expect(feedCounts(activityRowFacts(root), activityRecentRows(root))).toEqual({ grouped: 1, underlying: 0, unreadable: 1 });
  }
  const root = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="1"><button aria-describedby="missing" aria-expanded="true">Received ×3</button></li></ul></section>`);
  expect(feedCounts(activityRowFacts(root), activityRecentRows(root))).toEqual({ grouped: 1, underlying: 0, unreadable: 1 });
});

test("merged row facts count grouped transfers outside the mounted window", () => {
  const windowAt = (position: number, count: number) => mainWith(`<section data-activity-feed=""><ul><li aria-posinset="${position}" aria-setsize="300"><button aria-describedby="group" aria-expanded="false">Received</button><span id="group" hidden>${count} Received USDC transfers</span></li></ul></section>`);
  const facts = [...activityRowFacts(windowAt(1, 3)), ...activityRowFacts(windowAt(150, 7))];
  expect(feedCounts(facts, 300)).toEqual({ grouped: 2, underlying: 308, unreadable: 0 });
  expect(feedCounts([], 0)).toEqual({ grouped: 0, underlying: 0, unreadable: 0 });
});

const rowFact = (posinset: number, key: string | null): ActivityRowFacts => ({ posinset, key, detail: false, group: null });

test("merging row facts accepts a first sighting", () => {
  const first = rowFact(1, "first");
  expect(mergeRowFacts([], [first])).toEqual({ facts: [first], changed: false });
});

test("merging row facts accepts the same key at the same position", () => {
  const first = rowFact(1, "first");
  expect(mergeRowFacts([first], [rowFact(1, "first")])).toEqual({ facts: [first], changed: false });
});

test("merging row facts detects the same key at a different position", () => {
  const first = rowFact(40, "first"), moved = rowFact(230, "first");
  expect(mergeRowFacts([first], [moved])).toEqual({ facts: [first, moved], changed: true });
  expect(mergeRowFacts([], [first, moved])).toEqual({ facts: [first, moved], changed: true });
});

test("merging row facts detects a different non-null key at the same position", () => {
  const replacement = rowFact(1, "second");
  expect(mergeRowFacts([rowFact(1, "first")], [replacement])).toEqual({ facts: [replacement], changed: true });
});

test("merging row facts accepts null keys on either side", () => {
  for (const [previous, next] of [["first", null], [null, "second"], [null, null]] as const) {
    const replacement = rowFact(1, next);
    expect(mergeRowFacts([rowFact(1, previous)], [replacement])).toEqual({ facts: [replacement], changed: false });
  }
});

test("merging stable row windows returns their union sorted by position without mutating inputs", () => {
  const previous = [rowFact(3, "third"), rowFact(1, "first")];
  const rows = [rowFact(4, "fourth"), rowFact(3, "third"), rowFact(2, "second")];
  expect(mergeRowFacts(previous, rows)).toEqual({ facts: [previous[1], rows[2], rows[1], rows[0]], changed: false });
  expect(previous).toEqual([rowFact(3, "third"), rowFact(1, "first")]);
  expect(rows).toEqual([rowFact(4, "fourth"), rowFact(3, "third"), rowFact(2, "second")]);
});

test("merging row facts detects grouped transfer count changes in place and stores the latest facts", () => {
  for (const [previousKey, nextKey] of [["group", "group"], ["group", null], [null, "group"], [null, null]] as const) {
    for (const [previousCount, nextCount] of [[3, 7], [3, null], [null, 3]] as const) {
      const previous: ActivityRowFacts = { ...rowFact(1, previousKey), group: { count: previousCount, expanded: false } };
      const next: ActivityRowFacts = { ...rowFact(1, nextKey), group: { count: nextCount, expanded: false } };
      expect(mergeRowFacts([previous], [next])).toEqual({ facts: [next], changed: true });
    }
  }
});

test("merging row facts detects transitions between grouped and non-grouped rows", () => {
  const plain = rowFact(1, "first");
  const grouped: ActivityRowFacts = { ...plain, group: { count: 3, expanded: false } };
  expect(mergeRowFacts([grouped], [plain])).toEqual({ facts: [plain], changed: true });
  expect(mergeRowFacts([plain], [grouped])).toEqual({ facts: [grouped], changed: true });
});

test("merging row facts detects grouped expansion toggles", () => {
  const collapsed: ActivityRowFacts = { ...rowFact(1, "group"), group: { count: 3, expanded: false } };
  const expanded: ActivityRowFacts = { ...rowFact(1, "group"), group: { count: 3, expanded: true } };
  expect(mergeRowFacts([collapsed], [expanded])).toEqual({ facts: [expanded], changed: true });
  expect(mergeRowFacts([expanded], [collapsed])).toEqual({ facts: [collapsed], changed: true });
});

test("merging row facts detects detail capability changes", () => {
  const plain = rowFact(1, "first");
  const detail: ActivityRowFacts = { ...plain, detail: true };
  expect(mergeRowFacts([plain], [detail])).toEqual({ facts: [detail], changed: true });
  expect(mergeRowFacts([detail], [plain])).toEqual({ facts: [plain], changed: true });
});

test("merging identical row facts across a second pass stays unchanged", () => {
  const rows: ActivityRowFacts[] = [
    { ...rowFact(1, "group"), group: { count: 3, expanded: false } },
    { ...rowFact(2, "detail"), detail: true },
    rowFact(3, null),
  ];
  const first = mergeRowFacts([], rows);
  const second = rows.map((row) => ({ ...row, group: row.group ? { ...row.group } : null }));
  expect(mergeRowFacts(first.facts, second)).toEqual({ facts: second, changed: false });
});

test("activity scroll host uses the nearest scrollable feed ancestor", () => {
  const root = mainWith(`<div id="wrapper" style="overflow-y: auto"><section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="1">Recent</li></ul></section></div>`);
  const wrapper = root.querySelector<HTMLElement>("#wrapper");
  if (!wrapper) throw new Error("Missing scrollable wrapper fixture");
  expect(activityScrollHost(root)).toBe(wrapper);
});

test("activity scroll host uses the document when no feed ancestor scrolls", () => {
  const root = mainWith(`<section data-activity-feed=""><ul><li aria-posinset="1" aria-setsize="1">Recent</li></ul></section>`);
  expect(activityScrollHost(root)).toBe(document.documentElement);
});

test("visibleIn requires a visible element intersecting the scroller viewport", () => {
  const root = mainWith(`<div id="inside">Inside</div><div id="outside">Outside</div>`);
  const inside = root.querySelector<HTMLElement>("#inside"), outside = root.querySelector<HTMLElement>("#outside");
  if (!inside || !outside) throw new Error("Missing visibleIn fixtures");
  const bounds = spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 400));
  const insideBounds = spyOn(inside, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 120, 300, 40));
  const outsideBounds = spyOn(outside, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 600, 300, 40));
  const viewportHeight = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
  try {
    expect(visibleIn(outside, root)).toBe(false);
    expect(visibleIn(inside, root)).toBe(true);
    const documentHost = document.scrollingElement ?? document.documentElement;
    expect(visibleIn(outside, documentHost)).toBe(false);
    expect(visibleIn(inside, documentHost)).toBe(true);
    inside.style.visibility = "hidden";
    expect(visibleIn(inside, root)).toBe(false);
    expect(visibleIn(null, root)).toBe(false);
    expect(visibleIn(inside, documentHost)).toBe(false);
    expect(visibleIn(null, documentHost)).toBe(false);
  } finally {
    bounds.mockRestore(); insideBounds.mockRestore(); outsideBounds.mockRestore();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: viewportHeight });
  }
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

test("partial markers captured before a scan survive source recovery", () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:error"><p role="status">Add money and cash-out orders are unavailable.</p><ul><li>Recent</li></ul></section>`);
  const before = mergePartialSources(activityPartialSources(root), activityReadinessMarkers(root));
  root.querySelector("section")?.setAttribute("data-activity-sources", "transfers:ready actions:ready orders:ready");
  root.querySelector('[role="status"]')?.remove();
  expect(activityPartialSources(root)).toEqual([]);
  expect(activityReadinessMarkers(root)).toEqual([]);
  expect(mergePartialSources(before, [...activityPartialSources(root), ...activityReadinessMarkers(root)])).toEqual([
    "Add money and cash-out orders are unavailable.",
    "Activity source orders reported error",
  ]);
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

test("a deferred Activity row during the post-run quiet period marks the run partial", async () => {
  const root = mainWith(`<section data-activity-feed="" data-activity-sources="transfers:ready actions:ready orders:ready"><ul><li aria-posinset="1" aria-setsize="1">Recent</li></ul></section>`);
  const list = root.querySelector("ul");
  if (!list) throw new Error("Expected the activity list");
  let now = 0;
  const markers = await waitForQuietFeed({
    rows: activityRowCount(root),
    now: () => now,
    frame: async () => {
      now += 16;
      if (now === 160) list.insertAdjacentHTML("beforeend", `<li aria-posinset="2" aria-setsize="2">Recent</li>`);
    },
    sample: () => ({ rows: activityRowCount(root), pending: activityUnsettledSources(root), markers: activityReadinessMarkers(root) }),
  });
  expect(markers).toEqual(["The measured activity feed changed during the run (1 to 2 rows)"]);
  expect(now).toBe(160);
});

test("the browser harness bundle stays a classic script a page can load", async () => {
  const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "harness.ts")], target: "browser", minify: true });
  expect(build.success).toBe(true);
  const source = await build.outputs[0]!.text();
  expect(() => new Function(source)).not.toThrow();
});
