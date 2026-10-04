import { describe, expect, test } from "bun:test";
import { aggregateReact, reactAvailability, reactCommitCollectorSource, sliceCommits, summarizeCommits, summarizeReactWindow,
  type ReactCommit, type ReactCommitCollector, type ReactSample } from "./react-attribution";
import { attributionMarkdown, type NavigationAttributionReport } from "./navigation-attribution";

type Fiber = { stateNode?: unknown; actualDuration?: number; child?: Fiber; sibling?: Fiber };
type Hook = { inject: (renderer: object) => number; onCommitFiberRoot: (id: number, root: { current?: Fiber }) => void;
  onPostCommitFiberRoot: (id: number) => void };
type ReactGlobals = {
  performance: { now: () => number }; __REACT_DEVTOOLS_GLOBAL_HOOK__?: object; __homeReactCommits?: ReactCommitCollector;
};
function isHook(value: object): value is Hook {
  return "inject" in value && typeof value.inject === "function"
    && "onCommitFiberRoot" in value && typeof value.onCommitFiberRoot === "function"
    && "onPostCommitFiberRoot" in value && typeof value.onPostCommitFiberRoot === "function";
}
function installedHook(globals: ReactGlobals): Hook {
  const hook = globals.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !isHook(hook)) throw new Error("The React commit collector did not install its DevTools hook");
  return hook;
}
function commits(globals: ReactGlobals): ReactCommitCollector {
  const collector = globals.__homeReactCommits;
  if (!collector) throw new Error("The React commit collector did not install");
  return collector;
}
function install(existing?: object) {
  const globals: ReactGlobals = { performance: { now: () => 15 }, __REACT_DEVTOOLS_GLOBAL_HOOK__: existing, __homeReactCommits: undefined };
  const evaluate = new Function("globalThis", reactCommitCollectorSource);
  Reflect.apply(evaluate, undefined, [globals]);
  return { globals, evaluate };
}
const commit = (atMs: number, renderMs = 10, hidden = false): ReactCommit => ({ atMs, renderMs, commitMs: 2, passiveMs: 1, profiling: true,
  panels: [{ id: "cash", renderMs: 6, hidden }, { id: "home", renderMs: 2, hidden: true }] });
const sample = (path: string, commits: ReactCommit[]): ReactSample => ({ path, react: summarizeCommits(commits), reactReason: null });

