import { expect, test } from "bun:test";
import { childFailureDetail, flingAttemptNeedsReap, flingBrowserPidFromStderr, flingStderrTail, playwrightBrowserIdentity, playwrightBrowserPid, reapFlingBrowser } from "../navigation-profile";
import { baselineDeltas, baselineMismatches, compactNavigationBaseline, firstNextEnvFile, hasNavigationCapGuard, isFlingResult, navigationMarkdown, parseNavigationReport, patchNavigationCap, readNavigationBaseline, summarizeNavigation, validateNavigationSample,
  type NavigationSample } from "./navigation-samples";

const guard = 'if(!l()||n>=10||e===t||!f.isVisible())return;';
const source = `const report={kind:"home-navigation"};${guard}`;
test("fling child failure detail names the deadline and retains only the stderr tail", () => {
  expect(childFailureDetail("Chromium fling", 180_000, "")).toContain("Chromium fling deadline 180 s; stderr tail: (empty)");
  expect(childFailureDetail("Chromium fling", 180_000, "launch stalled\n")).toContain("stderr tail: launch stalled");
  const long = "a".repeat(3_000) + "fling worker: writing result";
  const detail = childFailureDetail("Chromium fling", 180_000, long);
  expect(detail).toContain("Chromium fling deadline 180 s");
  expect(detail).toContain("fling worker: writing result");
  expect(detail).not.toContain("a".repeat(3_000));
  expect(detail.length).toBeLessThanOrEqual(2_100);
  expect(flingStderrTail(long)).toBe(long.slice(-2_048).trim());
  expect(flingStderrTail(" \n ")).toBe("(empty)");
});
test("resolves the worker's flagged browser through direct and intermediate parents", () => {
  const browser = { pid: 12, ppid: 11, command: "chromium --user-data-dir=/tmp/playwright_chromiumdev_profile-new" };
  const driver = { pid: 11, ppid: 200, command: "node driver" };
  expect(playwrightBrowserPid([{ ...browser, ppid: 200 }], 200)).toBe(12);
  expect(playwrightBrowserPid([browser, driver], 200)).toBe(12);
  expect(playwrightBrowserPid([driver, browser], 200)).toBe(12);
  expect(playwrightBrowserPid([browser, driver, { pid: 16, ppid: 12, command: "chromium --type=renderer playwright_chromiumdev_profile-new" }], 200)).toBe(12);
  expect(playwrightBrowserPid([{ ...browser, ppid: 200 }, { pid: 16, ppid: 200, command: "chromium playwright_chromiumdev_profile-other" }], 200)).toBeNull();
  expect(playwrightBrowserIdentity([browser, driver], 200)).toEqual({ pid: 12, profile: "/tmp/playwright_chromiumdev_profile-new" });
  expect(playwrightBrowserIdentity([{ ...browser, command: "chromium playwright_chromiumdev_profile-new" }, driver], 200)).toBeNull();
});
test("ignores unrelated, pre-existing, and non-flagged browser processes", () => {
  const previous = { pid: 10, ppid: 1, command: "chromium playwright_chromiumdev_profile-old" };
  const foreign = { pid: 14, ppid: 999, command: "chromium playwright_chromiumdev_profile-other" };
  const ordinary = { pid: 15, ppid: 200, command: "chromium --user-data-dir=/tmp/chrome" };
  expect(playwrightBrowserPid([previous, foreign, ordinary], 200)).toBeNull();
  expect(playwrightBrowserPid([previous, foreign, ordinary, { pid: 12, ppid: 200, command: "chromium playwright_chromiumdev_profile-new" }], 200)).toBe(12);
  expect(playwrightBrowserPid([{ ...previous, ppid: 1 }], 200)).toBeNull();
  expect(playwrightBrowserPid([{ pid: 12, ppid: 11, command: "chromium playwright_chromiumdev_profile" }], 200)).toBeNull();
  expect(playwrightBrowserPid([{ pid: 12, ppid: 12, command: "chromium playwright_chromiumdev_profile" }], 200)).toBeNull();
  expect(playwrightBrowserPid([], 200)).toBeNull();
});
test("parses only the last child browser marker with a unique profile", () => {
  const first = "fling worker: browser 140.0 pid 42 profile /tmp/playwright_chromiumdev_profile-first";
  const second = "fling worker: browser 140 pid 43 profile /tmp/playwright_chromiumdev_profile-second";
  expect(flingBrowserPidFromStderr(`fling worker: launching chromium\n${first}\n`)).toEqual({ pid: 42, profile: "/tmp/playwright_chromiumdev_profile-first" });
  expect(flingBrowserPidFromStderr(`${first}\n${second}\n`)).toEqual({ pid: 43, profile: "/tmp/playwright_chromiumdev_profile-second" });
  expect(flingBrowserPidFromStderr(`${first}\nfling worker: browser 140 pid unknown profile unknown\n`)).toBeNull();
  expect(flingBrowserPidFromStderr("fling worker: browser 140 pid 42\n")).toBeNull();
  expect(flingBrowserPidFromStderr("launch stalled\n")).toBeNull();
  for (const stderr of ["fling worker: browser 140 pid 0", "fling worker: browser 140 pid -5",
    "fling worker: browser 140 pid 1.2", "fling worker: browser 140 pid not-a-pid", "fling worker: browser 140 pid 999999999999999999999",
    "other: browser 140 pid 42", "fling worker: browser 140 pid 42 trailing",
    "fling worker: browser 140 pid 42 profile /tmp/playwright_chromiumdev_profile",
    "fling worker: browser 140 pid 42 profile /tmp/playwright_chromiumdev_profile-ok trailing"]) expect(flingBrowserPidFromStderr(stderr)).toBeNull();
  expect(flingBrowserPidFromStderr("fling worker: browser 140 pid 0 profile /tmp/playwright_chromiumdev_profile-ok")).toBeNull();
  expect(flingBrowserPidFromStderr("fling worker: browser 140 pid 999999999999999999999 profile /tmp/playwright_chromiumdev_profile-ok")).toBeNull();
});
test("reaps only the exact PID with its original browser profile", () => {
  const browser = { pid: 42, profile: "/tmp/playwright_chromiumdev_profile-first" };
  const signaled: number[] = [];
  const signal = (pid: number) => { signaled.push(pid); };
  const row = { pid: 42, ppid: 1, command: `chromium --user-data-dir=${browser.profile}` };
  expect(reapFlingBrowser([{ ...row, command: "chromium --user-data-dir=/tmp/playwright_chromiumdev_profile-other" }], browser, signal)).toBe(0);
  expect(reapFlingBrowser([{ ...row, command: `chromium --user-data-dir=/tmp/playwright_chromiumdev_profile-other ${browser.profile}` }], browser, signal)).toBe(0);
  expect(reapFlingBrowser([{ ...row, pid: 41 }], browser, signal)).toBe(0);
  expect(reapFlingBrowser([row, row], browser, signal)).toBe(0);
  expect(signaled).toEqual([]);
  expect(reapFlingBrowser([row], browser, signal)).toBe(1);
  expect(signaled).toEqual([42]);
});
test("requires complete, finite fling results with the requested repeat count", () => {
  const row = { p95: 20, over33: 5, droppedPct: 2, blockingMs: 1, maxRows: 300, settledRows: 300, historyWrites: 1, frames: 3, scrollHost: "document" };
  const valid = { flings: [row, row, row], timing: { p95: 20, over33: 5, droppedPct: 2, blockingMs: 1 }, browserVersion: "140" };
  expect(isFlingResult(valid, 3)).toBe(true);
  expect(isFlingResult({ ...valid, flings: [row, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [] }, 0)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, p95: Infinity }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, frames: 2 }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, maxRows: 0 }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, settledRows: 300.5 }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, settledRows: 0 }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, settledRows: 301 }, row] }, 3)).toBe(true);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, historyWrites: 1.5 }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, timing: { ...valid.timing, blockingMs: NaN } }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, timing: undefined }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, browserVersion: "" }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, scrollHost: "other" }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, scrollHost: undefined }, row] }, 3)).toBe(false);
  expect(isFlingResult(undefined, 3)).toBe(false);
  for (const key of ["maxRows", "settledRows", "historyWrites"] as const) {
    const missing = { ...row };
    delete (missing as Partial<typeof row>)[key];
    expect(isFlingResult({ ...valid, flings: [row, missing, row] }, 3)).toBe(false);
    expect(isFlingResult({ ...valid, flings: [row, { ...row, [key]: -1 }, row] }, 3)).toBe(false);
  }
  expect(isFlingResult({ ...valid, flings: [row, { ...row, p95: -1 }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, timing: { ...valid.timing, p95: -1 } }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, flings: [row, { ...row, blockingMs: -1 }, row] }, 3)).toBe(false);
  expect(isFlingResult({ ...valid, timing: { ...valid.timing, blockingMs: -1 } }, 3)).toBe(false);
  for (const key of ["over33", "droppedPct"] as const) {
    expect(isFlingResult({ ...valid, flings: [row, { ...row, [key]: 101 }, row] }, 3)).toBe(false);
    expect(isFlingResult({ ...valid, timing: { ...valid.timing, [key]: 101 } }, 3)).toBe(false);
    expect(isFlingResult({ ...valid, flings: [row, { ...row, [key]: -1 }, row] }, 3)).toBe(false);
    expect(isFlingResult({ ...valid, timing: { ...valid.timing, [key]: -1 } }, 3)).toBe(false);
  }
  expect(isFlingResult({ ...valid, flings: [row, { ...row, frames: 3.5 }, row] }, 3)).toBe(false);
});
const report = { version: 1, kind: "home-navigation", route: "/cash", from: "/home", trigger: "in-app", cache: "retained", device: "desktop-high", durationMs: 50 } as const;
test("refuses each Next-loadable environment file and ignores other files", () => {
  expect(firstNextEnvFile(["package.json", ".env.example"])).toBeUndefined();
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    expect(firstNextEnvFile(["package.json", name])).toBe(name);
  }
  expect(firstNextEnvFile([".env.production.local", ".env"])).toBe(".env");
});


