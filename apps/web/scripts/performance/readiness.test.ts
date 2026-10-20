import { expect, test } from "bun:test";
import { clipTail, HarnessWaitFailure, outcomeFromError, ReadinessFailure,
  readinessBudgetMs, redactUrl, runReadiness, serverProbeDeadlineMs, stageDeadlineMs, waitHarness,
  type HarnessWait, type ReadinessStage, type ServerResponse } from "./readiness";
import { clock, flush } from "../../tests/helpers/readiness-timers";

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {}, reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const emptyTails = () => ({ consoleTail: [], failedRequestTail: [] });
const healthyServer: ServerResponse = { status: 200, ttfbMs: 41, error: null };
const never = () => new Promise<never>(() => {});
const stalledContent = (): { stage: ReadinessStage; wait: () => Promise<unknown> }[] => [
  { stage: "url" as const, wait: () => Promise.resolve() },
  { stage: "busy-panel" as const, wait: () => Promise.resolve() },
  { stage: "content" as const, wait: never },
];
async function failureOf(promise: Promise<unknown>): Promise<ReadinessFailure> {
  try { await promise; } catch (error) {
    if (error instanceof ReadinessFailure) return error;
    throw error;
  }
  throw new Error("Expected a classified readiness failure");
}

test("completed readiness preserves each sequential stage timing without probing", async () => {
  const time = clock(), url = deferred(), busy = deferred(), content = deferred();
  let probes = 0;
  const completed = runReadiness({ path: "/cash", leg: "outbound", cycle: 3, timers: time.timers, tails: emptyTails,
    probe: () => { probes++; return Promise.resolve(healthyServer); }, stages: [
      { stage: "url", wait: () => url.promise }, { stage: "busy-panel", wait: () => busy.promise }, { stage: "content", wait: () => content.promise },
    ] });
  await time.advance(100); url.resolve(); await flush();
  await time.advance(212); busy.resolve(); await flush();
  await time.advance(33); content.resolve();
  expect(await completed).toMatchObject({ outcome: "completed", path: "/cash", leg: "outbound", cycle: 3,
    failedStage: null, lastStageReached: "content", elapsedMs: 345, server: null, cause: null,
    stages: [{ stage: "url", elapsedMs: 100, reached: true }, { stage: "busy-panel", elapsedMs: 212, reached: true },
      { stage: "content", elapsedMs: 33, reached: true }] });
  expect(probes).toBe(0);
  expect(time.pending.size).toBe(0);
});

test("a healthy document with missing content reports the failed stage, last milestone and wait", async () => {
  const time = clock(), url = deferred(), busy = deferred();
  let probes = 0;
  const failure = failureOf(runReadiness({ path: "/cash", timers: time.timers, tails: emptyTails,
    probe: () => { probes++; return Promise.resolve(healthyServer); }, stages: [
      { stage: "url", wait: () => url.promise }, { stage: "busy-panel", wait: () => busy.promise }, { stage: "content", wait: never },
    ] }));
  await time.advance(100); url.resolve(); await flush();
  await time.advance(212); busy.resolve(); await flush();
  await time.advance(stageDeadlineMs);
  const error = await failure;
  expect(error.diagnostic).toMatchObject({ outcome: "readiness-failure", failedStage: "content", lastStageReached: "busy-panel",
    elapsedMs: 20_312, server: healthyServer, stages: [
      { stage: "url", elapsedMs: 100, reached: true }, { stage: "busy-panel", elapsedMs: 212, reached: true },
      { stage: "content", elapsedMs: 20_000, reached: false }] });
  expect(error.message).toContain("/cash (readiness-failure): destination content not rendered");
  expect(error.message).toContain("last stage reached busy-panel at 312 ms; content waited 20000 ms; server 200 in 41 ms");
  expect(error.message).toContain("console tail 0, failed-request tail 0");
  expect(probes).toBe(1);
  expect(time.pending.size).toBe(0);
});

