import { expect, test } from "bun:test";
import { baselineMismatches, navigationMarkdown, summarizeNavigation, type NavigationSample } from "./navigation-samples";
import { baselineEligible, flingAttemptOutcome, outcomesMarkdown, outcomesResult, tallyOutcomes, type LoggedFailure } from "./outcomes";
import { outcomeFromError, runReadiness, serverProbeDeadlineMs, stageDeadlineMs, waitHarness } from "./readiness";
import { clock } from "../../tests/helpers/readiness-timers";

const never = () => new Promise<never>(() => {});
async function classifiedOutcomes() {
  const time = clock();
  const completed = await runReadiness({ path: "/cash", leg: "cash:to", timers: time.timers,
    stages: [{ stage: "content", wait: () => Promise.resolve() }], probe: never,
    tails: () => ({ consoleTail: [], failedRequestTail: [] }) });
  const failures: LoggedFailure[] = [];
  for (const server of [false, true]) {
    const path = server ? "/invest" : "/cash", leg = server ? "invest:to" : "cash:to";
    const pending = runReadiness({ path, leg, cycle: 2, timers: time.timers,
      stages: [{ stage: "url", wait: () => Promise.resolve() }, { stage: "busy-panel", wait: () => Promise.resolve() }, { stage: "content", wait: never }],
      probe: server ? never : () => Promise.resolve({ status: 200, ttfbMs: 41, error: null }),
      tails: () => ({ consoleTail: ["a warning"], failedRequestTail: ["GET /data"] }) }).catch((error: unknown) => error);
    await time.advance(stageDeadlineMs + (server ? serverProbeDeadlineMs : 0));
    const failure = outcomeFromError(await pending, { path, leg });
    if (!failure || failure.outcome === "completed") throw new Error("Expected a non-completed outcome");
    failures.push({ ...failure, outcome: failure.outcome, session: 1, roundTrip: 2 });
  }
  const pending = waitHarness("report-arrival", never(), 15_000, time.timers).catch((error: unknown) => error);
  await time.advance(15_000);
  const harness = outcomeFromError(await pending, { path: "/home", leg: "cash:return", cycle: 3 });
  if (!harness || harness.outcome === "completed") throw new Error("Expected a harness outcome");
  failures.push({ ...harness, outcome: harness.outcome, session: 1, roundTrip: 3 });
  return { completed, failures };
}
const sample = (durationMs: number): NavigationSample => ({ route: "/cash", from: "/home", trigger: "in-app", cache: "retained",
  device: "desktop-high", durationMs, session: 1, roundTrip: 1, scenario: "cash", leg: "to" });
const comparison = { version: 1, summary: summarizeNavigation([sample(10), sample(30)]),
  fling: { timing: { p95: 20, over33: 5, droppedPct: 2, blockingMs: 1 } },
  environment: { appSha: "test-sha", headless: true, webkit: "26", chromium: "140", platform: "test", cpu: "test cpu", cores: 4, fixtureClock: "system" },
  options: { skipBuild: false, rows: 300, flingRepeat: 1, headed: false, smoke: true }, label: null };

test("real readiness and harness outcomes tally separately by destination and leg", async () => {
  const { completed, failures } = await classifiedOutcomes();
  expect(completed.outcome).toBe("completed");
  expect(failures.map((failure) => failure.outcome)).toEqual(["readiness-failure", "server-response-failure", "harness-wait-failure"]);
  const [first] = failures;
  if (!first || completed.leg === null) throw new Error("Expected classified outcomes");
  expect(tallyOutcomes([{ path: completed.path, leg: completed.leg }], failures)).toEqual([
    { group: null, path: "/cash", leg: "cash:to", completed: 1, serverResponseFailures: 0, readinessFailures: 1, harnessWaitFailures: 0 },
    { group: null, path: "/home", leg: "cash:return", completed: 0, serverResponseFailures: 0, readinessFailures: 0, harnessWaitFailures: 1 },
    { group: null, path: "/invest", leg: "invest:to", completed: 0, serverResponseFailures: 1, readinessFailures: 0, harnessWaitFailures: 0 },
  ]);
  const grouped = tallyOutcomes([{ group: "z", path: "/home", leg: "return" }, { group: "a", path: "/cash", leg: "to" }],
    [{ ...first, group: "a" }]);
  expect(grouped.map((row) => row.group)).toEqual(["a", "a", "z"]);
  expect(grouped.map((row) => row.leg)).toEqual(["cash:to", "to", "return"]);
  expect(outcomesResult([{ path: "/cash", leg: "cash:to" }], failures)).toMatchObject({
    completedSamples: 1, failures, baselineEligible: false,
  });
});