test("patches exactly one navigation recorder cap guard and rejects drift", () => {
  expect(hasNavigationCapGuard(source)).toBe(true);
  expect(patchNavigationCap(source)).toContain("n>=1e6");
  expect(patchNavigationCap(source)).not.toContain("n>=10");
  expect(() => patchNavigationCap(source.replace(guard, ""))).toThrow();
  expect(() => patchNavigationCap(source + guard)).toThrow();
  expect(() => patchNavigationCap(guard)).toThrow();
});

test("parses only valid navigation reports and rejects wrong routes or non-desktop samples", () => {
  expect(parseNavigationReport(report)).toEqual(report);
  expect(parseNavigationReport({ version: 1, kind: "home-scroll", route: "/cash", cache: "retained", device: "desktop-high", durationMs: 50, frameCount: 3, slowFrameCount: 1, maxFrameMs: 20 })).toBeNull();
  expect(() => parseNavigationReport({ ...report, durationMs: "bad" })).toThrow();
  expect(validateNavigationSample(report, { route: "/cash", from: "/home", trigger: "in-app" })).toEqual(report);
  expect(validateNavigationSample({ ...report, cache: "first-visit" }, { route: "/cash", from: "/home", trigger: "in-app" })).toEqual({ ...report, cache: "first-visit" });
  expect(() => validateNavigationSample({ ...report, device: "mobile-high" }, { route: "/cash", from: "/home", trigger: "in-app" })).toThrow();
  expect(() => validateNavigationSample(report, { route: "/invest", from: "/home", trigger: "in-app" })).toThrow();
  expect(() => validateNavigationSample(report, { route: "/cash", from: "/invest", trigger: "in-app" })).toThrow();
  expect(() => validateNavigationSample(report, { route: "/cash", from: "/home", trigger: "history" })).toThrow();
});