test("a never-answering probe is bounded, classified as a server failure and tolerates late rejection", async () => {
  const time = clock(), probe = deferred<ServerResponse | null>(), stage = deferred();
  const stages = stalledContent();
  stages[2] = { stage: "content", wait: () => stage.promise };
  const failure = failureOf(runReadiness({ path: "/cash", timers: time.timers, tails: emptyTails, stages, probe: () => probe.promise }));
  await time.advance(stageDeadlineMs + serverProbeDeadlineMs);
  const error = await failure;
  expect(error.diagnostic).toMatchObject({ outcome: "server-response-failure", elapsedMs: 25_000,
    server: { status: null, ttfbMs: null, error: "Server response probe exceeded 5000 ms" } });
  expect(error.message).toContain("server error: Server response probe exceeded 5000 ms");
  expect(time.pending.size).toBe(0);
  probe.reject(new Error("late probe failure"));
  stage.reject(new Error("late page close"));
  await flush();
});

test("a 503 probe is distinct from a healthy-server readiness failure", async () => {
  const time = clock();
  const failure = failureOf(runReadiness({ path: "/cash", timers: time.timers, tails: emptyTails, stages: stalledContent(),
    probe: () => Promise.resolve({ status: 503, ttfbMs: 7, error: null }) }));
  await time.advance(stageDeadlineMs);
  const error = await failure;
  expect(error.outcome).toBe("server-response-failure");
  expect(error.message).toContain("server 503 in 7 ms");
  expect(time.pending.size).toBe(0);
});

test("unavailable probes and lower HTTP statuses remain readiness failures", async () => {
  for (const server of [null, { status: 302, ttfbMs: 1, error: null }, { status: 401, ttfbMs: 1, error: null }, { status: 404, ttfbMs: 1, error: null }]) {
    const time = clock();
    const failure = failureOf(runReadiness({ path: "/cash", timers: time.timers, tails: emptyTails, stages: stalledContent(), probe: () => Promise.resolve(server) }));
    await time.advance(stageDeadlineMs);
    expect((await failure).outcome).toBe("readiness-failure");
  }
});

test("stage rejections retain their cause and clear the stage and probe timers", async () => {
  const time = clock();
  const error = await failureOf(runReadiness({ path: "/home", timers: time.timers, tails: emptyTails,
    stages: [{ stage: "url", wait: () => Promise.reject(new Error("Page closed")) }], probe: () => Promise.resolve(null) }));
  expect(error.diagnostic).toMatchObject({ outcome: "readiness-failure", lastStageReached: null, failedStage: "url", cause: "Page closed",
    stages: [{ stage: "url", reached: false, elapsedMs: 0 }] });
  expect(error.message).toContain("cause: Page closed");
  expect(time.pending.size).toBe(0);
});

test("a rejecting probe becomes server-response-failure rather than escaping classification", async () => {
  const time = clock();
  const failure = failureOf(runReadiness({ path: "/home", timers: time.timers, tails: emptyTails,
    stages: [{ stage: "url", wait: () => Promise.reject(new Error("Page closed")) }], probe: () => Promise.reject(new Error("Connection refused")) }));
  expect((await failure).diagnostic.server).toEqual({ status: null, ttfbMs: null, error: "Connection refused" });
  expect(time.pending.size).toBe(0);
});

for (const wait of ["browser-launch", "worker-start", "fixture-start", "report-arrival"] satisfies HarnessWait[]) {
  test(`${wait} is a bounded harness wait with elapsed time and a cleared timer`, async () => {
    const time = clock();
    const failure = waitHarness(wait, never(), 1234, time.timers).catch((error: unknown) => error);
    await time.advance(1234);
    const error = await failure;
    expect(error).toBeInstanceOf(HarnessWaitFailure);
    expect(error).toMatchObject({ wait, deadlineMs: 1234, elapsedMs: 1234 });
    expect(time.cleared).toHaveLength(1);
    expect(time.pending.size).toBe(0);
  });
}

test("successful and rejected harness waits clear deadlines and preserve the original result", async () => {
  const time = clock(), pending = deferred<number>();
  const result = waitHarness("worker-start", pending.promise, 1000, time.timers);
  await time.advance(100);
  pending.resolve(42);
  expect(await result).toBe(42);
  expect(time.pending.size).toBe(0);
  const original = new Error("worker exited");
  await expect(waitHarness("worker-start", Promise.reject(original), 1000, time.timers)).rejects.toBe(original);
  expect(time.pending.size).toBe(0);
});