describe("React commit collector", () => {
  test("evaluated source installs one hook and captures real time and post-flush passive duration", () => {
    const { globals, evaluate } = install();
    const hook = installedHook(globals);
    const element = { nodeType: 1, getAttribute: () => "cash", hidden: false };
    const state = { effectDuration: 3, passiveEffectDuration: 99 };
    const root = { current: { actualDuration: 8, stateNode: state, child: { stateNode: element, actualDuration: 5 } } };
    const id = hook.inject({});
    globals.performance = { now: () => 999 };
    hook.onCommitFiberRoot(id, root);
    expect(globals.__homeReactCommits).toEqual({ injects: 1, commits: [{ atMs: 15, renderMs: 8, commitMs: 3, passiveMs: 0, profiling: true,
      panels: [{ id: "cash", renderMs: 5, hidden: false }] }] });
    state.passiveEffectDuration = 4;
    hook.onPostCommitFiberRoot(id);
    const [firstCommit] = commits(globals).commits;
    expect(firstCommit?.passiveMs).toBe(4);
    Reflect.apply(evaluate, undefined, [globals]);
    expect(globals.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(hook);
    expect(commits(globals).commits).toHaveLength(1);
  });
  test("skipped subtrees reuse a host fiber with stale positive duration; newly rendered fibers count", () => {
    const { globals } = install();
    const hook = installedHook(globals);
    const element = { nodeType: 1, getAttribute: () => "home", hidden: true };
    const panel = { stateNode: element, actualDuration: 5 };
    hook.onCommitFiberRoot(1, { current: { actualDuration: 5, child: panel } });
    hook.onCommitFiberRoot(1, { current: { actualDuration: 2, child: panel } });
    hook.onCommitFiberRoot(1, { current: { actualDuration: 5, child: { ...panel } } });
    expect(commits(globals).commits.map((entry) => entry.panels)).toEqual([
      [{ id: "home", renderMs: 5, hidden: true }], [], [{ id: "home", renderMs: 5, hidden: true }],
    ]);
  });
  test("a retained page hidden by inline display on itself or an ancestor counts as hidden", () => {
    const { globals } = install();
    const hook = installedHook(globals);
    const visible = { nodeType: 1, getAttribute: () => "cash", hidden: false, style: { display: "" }, parentElement: { style: { display: "" } } };
    const hiddenSelf = { nodeType: 1, getAttribute: () => "home", hidden: false, style: { display: "none" } };
    const hiddenAncestor = { nodeType: 1, getAttribute: () => "invest", hidden: false, style: { display: "" }, parentElement: { style: { display: "none" } } };
    const root = (element: object): { current: Fiber } => ({ current: { actualDuration: 4, child: { stateNode: element, actualDuration: 3 } } });
    for (const element of [visible, hiddenSelf, hiddenAncestor]) hook.onCommitFiberRoot(1, root(element));
    expect(commits(globals).commits.map((entry) => entry.panels)).toEqual([
      [{ id: "cash", renderMs: 3, hidden: false }],
      [{ id: "home", renderMs: 3, hidden: true }],
      [{ id: "invest", renderMs: 3, hidden: true }],
    ]);
  });
  test("missing trees and timings, zero-render panels, cycles and hostile nodes do not throw", () => {
    const { globals } = install();
    const hook = installedHook(globals);
    expect(() => hook.onCommitFiberRoot(1, {})).not.toThrow();
    const fiber: Fiber = { stateNode: { nodeType: 1, getAttribute: () => "cash", hidden: false } };
    fiber.child = fiber;
    hook.onCommitFiberRoot(1, { current: fiber });
    expect(commits(globals).commits).toEqual([{ atMs: 15, renderMs: 0, commitMs: 0, passiveMs: 0, panels: [], profiling: false }]);
    expect(() => hook.onCommitFiberRoot(1, { current: { stateNode: { get nodeType() { throw new Error("bad node"); } } } })).not.toThrow();
    expect(() => hook.onPostCommitFiberRoot(2)).not.toThrow();
  });
  test("an existing hook is preserved and collection remains unavailable", () => {
    const existing = {};
    const { globals } = install(existing);
    expect(globals.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(existing);
    expect(globals.__homeReactCommits).toBeUndefined();
    expect(summarizeReactWindow(globals.__homeReactCommits ?? null, { startMs: 0, endMs: 30 })).toEqual({
      hookInjected: false, react: null, reactReason: "React profiling hook did not inject",
    });
    expect(summarizeReactWindow({ injects: 0, commits: [commit(15)] }, { startMs: 0, endMs: 30 }).react).toBeNull();
  });
});

describe("React window summaries", () => {
  test("commit timestamps use half-open windows", () => {
    expect(sliceCommits([commit(9), commit(10), commit(19), commit(20)], { startMs: 10, endMs: 20 }).map((entry) => entry.atMs)).toEqual([10, 19]);
    expect(sliceCommits([commit(10)], { startMs: 10, endMs: 10 })).toEqual([]);
  });
  test("totals phases and splits hidden render over panel render, not root render", () => {
    expect(summarizeCommits([commit(10), commit(20, 20, true)])).toEqual({ count: 2, renderMs: 30, commitMs: 4, passiveMs: 2,
      maxRenderMs: 20, panels: { cash: { renderMs: 12, commitMs: 4, commits: 2 }, home: { renderMs: 4, commitMs: 0, commits: 2 } },
      hiddenRenderMs: 10, hiddenSharePct: 62.5 });
  });
  test("each commit phase belongs only to its greatest-render panel while root totals stay unchanged", () => {
    const first: ReactCommit = { atMs: 10, renderMs: 20, commitMs: 5, passiveMs: 1, profiling: true, panels: [
      { id: "cash", renderMs: 8, hidden: false }, { id: "invest", renderMs: 3, hidden: false },
    ] };
    const second: ReactCommit = { atMs: 20, renderMs: 30, commitMs: 7, passiveMs: 2, profiling: true, panels: [
      { id: "cash", renderMs: 2, hidden: false }, { id: "invest", renderMs: 12, hidden: true },
    ] };
    const unowned: ReactCommit = { atMs: 30, renderMs: 4, commitMs: 11, passiveMs: 3, profiling: true, panels: [] };
    expect(summarizeCommits([first, second, unowned])).toEqual({ count: 3, renderMs: 54, commitMs: 23, passiveMs: 6, maxRenderMs: 30,
      panels: { cash: { renderMs: 10, commitMs: 5, commits: 2 }, invest: { renderMs: 15, commitMs: 7, commits: 2 } },
      hiddenRenderMs: 12, hiddenSharePct: 48 });
    expect(summarizeCommits([unowned])).toMatchObject({ commitMs: 11, panels: {} });
  });
  test("equal-render owners are selected by lexicographically smallest id regardless of panel order", () => {
    const tied = { ...commit(10), panels: [{ id: "invest", renderMs: 5, hidden: false }, { id: "cash", renderMs: 5, hidden: false }] };
    for (const panels of [tied.panels, tied.panels.toReversed()]) {
      expect(summarizeCommits([{ ...tied, panels }]).panels).toEqual({
        cash: { renderMs: 5, commitMs: 2, commits: 1 }, invest: { renderMs: 5, commitMs: 0, commits: 1 },
      });
    }
  });
  test("an injected hook without profiling timings is unavailable, not zero", () => {
    expect(summarizeCommits([])).toEqual({ count: 0, renderMs: 0, commitMs: 0, passiveMs: 0, maxRenderMs: 0,
      panels: {}, hiddenRenderMs: 0, hiddenSharePct: null });
    expect(reactAvailability({ injects: 1, commits: [{ atMs: 5, renderMs: 0, commitMs: 0, passiveMs: 0, panels: [], profiling: false }] }))
      .toEqual({ injected: true, reason: "React profiling timings are unavailable in this build" });
    expect(summarizeReactWindow({ injects: 1, commits: [{ atMs: 5, renderMs: 0, commitMs: 0, passiveMs: 0, panels: [], profiling: false }] },
      { startMs: 0, endMs: 20 })).toEqual({ hookInjected: true, react: null, reactReason: "React profiling timings are unavailable in this build" });
    expect(summarizeReactWindow({ injects: 1, commits: [commit(5)] }, { startMs: 0, endMs: 20 })).toMatchObject({
      hookInjected: true, reactReason: null, react: { count: 1 },
    });
  });
  test("per-path medians include zero-work windows for each panel but exclude missing hooks", () => {
    const first = commit(10, 10), second = commit(20, 30, true);
    second.panels.push({ id: "invest", renderMs: 2, hidden: false });
    second.commitMs = 8;
    const result = aggregateReact("/cash", [sample("/cash", [first]), sample("/cash", [second]), sample("/cash", []),
      sample("/invest", [commit(10, 999)]), { path: "/cash", react: null, reactReason: "React profiling hook did not inject" }]);
    expect(result).toMatchObject({ samples: 3, count: 1, renderMs: 10, commitMs: 2, passiveMs: 1, reason: null,
      panels: { cash: { renderMs: 6, commitMs: 2, commits: 1 }, home: { renderMs: 2, commitMs: 0, commits: 1 }, invest: { renderMs: 0, commitMs: 0, commits: 0 } },
      topPanel: { id: "cash", renderMs: 6, commitMs: 2 } });
    expect(result.hiddenSharePct).toBeCloseTo((25 + 80) / 2);
  });
  test("per-panel commit medians follow changing owners rather than root commit totals", () => {
    const first = { ...commit(10), commitMs: 5 };
    const second = { ...commit(20), commitMs: 9, panels: [{ id: "home", renderMs: 2, hidden: true }, { id: "invest", renderMs: 7, hidden: false }] };
    const aggregated = aggregateReact("/cash", [sample("/cash", [first]), sample("/cash", [second])]);
    expect(aggregated.commitMs).toBe(7);
    expect(aggregated.panels).toEqual({ cash: { renderMs: 3, commitMs: 2.5, commits: 0.5 },
      home: { renderMs: 2, commitMs: 0, commits: 1 }, invest: { renderMs: 3.5, commitMs: 4.5, commits: 0.5 } });
    expect(aggregated.topPanel).toEqual({ id: "invest", renderMs: 3.5, commitMs: 4.5 });
  });
  test("empty and missing-hook aggregates use null numbers and named reasons", () => {
    expect(aggregateReact("/cash", [])).toEqual({ path: "/cash", samples: 0, count: null, renderMs: null, commitMs: null,
      passiveMs: null, panels: {}, hiddenSharePct: null, topPanel: null, reason: "No React commit windows collected" });
    expect(aggregateReact("/cash", [{ path: "/cash", react: null, reactReason: "React profiling hook did not inject" }])).toMatchObject({
      count: null, renderMs: null, reason: "React profiling hook did not inject",
    });
  });
  test("Markdown reports configured, missing and non-injected profiling legs honestly", () => {
    const report: NavigationAttributionReport = { rows: 300, pooling: "cycles and measured legs per path", chromium: [], samples: [], plainLatenciesByPath: {},
      webkit: { browser: null, samples: [], paths: [], errors: [] }, react: { url: null, samples: [], hooks: [], reason: "No profiling build configured",
        paths: [aggregateReact("/cash", [])] } };
    expect(attributionMarkdown(report)).toContain("| /cash | — | — | — | — | — | — | — | — | — |");
    expect(attributionMarkdown(report)).toContain("React commits unavailable: No profiling build configured.");
    report.react = { url: "http://localhost:3299", samples: [], hooks: [{ path: "/cash", injected: false, reason: "React profiling hook did not inject" }],
      reason: null, paths: [aggregateReact("/cash", [])] };
    expect(attributionMarkdown(report)).toContain("React commits unavailable (/cash): React profiling hook did not inject.");
    report.react.hooks = [{ path: "/cash", injected: true, reason: "React profiling timings are unavailable in this build" }];
    expect(attributionMarkdown(report)).toContain("React commits unavailable (/cash): React profiling timings are unavailable in this build.");
    report.react.paths = [aggregateReact("/cash", [sample("/cash", [commit(10)])])];
    report.react.hooks = [{ path: "/cash", injected: true, reason: null }];
    expect(attributionMarkdown(report)).toContain("| /cash | 1 | 10 | 2 | 1 | cash | 6 | 2 | home: 2 / 0 | 25% |");
    expect(attributionMarkdown(report).join("\n")).toContain("attribution by owning panel, not a per-subtree measurement");
  });
});