const sample = (session: number, scenario: NavigationSample["scenario"], leg: NavigationSample["leg"], durationMs: number): NavigationSample => ({
  session, scenario, leg, roundTrip: 1, route: leg === "to" ? scenario === "invest" ? "/invest" : "/cash" : "/home",
  from: leg === "to" ? "/home" : scenario === "invest" ? "/invest" : "/cash", trigger: scenario === "back" && leg === "return" ? "history" : "in-app",
  cache: "retained", device: "desktop-high", durationMs,
});
const samples = [
  sample(1, "cash", "to", 10), sample(1, "cash", "return", 20), sample(1, "invest", "to", 30), sample(1, "invest", "return", 40),
  sample(1, "back", "to", 90), sample(1, "back", "return", 50),
  sample(2, "cash", "to", 60), sample(2, "cash", "return", 70), sample(2, "invest", "to", 80), sample(2, "invest", "return", 90),
  sample(2, "back", "to", 200), sample(2, "back", "return", 110),
];

test("pools p95 across sessions, separates history return from back-to, and computes baseline deltas", () => {
  const summary = summarizeNavigation(samples);
  expect(summary.groups["home-cash"].p95).toBe(70);
  expect(summary.groups["home-cash"].perSessionP95).toEqual({ "1": 20, "2": 70 });
  expect(summary.groups.back).toMatchObject({ n: 2, p95: 110, pass: false });
  expect(summary.groups["all-gated"].n).toBe(10);
  expect(summary.legs["back:to"].p95).toBe(200);
  const baseline = summarizeNavigation(samples.map((row) => ({ ...row, durationMs: row.durationMs - 10 })));
  expect(baselineDeltas(summary, baseline)["home-cash"]).toEqual({ baseline: 60, current: 70, delta: 10 });
  const currentFling = { timing: { p95: 27.199999999999818, over33: 5.56789, droppedPct: 1.2345, blockingMs: 2.66666 } };
  const baselineFling = { timing: { p95: 20, over33: 3, droppedPct: 2, blockingMs: 4 } };
  const current = { version: 1, summary, fling: currentFling, environment: { appSha: "new", headless: true, webkit: "26", chromium: "140", platform: "darwin", cpu: "test cpu", cores: 16, fixtureClock: "system" },
    options: { skipBuild: false, rows: 300, flingRepeat: 3, headed: false, smoke: false }, label: "test" };
  const previous = { version: 1, summary: baseline, fling: baselineFling, environment: { ...current.environment, appSha: "old" }, options: current.options, label: "baseline" };
  expect(baselineMismatches(current, previous)).toEqual([]);
  const markdown = navigationMarkdown(current, previous);
  expect(markdown).toContain("baseline, old");
  expect(markdown).not.toContain("Build: reused existing .next (--skip-build); provenance not verified");
  const reused = navigationMarkdown({ ...current, options: { ...current.options, skipBuild: true } }, previous);
  expect(reused).toContain("App SHA: new\nBuild: reused existing .next (--skip-build); provenance not verified");
  expect(reused).toContain("options.skipBuild");
  expect(reused).not.toContain("| Group | Baseline p95 ms");
  expect(markdown).not.toContain("Comparison suppressed");
  expect(markdown).toContain("| home-cash | 60 | 70 | +10 |");
  expect(markdown).toContain("| 27.2 | 5.57 | 1.23 | 2.67 |");
  expect(markdown).toContain("| Fling median | Baseline | Run | Δ |");
  expect(markdown).toContain("| p95 ms | 20 | 27.2 | +7.2 |");
  expect(markdown).toContain("| >33.4 ms % | 3 | 5.57 | +2.57 |");
  expect(markdown).toContain("| dropped % | 2 | 1.23 | -0.77 |");
  expect(markdown).toContain("| blocking ms | 4 | 2.67 | -1.33 |");
  expect(markdown).not.toContain("27.199999999999818");
  const fractional = structuredClone(summary);
  fractional.groups["home-cash"].p50 = 12.3456;
  fractional.groups["home-cash"].p95 = 70.4567;
  fractional.groups["home-cash"].max = 99.9999;
  fractional.groups["home-cash"].perSessionP95["1"] = 3.333333;
  fractional.legs["cash:to"].p95 = 10.55555;
  const rounded = navigationMarkdown({ ...current, summary: fractional }, previous);
  expect(rounded).toContain("| home-cash | 4 | 12.35 | 70.46 | 100 | pass |");
  expect(rounded).toContain("| cash:to | 2 | 35 | 10.56 | 60 |");
  expect(rounded).toContain("| home-cash | 1 | 3.33 |");
  expect(rounded).toContain("| home-cash | 60 | 70.46 | +10.46 |");
  expect(() => summarizeNavigation(samples.filter((row) => row.scenario !== "invest"))).toThrow();
});

