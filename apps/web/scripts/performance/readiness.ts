export const readinessStages = ["url", "busy-panel", "content"] as const;
export type ReadinessStage = typeof readinessStages[number];
export const stageDeadlineMs = 20_000;
export const readinessBudgetMs = 60_000;
export const serverProbeDeadlineMs = 5_000;
export const diagnosticTailLimit = 20;
export const diagnosticEntryChars = 300;

export const outcomes = ["completed", "server-response-failure", "readiness-failure", "harness-wait-failure"] as const;
export type Outcome = typeof outcomes[number];
export type HarnessWait = "browser-launch" | "worker-start" | "fixture-start" | "report-arrival";
export type Timers = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};
export const realTimers: Timers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export type ServerResponse = { status: number | null; ttfbMs: number | null; error: string | null };
export type StageRecord = { stage: ReadinessStage; elapsedMs: number; reached: boolean };
export type ReadinessDiagnostic = {
  path: string;
  leg: string | null;
  cycle: number | null;
  outcome: "completed" | "server-response-failure" | "readiness-failure";
  failedStage: ReadinessStage | null;
  lastStageReached: ReadinessStage | null;
  stages: StageRecord[];
  elapsedMs: number;
  server: ServerResponse | null;
  consoleTail: string[];
  failedRequestTail: string[];
  cause: string | null;
};

export function clipTail(entries: string[]): string[] {
  return entries.slice(-diagnosticTailLimit).map((entry) => entry.slice(0, diagnosticEntryChars));
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://readiness.invalid");
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.pathname : "/";
  } catch { return "/"; }
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const milliseconds = (value: number) => `${Math.round(value)} ms`;

export class ReadinessFailure extends Error {
  diagnostic: ReadinessDiagnostic;
  outcome: ReadinessDiagnostic["outcome"];

  constructor(diagnostic: ReadinessDiagnostic) {
    const failed = diagnostic.stages.find((record) => !record.reached);
    const reachedMs = diagnostic.stages.filter((record) => record.reached).reduce((sum, record) => sum + record.elapsedMs, 0);
    const reason = diagnostic.failedStage === "content" ? "destination content not rendered"
      : diagnostic.failedStage === "busy-panel" ? "navigation panel remained busy" : "destination URL not reached";
    const server = diagnostic.server;
    const response = server === null ? "server probe unavailable"
      : server.status === null ? `server error: ${server.error ?? "no response"}`
        : `server ${server.status} in ${server.ttfbMs === null ? "unknown time" : milliseconds(server.ttfbMs)}`;
    super(`Readiness failure on ${diagnostic.path} (${diagnostic.outcome}): ${reason}; last stage reached ${diagnostic.lastStageReached ?? "none"} at ${milliseconds(reachedMs)}; ${diagnostic.failedStage ?? "unknown stage"} waited ${milliseconds(failed?.elapsedMs ?? 0)}; ${response}; console tail ${diagnostic.consoleTail.length}, failed-request tail ${diagnostic.failedRequestTail.length}${diagnostic.cause === null ? "" : `; cause: ${diagnostic.cause}`}`);
    this.name = "ReadinessFailure";
    this.diagnostic = diagnostic;
    this.outcome = diagnostic.outcome;
  }
}

export class HarnessWaitFailure extends Error {
  constructor(public wait: HarnessWait, public deadlineMs: number, public elapsedMs: number) {
    super(`Harness wait failure: ${wait} exceeded ${milliseconds(deadlineMs)} deadline after ${milliseconds(elapsedMs)}`);
    this.name = "HarnessWaitFailure";
  }
}

class Deadline extends Error {}

async function withinDeadline<T>(wait: () => Promise<T>, deadlineMs: number, timers: Timers): Promise<T> {
  if (deadlineMs <= 0) throw new Deadline();
  let handle: unknown;
  const deadline = new Promise<never>((_, reject) => {
    handle = timers.setTimeout(() => reject(new Deadline()), deadlineMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(wait), deadline]);
  } finally { timers.clearTimeout(handle); }
}

