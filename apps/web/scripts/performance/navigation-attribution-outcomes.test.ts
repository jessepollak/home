import { describe, expect, test } from "bun:test";
import { attributeWindow } from "./attribution";
import { aggregateAttribution, aggregateWebKit, attributionMarkdown, recordClassified,
  type NavigationAttributionReport, type NavigationAttributionSample, type WebKitSample } from "./navigation-attribution";
import { outcomesResult, type LoggedFailure } from "./outcomes";
import { outcomeFromError, runReadiness, serverProbeDeadlineMs, stageDeadlineMs, waitHarness } from "./readiness";
import { clock } from "../../tests/helpers/readiness-timers";

const never = () => new Promise<never>(() => {});
async function stalledReadiness(server: boolean) {
  const time = clock();
  const pending = runReadiness({ path: server ? "/invest" : "/cash", leg: server ? "home" : "outbound", cycle: 2,
    timers: time.timers, stages: [{ stage: "content", wait: never }],
    probe: server ? never : () => Promise.resolve({ status: 200, ttfbMs: 41, error: null }),
    tails: () => ({ consoleTail: [], failedRequestTail: [] }) }).catch((error: unknown) => error);
  await time.advance(stageDeadlineMs + (server ? serverProbeDeadlineMs : 0));
  return pending;
}
function outcomeReport(failures: LoggedFailure[] = []): NavigationAttributionReport {
  const samples: NavigationAttributionSample[] = [{ path: "/borrow", leg: "outbound", cycle: 1, latencyMs: 20,
    ...attributeWindow([], { start: 0, end: 100_000 }), loaf: null, loafFrames: null, react: null, reactReason: null }];
  const webkit: WebKitSample[] = [{ path: "/borrow", leg: "home", cycle: 1, latencyMs: 30,
    frameGaps: [16, 17], frameGapP95Ms: 17, frameGapMaxMs: 17, longFrameCount: 0 }];
  return { rows: 300, pooling: "cycles and measured legs per path", samples, plainLatenciesByPath: {}, react: null,
    chromium: [aggregateAttribution("/borrow", samples, []), aggregateAttribution("/cash", [], [], null)],
    webkit: { browser: null, samples: webkit, errors: [], paths: [aggregateWebKit("/borrow", webkit), aggregateWebKit("/invest", [])] },
    outcomes: outcomesResult([...samples.map(({ path, leg }) => ({ group: "chromium", path, leg })),
      ...webkit.map(({ path, leg }) => ({ group: "webkit", path, leg }))], failures) };
}

describe("attribution outcomes", () => {
  test("real readiness and server failures precede completed-only timing tables with zero-sample failed paths", async () => {
    const failures: LoggedFailure[] = [];
    for (const server of [false, true]) {
      const failure = outcomeFromError(await stalledReadiness(server), { path: "/fallback", leg: null });
      if (!failure || failure.outcome === "completed") throw new Error("Expected a classified failure");
      failures.push({ ...failure, outcome: failure.outcome, group: server ? "webkit" : "chromium" });
    }
    const markdown = attributionMarkdown(outcomeReport(failures)).join("\n");
    expect(markdown).toContain("### Outcomes\n\n2 samples, 1 readiness failure, 1 server-response failure");
    expect(markdown.indexOf("### Outcomes")).toBeLessThan(markdown.indexOf("### Chromium"));
    expect(markdown).toContain("| chromium | /cash | outbound | 0 | 0 | 1 | 0 |");
    expect(markdown).toContain("| webkit | /invest | home | 0 | 1 | 0 | 0 |");
    expect(markdown).toContain("| chromium | /borrow | outbound | 1 | 0 | 0 | 0 |");
    expect(markdown).toContain("| webkit | /borrow | home | 1 | 0 | 0 | 0 |");
    const chromiumTable = markdown.split("### Chromium")[1]?.split("#### Main thread")[0];
    expect(chromiumTable).toContain("| /cash | 0 | — | — | — | 0 | — | — |");
    expect(markdown).toContain("| /invest | 0 | — | — | 0 | — | — | — |");
    expect(markdown).toContain("percentiles and latency tables use completed samples only");
    expect(markdown).toContain("Not a clean run");
  });
  test("clean attribution states zero readiness failures without a not-clean warning", () => {
    const markdown = attributionMarkdown(outcomeReport()).join("\n");
    expect(markdown).toContain("### Outcomes\n\n2 samples, 0 readiness failures");
    expect(markdown).not.toContain("Not a clean run");
  });
  test("failed Home returns share the scenario tally row with completed returns in both engines", async () => {
    const time = clock();
    const pending = runReadiness({ path: "/home", leg: "home", cycle: 2, timers: time.timers,
      stages: [{ stage: "url", wait: () => Promise.resolve() }, { stage: "busy-panel", wait: () => Promise.resolve() }, { stage: "content", wait: never }],
      probe: () => Promise.resolve({ status: 200, ttfbMs: 41, error: null }),
      tails: () => ({ consoleTail: [], failedRequestTail: [] }) }).catch((error: unknown) => error);
    await time.advance(stageDeadlineMs);
    const error = await pending;
    const outcome = outcomeFromError(error, { path: "/cash", leg: "home" });
    expect(outcome).toMatchObject({ path: "/home", leg: "home", outcome: "readiness-failure" });
    for (const group of ["chromium", "webkit"]) {
      const failures: LoggedFailure[] = [];
      recordClassified(error, { group, paths: ["/cash"] }, failures);
      const result = outcomesResult([{ group, path: "/cash", leg: "home" }], failures);
      expect(result.byLeg).toEqual([{ group, path: "/cash", leg: "home", completed: 1,
        readinessFailures: 1, serverResponseFailures: 0, harnessWaitFailures: 0 }]);
      expect(failures).toMatchObject([{ path: "/cash", detail: { path: "/home", leg: "home", failedStage: "content", lastStageReached: "busy-panel" } }]);
    }
  });
  test("classification records scenario paths or labels and rethrows unrelated errors", async () => {
    const failures: LoggedFailure[] = [];
    const readiness = await stalledReadiness(false);
    expect(() => recordClassified(readiness, { group: "chromium", paths: ["/fallback"] }, failures)).not.toThrow();
    expect(failures).toMatchObject([{ group: "chromium", path: "/fallback", leg: "outbound", cycle: 2, outcome: "readiness-failure", detail: { path: "/cash" } }]);
    recordClassified(readiness, { group: "react", paths: ["Back (Home tab)", "Back (browser history)"] }, failures);
    expect(failures.slice(1)).toMatchObject([{ group: "react", path: "Back (Home tab)" }, { group: "react", path: "Back (browser history)" }]);
    const time = clock();
    const pending = waitHarness("browser-launch", never(), 120_000, time.timers).catch((error: unknown) => error);
    await time.advance(120_000);
    recordClassified(await pending, { group: "webkit", paths: ["browser-launch"] }, failures);
    expect(failures.at(-1)).toMatchObject({ group: "webkit", path: "browser-launch", leg: null, outcome: "harness-wait-failure" });
    const report = outcomeReport(failures);
    expect(report.outcomes.byLeg.filter((row) => row.group === "react").map((row) => row.completed)).toEqual([0, 0]);
    const unrelated = new Error("Trace data loss");
    expect(() => recordClassified(unrelated, { group: "chromium", paths: ["/cash"] }, failures)).toThrow(unrelated);
    expect(failures).toHaveLength(4);
  });
});