const comparison = { version: 1, summary: summarizeNavigation(samples), fling: { timing: { p95: 27, over33: 4, droppedPct: 2, blockingMs: 1 } },
  environment: { appSha: "new", headless: true, webkit: "26", chromium: "140", platform: "darwin", cpu: "test cpu", cores: 16, fixtureClock: "system" },
  options: { skipBuild: false, rows: 300, flingRepeat: 3, headed: false, smoke: false, sessions: 2, roundTrips: 10 }, label: "current" };

test("matching baseline config permits comparison despite checkout, label, and sample-count differences", () => {
  const baseline = { ...comparison, environment: { ...comparison.environment, appSha: "old" },
    options: { ...comparison.options, sessions: 5, roundTrips: 20 }, label: "baseline" };
  expect(baselineMismatches(comparison, baseline)).toEqual([]);
  expect(navigationMarkdown(comparison, baseline)).toContain("| Group | Baseline p95 ms | Run p95 ms | Δ ms |");
  expect(navigationMarkdown(comparison, baseline)).not.toContain("Comparison suppressed");
});

test("fixture clock mode suppresses legacy, fixed-clock, and unknown baseline comparisons", () => {
  const { fixtureClock: _clock, ...legacyEnvironment } = comparison.environment;
  for (const [environment, reason] of [
    [legacyEnvironment, "environment.fixtureClock: missing in baseline"],
    [{ ...comparison.environment, fixtureClock: "date" }, "environment.fixtureClock"],
    [{ ...comparison.environment, fixtureClock: "playwright" }, "environment.fixtureClock"],
    [{ ...comparison.environment, fixtureClock: "unknown" }, "environment.fixtureClock: unknown in baseline"],
  ] as const) {
    const baseline = { ...comparison, environment };
    expect(baselineMismatches(comparison, baseline)).toEqual([reason]);
    const markdown = navigationMarkdown(comparison, baseline);
    expect(markdown).toContain(`Comparison suppressed because configurations differ or baseline data is missing (${reason})`);
    expect(markdown).not.toContain("| Group | Baseline p95 ms");
    expect(markdown).not.toContain("| Fling median | Baseline");
  }
  expect(baselineMismatches(comparison, { ...comparison, environment: { ...comparison.environment, fixtureClock: "system" } })).toEqual([]);
  const fixed = { ...comparison, environment: { ...comparison.environment, fixtureClock: "date" } };
  expect(navigationMarkdown(fixed, fixed)).toContain("| Group | Baseline p95 ms | Run p95 ms | Δ ms |");
  expect(baselineMismatches(fixed, fixed)).toEqual([]);
  expect(baselineMismatches({ ...comparison, environment: { ...comparison.environment, fixtureClock: "unknown" } }, comparison)).toEqual(["environment.fixtureClock: unknown in current run"]);
  expect(baselineMismatches(comparison, { ...comparison, environment: { ...comparison.environment, fixtureClock: "unknown" } })).toEqual(["environment.fixtureClock: unknown in baseline"]);
  expect(baselineMismatches({ ...comparison, environment: legacyEnvironment }, comparison)).toEqual(["environment.fixtureClock: missing in current run"]);
});