/** @public Bounded lifecycle waits shared by performance harness entry points. */
export async function waitHarness<T>(wait: HarnessWait, promise: Promise<T>, deadlineMs: number, timers: Timers = realTimers): Promise<T> {
  const started = timers.now();
  try { return await withinDeadline(() => promise, deadlineMs, timers); }
  catch (error) {
    if (!(error instanceof Deadline)) throw error;
    throw new HarnessWaitFailure(wait, deadlineMs, timers.now() - started);
  }
}

export async function runReadiness({ path, leg, cycle, stages, probe, tails, timers = realTimers }: {
  path: string;
  leg?: string;
  cycle?: number;
  stages: { stage: ReadinessStage; wait: () => Promise<unknown> }[];
  probe: () => Promise<ServerResponse | null>;
  tails: () => { consoleTail: string[]; failedRequestTail: string[] };
  timers?: Timers;
}): Promise<ReadinessDiagnostic> {
  const started = timers.now();
  const records: StageRecord[] = [];
  let lastStageReached: ReadinessStage | null = null;
  const diagnostic = (failedStage: ReadinessStage | null, server: ServerResponse | null, cause: string | null): ReadinessDiagnostic => {
    const tail = tails();
    return { path, leg: leg ?? null, cycle: cycle ?? null,
      outcome: failedStage === null ? "completed"
        : server !== null && (server.status === null || server.status >= 500) ? "server-response-failure" : "readiness-failure",
      failedStage, lastStageReached, stages: records, elapsedMs: timers.now() - started, server,
      consoleTail: clipTail(tail.consoleTail), failedRequestTail: clipTail(tail.failedRequestTail), cause };
  };
  for (const { stage, wait } of stages) {
    const stageStarted = timers.now();
    const deadlineMs = Math.max(0, Math.min(stageDeadlineMs, readinessBudgetMs - serverProbeDeadlineMs - (stageStarted - started)));
    try {
      await withinDeadline(wait, deadlineMs, timers);
    } catch (error) {
      records.push({ stage, elapsedMs: deadlineMs <= 0 ? 0 : timers.now() - stageStarted, reached: false });
      let server: ServerResponse | null;
      try { server = await withinDeadline(probe, serverProbeDeadlineMs, timers); }
      catch (probeError) {
        server = { status: null, ttfbMs: null, error: probeError instanceof Deadline
          ? `Server response probe exceeded ${serverProbeDeadlineMs} ms` : errorText(probeError) };
      }
      throw new ReadinessFailure(diagnostic(stage, server, error instanceof Deadline ? null : errorText(error)));
    }
    records.push({ stage, elapsedMs: timers.now() - stageStarted, reached: true });
    lastStageReached = stage;
  }
  return diagnostic(null, null, null);
}

export type OutcomeRecord = {
  outcome: Outcome;
  path: string;
  leg: string | null;
  cycle: number | null;
  detail: ReadinessDiagnostic | { wait: HarnessWait; deadlineMs: number; elapsedMs: number } | null;
  message: string;
};

/** @public Classified errors consumed by performance result and summary writers. */
export function outcomeFromError(error: unknown, ctx: { path: string; leg: string | null; cycle?: number | null }): OutcomeRecord | null {
  if (error instanceof ReadinessFailure) {
    const { path, leg, cycle, outcome } = error.diagnostic;
    return { path, leg, cycle, outcome, detail: error.diagnostic, message: error.message };
  }
  if (error instanceof HarnessWaitFailure) {
    return { ...ctx, cycle: ctx.cycle ?? null, outcome: "harness-wait-failure",
      detail: { wait: error.wait, deadlineMs: error.deadlineMs, elapsedMs: error.elapsedMs }, message: error.message };
  }
  return null;
}