test("partial or empty navigation runs summarize only completed latency samples", async () => {
  const { failures } = await classifiedOutcomes();
  const samples = [sample(10), sample(30)];
  const result = { summary: summarizeNavigation(samples), outcomes: outcomesResult(samples.map((row) => ({ path: row.route, leg: `${row.scenario}:${row.leg}` })), failures) };
  expect(result.outcomes.headline).toContain("2 samples, 1 readiness failure");
  expect(result.summary.legs).toEqual({ "cash:to": { n: 2, p50: 20, p95: 30, max: 30, perSessionP95: { "1": 30 } } });
  expect(Object.keys(result.summary.groups)).toEqual(["home-cash", "all-gated"]);
  expect(result.summary.groups["all-gated"]).toMatchObject({ n: 2, p95: 30, max: 30 });
  expect(summarizeNavigation([])).toEqual({ legs: {}, groups: {} });
  expect(summarizeNavigation([{ ...sample(12), scenario: "back" }])).toMatchObject({ groups: {}, legs: { "back:to": { p95: 12 } } });
});

test("every failure category excludes a baseline, including harness-only failures", async () => {
  const { failures } = await classifiedOutcomes();
  expect(baselineEligible([])).toBe(true);
  expect(outcomesResult([], []).baselineEligible).toBe(true);
  for (const failure of failures) {
    expect(baselineEligible([failure])).toBe(false);
    const current = { ...comparison, outcomes: outcomesResult([], [failure]) };
    expect(baselineMismatches(current, comparison)).toEqual(["outcomes: run has failures"]);
    const markdown = navigationMarkdown(current, comparison);
    expect(markdown).not.toContain("| Group | Baseline p95 ms");
  }
});

test("navigation markdown puts outcome counts and diagnostics ahead of completed-only percentiles", async () => {
  const { failures } = await classifiedOutcomes();
  const outcomes = outcomesResult([{ path: "/cash", leg: "cash:to" }], failures);
  const markdown = navigationMarkdown({ ...comparison, outcomes });
  expect(markdown).toContain(`App SHA: test-sha\n\n## Outcomes\n\n${outcomes.headline}`);
  expect(markdown.indexOf("## Outcomes")).toBeLessThan(markdown.indexOf("## Gate groups"));
  expect(markdown).toContain("| /cash | cash:to | 1 | 0 | 1 | 0 |");
  expect(markdown).toContain("| /home | cash:return | 0 | 0 | 0 | 1 |");
  expect(markdown).toContain("| /invest | invest:to | 0 | 1 | 0 | 0 |");
  expect(markdown).toContain("**Not a clean run:");
  expect(markdown).toContain("not eligible to update the committed baseline.");
  expect(markdown).toContain("Percentiles cover completed samples only");
  expect(markdown).toContain("readiness-failure: /cash / cash:to / cycle 2 / session 1");
  expect(markdown).toContain("last stage reached busy-panel; failed stage content after 20000 ms; server status 200; TTFB 41 ms; console tail 1; request tail 1");
  expect(markdown).toContain("server probe error: Server response probe exceeded 5000 ms");
  expect(markdown).toContain("wait report-arrival; deadline 15000 ms; elapsed 15000 ms");
  const clean = navigationMarkdown({ ...comparison, outcomes: outcomesResult([{ path: "/cash", leg: "cash:to" }], []) });
  expect(clean).not.toContain("Not a clean run");
  expect(clean).not.toContain("Percentiles cover completed samples only");
});

test("outcome markdown escapes table text, includes groups only when present and caps diagnostics", async () => {
  const { failures } = await classifiedOutcomes();
  const [first] = failures;
  if (!first) throw new Error("Expected a failure");
  const failure = { ...first, group: "a|b", path: "/cash|test", leg: "cash|to" };
  const repeated = Array.from({ length: 53 }, () => failure);
  const markdown = outcomesMarkdown(tallyOutcomes([], repeated), repeated, 0, "### Outcomes").join("\n");
  expect(markdown).toContain("### Outcomes");
  expect(markdown).toContain("| Group | Path | Leg |");
  expect(markdown).toContain("| a\\|b | /cash\\|test | cash\\|to |");
  expect(markdown).toContain("readiness-failure: /cash\\|test / cash\\|to");
  expect(markdown.match(/^- readiness-failure:/gm)).toHaveLength(50);
  expect(markdown).toContain("3 additional failures omitted.");
  const plain = outcomesMarkdown([], [], 0).join("\n");
  expect(plain).not.toContain("| Group |");
  expect(plain).toContain("| Path | Leg | Completed | Server-response failures | Readiness failures | Harness-wait failures |");
});

test("only failed fling attempts before fixture readiness are harness waits", () => {
  expect(flingAttemptOutcome(true, "fling worker: launching chromium\n")).toBe("harness-wait-failure");
  expect(flingAttemptOutcome(true, "")).toBe("harness-wait-failure");
  expect(flingAttemptOutcome(true, "fling worker: fixture ready\nfling worker: runFeed 1 flings starting\n")).toBeNull();
  expect(flingAttemptOutcome(false, "")).toBeNull();
  expect(flingAttemptOutcome(false, "fling worker: fixture ready")).toBeNull();
});