test("skip-build on either side suppresses deltas, while two verified builds compare", () => {
  for (const [currentSkip, baselineSkip] of [[true, false], [false, true], [true, true], [false, false]] as const) {
    const current = { ...comparison, options: { ...comparison.options, skipBuild: currentSkip } };
    const baseline = { ...comparison, options: { ...comparison.options, skipBuild: baselineSkip } };
    expect(baselineMismatches(current, baseline)).toEqual(currentSkip || baselineSkip ? ["options.skipBuild: unverified build provenance"] : []);
    const markdown = navigationMarkdown(current, baseline);
    if (currentSkip || baselineSkip) {
      expect(markdown).toContain("options.skipBuild: unverified build provenance");
      expect(markdown).not.toContain("| Group | Baseline p95 ms");
    } else expect(markdown).toContain("| Group | Baseline p95 ms");
  }
});
test("fling retries appear under the fling table but a single attempt does not", () => {
  const failed = { attempt: 1, ok: false };
  const successful = { attempt: 2, ok: true };
  const markdown = navigationMarkdown({ ...comparison, flingAttempts: [failed, successful] });
  expect(markdown).toContain("| 27 | 4 | 2 | 1 |\n\nFling attempts: 2 (attempt 1 failed)");
  expect(navigationMarkdown({ ...comparison, flingAttempts: [successful] })).not.toContain("Fling attempts:");
});