test("the third stage reserves probe time so the worst-case failure fits the overall budget", async () => {
  const time = clock(), url = deferred(), busy = deferred();
  const longTails = Array.from({ length: 30 }, (_, i) => `${i}:` + "x".repeat(500));
  const failure = failureOf(runReadiness({ path: "/cash", timers: time.timers, probe: never,
    tails: () => ({ consoleTail: longTails, failedRequestTail: longTails }), stages: [
      { stage: "url", wait: () => url.promise }, { stage: "busy-panel", wait: () => busy.promise }, { stage: "content", wait: never },
    ] }));
  await time.advance(19_999); url.resolve(); await flush();
  await time.advance(19_999); busy.resolve(); await flush();
  await time.advance(readinessBudgetMs - 39_998);
  const error = await failure;
  expect(error.diagnostic.elapsedMs).toBe(60_000);
  expect(error.diagnostic.stages[2]).toEqual({ stage: "content", reached: false, elapsedMs: 15_002 });
  expect(time.delays).toEqual([20_000, 20_000, 15_002, 5000]);
  for (const tail of [error.diagnostic.consoleTail, error.diagnostic.failedRequestTail]) {
    expect(tail).toHaveLength(20);
    expect(tail[0]).toStartWith("10:");
    expect(tail.every((entry) => entry.length <= 300)).toBe(true);
  }
  expect(time.pending.size).toBe(0);
  expect(clipTail(["short"])).toEqual(["short"]);
  expect(longTails[0]?.length).toBe(502);
});

test("exhausted readiness budget never starts an unbounded zero-timeout stage", async () => {
  const time = clock();
  let extraWaits = 0;
  const failure = failureOf(runReadiness({ path: "/cash", timers: time.timers, tails: emptyTails, probe: never, stages: [
    { stage: "url", wait: () => { time.elapse(readinessBudgetMs - serverProbeDeadlineMs); return Promise.resolve(); } },
    { stage: "content", wait: () => { extraWaits++; return never(); } },
  ] }));
  await flush();
  await time.advance(serverProbeDeadlineMs);
  const error = await failure;
  expect(extraWaits).toBe(0);
  expect(error.diagnostic.stages.at(-1)).toEqual({ stage: "content", reached: false, elapsedMs: 0 });
  expect(error.diagnostic.elapsedMs).toBe(60_000);
  expect(time.pending.size).toBe(0);
});

test("failed-request URL redaction removes credentials, origin, query and fragment", () => {
  expect(redactUrl("https://user:password@example.com/api/data?token=secret#private")).toBe("/api/data");
  expect(redactUrl("/cash?filter=private#section")).toBe("/cash");
  expect(redactUrl("data:text/plain,private")).toBe("/");
});

test("outcome mapping retains readiness context, adds harness context, and leaves unrelated errors unchanged", async () => {
  const time = clock();
  const failure = await failureOf(runReadiness({ path: "/cash", leg: "outbound", cycle: 2, timers: time.timers, tails: emptyTails,
    stages: [{ stage: "url", wait: () => Promise.reject(new Error("Page closed")) }], probe: () => Promise.resolve(null) }));
  expect(outcomeFromError(failure, { path: "/other", leg: "home" })).toEqual({ outcome: "readiness-failure", path: "/cash",
    leg: "outbound", cycle: 2, detail: failure.diagnostic, message: failure.message });
  const harness = new HarnessWaitFailure("report-arrival", 50, 51);
  expect(outcomeFromError(harness, { path: "/home", leg: "back", cycle: 4 })).toEqual({ outcome: "harness-wait-failure", path: "/home",
    leg: "back", cycle: 4, detail: { wait: "report-arrival", deadlineMs: 50, elapsedMs: 51 }, message: harness.message });
  expect(outcomeFromError(harness, { path: "/home", leg: null })?.cycle).toBeNull();
  expect(outcomeFromError(new Error("Unrelated failure"), { path: "/cash", leg: null })).toBeNull();
  expect(outcomeFromError("timeout", { path: "/cash", leg: null })).toBeNull();
});
