import { type OutcomeRecord } from "./readiness";

export type LoggedFailure = OutcomeRecord & {
  outcome: Exclude<OutcomeRecord["outcome"], "completed">;
  group?: string;
  session?: number | null;
  roundTrip?: number | null;
};
export type OutcomeTally = {
  group: string | null;
  path: string;
  leg: string;
  completed: number;
  serverResponseFailures: number;
  readinessFailures: number;
  harnessWaitFailures: number;
};
type CompletedSample = { group?: string; path: string; leg: string };

export function tallyOutcomes(completed: CompletedSample[], failures: LoggedFailure[]): OutcomeTally[] {
  const rows = new Map<string, OutcomeTally>();
  const rowFor = ({ group, path, leg }: { group?: string; path: string; leg: string | null }) => {
    const key = JSON.stringify([group ?? null, path, leg ?? "unlabelled"]);
    let row = rows.get(key);
    if (!row) {
      row = { group: group ?? null, path, leg: leg ?? "unlabelled", completed: 0,
        serverResponseFailures: 0, readinessFailures: 0, harnessWaitFailures: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const sample of completed) rowFor(sample).completed++;
  for (const failure of failures) {
    const row = rowFor(failure);
    if (failure.outcome === "server-response-failure") row.serverResponseFailures++;
    else if (failure.outcome === "readiness-failure") row.readinessFailures++;
    else row.harnessWaitFailures++;
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return [...rows.values()].sort((a, b) => compare(a.group ?? "", b.group ?? "") || Number(a.group !== null) - Number(b.group !== null)
    || compare(a.path, b.path) || compare(a.leg, b.leg));
}

const countLabel = (count: number, label: string) => `${count} ${label}${count === 1 ? "" : "s"}`;
export function outcomeHeadline(completedCount: number, failures: LoggedFailure[]): string {
  const count = (outcome: LoggedFailure["outcome"]) => failures.filter((failure) => failure.outcome === outcome).length;
  const server = count("server-response-failure"), harness = count("harness-wait-failure");
  return `${countLabel(completedCount, "sample")}, ${countLabel(count("readiness-failure"), "readiness failure")}`
    + (server ? `, ${countLabel(server, "server-response failure")}` : "")
    + (harness ? `, ${countLabel(harness, "harness-wait failure")}` : "");
}

export function baselineEligible(failures: LoggedFailure[]): boolean { return failures.length === 0; }

const escape = (text: string) => text.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
const milliseconds = (value: number) => `${Math.round(value)} ms`;
function failureBullet(failure: LoggedFailure): string {
  const context = [failure.path, failure.leg ?? "unlabelled",
    ...(failure.cycle == null ? [] : [`cycle ${failure.cycle}`]),
    ...(failure.session == null ? [] : [`session ${failure.session}`]),
    ...(failure.roundTrip == null || failure.roundTrip === failure.cycle ? [] : [`round trip ${failure.roundTrip}`])].join(" / ");
  const detail = failure.detail;
  let diagnostic = failure.message;
  if (detail && "wait" in detail) {
    diagnostic = `wait ${detail.wait}; deadline ${milliseconds(detail.deadlineMs)}; elapsed ${milliseconds(detail.elapsedMs)}`;
  } else if (detail) {
    const failed = detail.stages.find((stage) => !stage.reached);
    const server = detail.server;
    const response = !server ? "server probe unavailable" : server.status === null
      ? `server probe error: ${server.error ?? "no response"}`
      : `server status ${server.status}; TTFB ${server.ttfbMs === null ? "unknown" : milliseconds(server.ttfbMs)}`;
    diagnostic = `last stage reached ${detail.lastStageReached ?? "none"}; failed stage ${detail.failedStage ?? "none"} after ${milliseconds(failed?.elapsedMs ?? detail.elapsedMs)}; ${response}; console tail ${detail.consoleTail.length}; request tail ${detail.failedRequestTail.length}`;
  }
  return `- ${escape(failure.outcome)}: ${escape(context)}; ${escape(diagnostic)}`;
}

export function outcomesMarkdown(tallies: OutcomeTally[], failures: LoggedFailure[], completedCount: number, heading = "## Outcomes"): string[] {
  const grouped = tallies.some((row) => row.group !== null);
  const lines = [escape(heading), "", outcomeHeadline(completedCount, failures), "",
    `| ${grouped ? "Group | " : ""}Path | Leg | Completed | Server-response failures | Readiness failures | Harness-wait failures |`,
    `|${grouped ? "---|" : ""}---|---|---:|---:|---:|---:|`,
    ...tallies.map((row) => `| ${grouped ? `${escape(row.group ?? "—")} | ` : ""}${escape(row.path)} | ${escape(row.leg)} | ${row.completed} | ${row.serverResponseFailures} | ${row.readinessFailures} | ${row.harnessWaitFailures} |`), ""];
  if (failures.length) {
    lines.push("**Not a clean run: non-completed outcomes are not latency samples; this run is not eligible to update the committed baseline.**", "",
      ...failures.slice(0, 50).map(failureBullet));
    if (failures.length > 50) lines.push(`- ${failures.length - 50} additional failures omitted.`);
    lines.push("");
  }
  return lines;
}

export function outcomesResult(completed: CompletedSample[], failures: LoggedFailure[]) {
  return { headline: outcomeHeadline(completed.length, failures), completedSamples: completed.length, failures,
    byLeg: tallyOutcomes(completed, failures), baselineEligible: baselineEligible(failures) };
}

export function flingAttemptOutcome(failed: boolean, stderr: string): "harness-wait-failure" | null {
  return failed && !stderr.includes("fling worker: fixture ready") ? "harness-wait-failure" : null;
}