test("unsupported version and invalid baseline metrics suppress deltas without throwing", () => {
  const version = { ...comparison, version: 2 };
  const negative = structuredClone(comparison);
  negative.summary.groups["home-cash"].p95 = -1;
  const dropped = structuredClone(comparison);
  dropped.fling.timing.droppedPct = 999;
  for (const [baseline, reason] of [
    [version, "version: unsupported"],
    [negative, "summary.groups.home-cash.p95: invalid baseline value"],
    [dropped, "fling.timing.droppedPct: invalid baseline value"],
  ] as const) {
    expect(baselineMismatches(comparison, baseline)).toContain(reason);
    const markdown = navigationMarkdown(comparison, baseline);
    expect(markdown).toContain(reason);
    expect(markdown).not.toContain("| Group | Baseline p95 ms");
  }
});

test("malformed baseline display metadata never throws or renders objects", () => {
  const baseline = { ...comparison, label: { toString: null }, environment: { ...comparison.environment, appSha: { toString: null } } };
  expect(baselineMismatches(comparison, baseline)).toEqual([]);
  const markdown = navigationMarkdown(comparison, baseline);
  expect(markdown).toContain("## Baseline comparison (unlabelled, unknown SHA)");
  expect(markdown).not.toContain("[object Object]");
});

test("reads absent, valid, malformed, and scalar baseline contents", () => {
  const path = "relative/baseline.json";
  expect(readNavigationBaseline(undefined, path)).toEqual({ baseline: undefined, note: `No baseline file at ${path}; nothing to compare.` });
  expect(readNavigationBaseline('{"version":1}', path)).toEqual({ baseline: { version: 1 }, note: null });
  const invalidText = "private sample text is not JSON";
  expect(() => readNavigationBaseline(invalidText, path)).toThrow(`Invalid baseline JSON at ${path}:`);
  try { readNavigationBaseline(invalidText, path); } catch (error) { expect((error as Error).message).not.toContain(invalidText); }
  expect(readNavigationBaseline("null", path)).toEqual({ baseline: null, note: null });
  expect(baselineMismatches(comparison, readNavigationBaseline("null", path).baseline)).toContain("version: unsupported");
});

test("smoke runs cannot compare with non-smoke baselines, even at matching rows and fling repeats", () => {
  const smoke = { ...comparison, options: { ...comparison.options, smoke: true, sessions: 1, roundTrips: 1 } };
  expect(baselineMismatches(smoke, comparison)).toEqual(["options.smoke"]);
  expect(navigationMarkdown(smoke, comparison)).not.toContain("| Group | Baseline p95 ms");
  const { smoke: _smoke, ...options } = comparison.options;
  expect(baselineMismatches(comparison, { ...comparison, options })).toEqual(["options.smoke: missing in baseline"]);
});

test("partial baselines suppress deltas with field-specific reasons", () => {
  const withoutGroup = structuredClone(comparison);
  delete withoutGroup.summary.groups.back;
  expect(baselineMismatches(comparison, withoutGroup)).toContain("summary.groups.back: missing in baseline");
  const groupMarkdown = navigationMarkdown(comparison, withoutGroup);
  expect(groupMarkdown).toContain("summary.groups.back: missing in baseline");
  expect(groupMarkdown).not.toContain("| Group | Baseline p95 ms");
  const withoutTiming = { ...comparison, fling: {} } as unknown as typeof comparison;
  expect(baselineMismatches(comparison, withoutTiming)).toContain("fling.timing.p95: missing in baseline");
  const flingMarkdown = navigationMarkdown(comparison, withoutTiming);
  expect(flingMarkdown).toContain("fling.timing.p95: missing in baseline");
  expect(flingMarkdown).not.toContain("| Fling median | Baseline");
  const nonFinite = structuredClone(comparison);
  nonFinite.fling.timing.over33 = NaN;
  expect(baselineMismatches(comparison, nonFinite)).toContain("fling.timing.over33: missing in baseline");
});

test("null and malformed baseline objects suppress without throwing", () => {
  for (const value of [null, "junk", { options: null, environment: null, summary: null, fling: null }]) {
    expect(baselineMismatches(comparison, value)).toContain("options.rows: missing in baseline");
    expect(navigationMarkdown(comparison, value)).toContain("Comparison suppressed");
  }
  expect(baselineMismatches(null, null)).toContain("options.rows: missing in baseline");
});

test("missing baseline markdown names only the supplied baseline path", () => {
  const markdown = navigationMarkdown(comparison, undefined, "No baseline file at relative/missing.json; nothing to compare.");
  expect(markdown).toContain("## Baseline comparison\n\nNo baseline file at relative/missing.json; nothing to compare.");
  expect(markdown).not.toContain("| Group | Baseline p95 ms");
});

const mismatchCases: [string, { options?: Partial<typeof comparison.options>; environment?: Partial<typeof comparison.environment> }, string[]][] = [
  ["headed WebKit", { options: { headed: true }, environment: { headless: false } }, ["options.headed", "environment.headless"]],
  ["row count", { options: { rows: 350 } }, ["options.rows"]],
  ["WebKit version", { environment: { webkit: "27" } }, ["environment.webkit"]],
  ["CPU model", { environment: { cpu: "other cpu" } }, ["environment.cpu"]],
  ["fling repeat", { options: { flingRepeat: 4 } }, ["options.flingRepeat"]],
  ["Chromium, platform, and core count", { environment: { chromium: "141", platform: "linux", cores: 8 } },
    ["environment.chromium", "environment.platform", "environment.cores"]],
];
test.each(mismatchCases)("suppresses %s mismatches without losing run summary", (_name, overrides, expected) => {
  const baseline = { ...comparison, options: { ...comparison.options, ...overrides.options },
    environment: { ...comparison.environment, ...overrides.environment } };
  expect(baselineMismatches(comparison, baseline)).toEqual(expected);
  const markdown = navigationMarkdown(comparison, baseline);
  expect(markdown).toContain("## Baseline comparison\n\nComparison suppressed because configurations differ");
  for (const field of expected) expect(markdown).toContain(field);
  expect(markdown).toContain("the baseline is the machine/build reference only");
  expect(markdown).toContain("## Gate groups");
  expect(markdown).toContain("## Chromium 300-row fling medians");
  expect(markdown).not.toContain("| Group | Baseline p95 ms");
  expect(markdown).not.toContain("| Fling median | Baseline");
  expect(markdown).not.toContain("Δ ms");
});

test("missing baseline field is reported, not thrown, and sample counts are not mismatches", () => {
  const { rows: _rows, ...options } = comparison.options;
  const incomplete = { ...comparison, options: { ...options, sessions: 5, roundTrips: 20 } } as unknown as typeof comparison;
  expect(baselineMismatches(comparison, incomplete)).toEqual(["options.rows: missing in baseline"]);
  const markdown = navigationMarkdown(comparison, incomplete);
  expect(markdown).toContain("options.rows: missing in baseline");
  expect(markdown).toContain("sessions and roundTrips also differ but do not determine comparability");
  expect(markdown).not.toContain("| Group | Baseline p95 ms");
});

test("compacts 5×10 navigation sessions with ordered legs, rounded intervals and flings under 30 KB", () => {
  const sessions = Array.from({ length: 5 }, (_, index) => ({
    session: index + 1, capPatched: true, rafIntervals: [16.666666, 17.05, 9.99], reports: [report],
    samples: Array.from({ length: 10 }, (_, round) => samples.slice(0, 6).map((row) => ({
      ...row, session: index + 1, roundTrip: round + 1, durationMs: row.durationMs + round + 1,
    }))).flat().reverse(),
  }));
  const timing = { p95: 27.199999999999818, over33: 1.56789, droppedPct: 16.129032258, blockingMs: 0, detailOpen: 0 };
  const fling = { flings: Array.from({ length: 3 }, () => ({ p95: 27.199999999999818, over33: 1.56789, droppedPct: 16.129032258, blockingMs: 0,
    maxRows: 30, settledRows: 21, historyWrites: 2, frames: 259, scrollHost: "document" as const })), timing };
  const full = { version: 1, label: "test", startedAt: "2026-01-01T00:00:00Z", options: { sessions: 5, roundTrips: 10, skipBuild: false, rows: 300, flingRepeat: 3, headed: false, smoke: false },
    environment: { appSha: "sha", webkit: "version", chromium: "version", headless: true, platform: "darwin", cpu: "test cpu", cores: 16, fixtureClock: "system" },
    capPatched: true, summary: summarizeNavigation(sessions.flatMap((session) => session.samples)),
    sessions, fling };
  const compact = compactNavigationBaseline(full);
  expect(Object.keys(compact)).toEqual(["version", "label", "startedAt", "options", "environment", "capPatched", "summary", "sessions", "fling"]);
  expect(compact.options).toBe(full.options);
  expect(compact.environment.fixtureClock).toBe("system");
  expect(compact.summary).toBe(full.summary);
  expect(Object.keys(compact.sessions[0]!)).toEqual(["session", "device", "rafIntervals", "durations"]);
  expect(compact.sessions[0]!.device).toBe("desktop-high");
  expect(compact.sessions[0]!.rafIntervals).toEqual([16.7, 17.1, 10]);
  expect(compact.sessions[0]!.durations).toEqual({
    "cash:to": [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    "cash:return": [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    "invest:to": [31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
    "invest:return": [41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
    "back:to": [91, 92, 93, 94, 95, 96, 97, 98, 99, 100],
    "back:return": [51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
  });
  expect(compact.fling.flings[0]).toEqual({ p95: 27.2, over33: 1.57, droppedPct: 16.13, blockingMs: 0,
    maxRows: 30, settledRows: 21, historyWrites: 2, frames: 259, scrollHost: "document" });
  expect(compact.fling.timing).toBe(timing);
  expect(JSON.stringify(compact, null, 2).length).toBeLessThan(30_000);
  const comparison = { version: 1, summary: full.summary, fling, environment: full.environment, options: full.options, label: full.label };
  expect(navigationMarkdown(comparison, compact)).toContain("| p95 ms | 27.2 | 27.2 | 0 |");
  expect(navigationMarkdown(comparison, full)).toContain("| p95 ms | 27.2 | 27.2 | 0 |");
  const previousResults = { ...full, baselineComparable: false, baselineMismatches: ["options.rows"], baselineNote: "old run" };
  expect(baselineMismatches(comparison, previousResults)).toEqual([]);
  const mainScroll = { ...comparison, fling: { ...fling, flings: fling.flings.map((row) => ({ ...row, scrollHost: "main" as const })) } };
  expect(baselineMismatches(comparison, mainScroll)).toContain("fling.scrollHost");
  expect(baselineMismatches(comparison, { ...comparison, fling: { ...fling, flings: fling.flings.map(({ scrollHost: _host, ...row }) => row) } }))
    .toContain("fling.scrollHost: missing or mixed in baseline");
  expect(baselineMismatches(comparison, { ...mainScroll, fling: { ...fling, flings: [...fling.flings.slice(0, 1), ...mainScroll.fling.flings.slice(1, 2)] } }))
    .toContain("fling.scrollHost: missing or mixed in baseline");
  expect(baselineMismatches(mainScroll, { ...comparison, fling: { ...fling, flings: [...fling.flings.slice(0, 1), ...mainScroll.fling.flings.slice(1, 2)] } }))
    .toContain("fling.scrollHost: missing or mixed in baseline");
  expect(baselineMismatches(mainScroll, comparison)).toContain("fling.scrollHost");
  expect(navigationMarkdown(comparison, previousResults)).toContain("| Group | Baseline p95 ms");
  expect(sessions[0]!.samples[0]!.roundTrip).toBe(10);
});

test("reaps after a failed attempt or an accepted close timeout, not after a clean close", () => {
  const identity = "fling worker: browser 140 pid 42 profile /tmp/playwright_chromiumdev_profile-ok";
  expect(flingAttemptNeedsReap(true, `${identity}\n`)).toBe(true);
  expect(flingAttemptNeedsReap(false, `${identity}\nError: Chromium close timed out after 5 s\nfling worker: close timed out\nfling worker: writing result\n`)).toBe(true);
  expect(flingAttemptNeedsReap(false, `${identity}\nfling worker: writing result\n`)).toBe(false);
  expect(flingAttemptNeedsReap(false, `${identity}\nfling worker: close timed out later\n`)).toBe(false);

  const transcript = `fling worker: launching chromium\n${identity}\nfling worker: runFeed 1 flings starting\nError: Chromium close timed out after 5 s\nfling worker: close timed out\nfling worker: writing result\n`;
  const browser = flingAttemptNeedsReap(false, transcript) ? flingBrowserPidFromStderr(transcript) : null;
  expect(browser).toEqual({ pid: 42, profile: "/tmp/playwright_chromiumdev_profile-ok" });
  if (!browser) throw new Error("expected a reported browser identity");
  const signaled: number[] = [];
  expect(reapFlingBrowser([{ pid: 42, ppid: 1, command: "chromium --user-data-dir=/tmp/playwright_chromiumdev_profile-ok" }], browser, (pid) => signaled.push(pid))).toBe(1);
  expect(signaled).toEqual([42]);
});
