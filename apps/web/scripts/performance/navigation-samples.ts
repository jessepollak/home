import { parseClientPerformanceReport, type HomeNavigationReport } from "../../shared/observability/client-performance.contract";
import { median, percentile } from "./evaluate";

export type Scenario = "cash" | "invest" | "back";
export type Leg = "to" | "return";
export type NavigationSample = Pick<HomeNavigationReport, "route" | "from" | "trigger" | "cache" | "device" | "durationMs"> & {
  session: number; roundTrip: number; scenario: Scenario; leg: Leg;
};
export type Metrics = { n: number; p50: number; p95: number; max: number; perSessionP95: Record<string, number> };
export type NavigationSummary = { groups: Record<string, Metrics & { pass?: boolean }>; legs: Record<string, Metrics> };

const nextEnvFiles = [".env", ".env.local", ".env.production", ".env.production.local"] as const;
export function firstNextEnvFile(existingNames: readonly string[]): string | undefined {
  return nextEnvFiles.find((name) => existingNames.includes(name));
}

const guard = /if\(!\w+\(\)\|\|(\w+)>=10\|\|\w+===\w+\|\|!\w+\.isVisible\(\)\)return;/g;
export function hasNavigationCapGuard(source: string): boolean {
  return source.includes('kind:"home-navigation"') && new RegExp(guard.source).test(source);
}
export function patchNavigationCap(source: string): string {
  if (!source.includes('kind:"home-navigation"')) throw new Error("Navigation recorder marker missing");
  let count = 0;
  const patched = source.replace(guard, (match) => {
    count++;
    return match.replace(">=10", ">=1e6");
  });
  if (count !== 1) throw new Error(`Expected one navigation cap guard; found ${count}`);
  return patched;
}

export function parseNavigationReport(body: unknown): HomeNavigationReport | null {
  if (typeof body !== "object" || body === null || !('kind' in body) || body.kind !== "home-navigation") return null;
  const parsed = parseClientPerformanceReport(body);
  if (parsed === null) throw new Error("Invalid client performance report");
  return parsed.kind === "home-navigation" ? parsed : null;
}

export function validateNavigationSample(report: HomeNavigationReport, expected: Pick<HomeNavigationReport, "route" | "from" | "trigger">): HomeNavigationReport {
  if (report.route !== expected.route || report.from !== expected.from || report.trigger !== expected.trigger || !report.device.startsWith("desktop-")) {
    throw new Error(`Unexpected navigation report: ${JSON.stringify(report)}; expected ${JSON.stringify(expected)} on desktop`);
  }
  return report;
}

function metrics(samples: NavigationSample[]): Metrics {
  if (!samples.length) throw new Error("No navigation samples");
  const values = samples.map((sample) => sample.durationMs);
  const sessions = [...new Set(samples.map((sample) => sample.session))];
  return { n: values.length, p50: median(values), p95: percentile(values, 0.95), max: Math.max(...values),
    perSessionP95: Object.fromEntries(sessions.map((session) => [session, percentile(samples.filter((sample) => sample.session === session).map((sample) => sample.durationMs), 0.95)])) };
}

export function summarizeNavigation(samples: NavigationSample[]): NavigationSummary {
  const legs = Object.fromEntries((["cash", "invest", "back"] as const).flatMap((scenario) => (["to", "return"] as const).map((leg) => {
    const subset = samples.filter((sample) => sample.scenario === scenario && sample.leg === leg);
    return [`${scenario}:${leg}`, metrics(subset)];
  }))) as Record<string, Metrics>;
  const groups: NavigationSummary["groups"] = {};
  for (const [name, subset] of [
    ["home-cash", samples.filter((sample) => sample.scenario === "cash")],
    ["home-invest", samples.filter((sample) => sample.scenario === "invest")],
    ["back", samples.filter((sample) => sample.scenario === "back" && sample.leg === "return")],
  ] as const) groups[name] = { ...metrics(subset), pass: metrics(subset).p95 <= 100 };
  groups["all-gated"] = metrics(samples.filter((sample) => sample.scenario !== "back" || sample.leg === "return"));
  return { groups, legs };
}
type FlingTiming = { p95: number; over33: number; droppedPct: number; blockingMs: number };
type FlingSample = { p95: number; over33: number; droppedPct: number; blockingMs: number; maxRows: number; settledRows: number; historyWrites: number; frames: number; scrollHost: "document" | "main" };
type Comparison = { summary: NavigationSummary; fling: { timing: FlingTiming };
  environment: { appSha: string; headless: boolean; webkit: string; chromium: string; platform: string; cpu: string; cores: number; fixtureClock: string };
  options: { skipBuild: boolean; rows: number; flingRepeat: number; headed: boolean; smoke: boolean; sessions?: number; roundTrips?: number };
  label: string | null; flingAttempts?: { attempt: number; ok: boolean }[] };

const legsInOrder = ["cash:to", "cash:return", "invest:to", "invest:return", "back:to", "back:return"] as const;
const roundTo = (value: number, places: number) => Number(value.toFixed(places));

export function compactNavigationBaseline<TOptions, TEnvironment, TTiming extends FlingTiming>(result: {
  version: number; label: string | null; startedAt: string; options: TOptions; environment: TEnvironment; capPatched: boolean; summary: NavigationSummary;
  sessions: { session: number; rafIntervals: number[]; samples: NavigationSample[] }[]; fling: { flings: FlingSample[]; timing: TTiming };
}) {
  return {
    version: result.version, label: result.label, startedAt: result.startedAt, options: result.options, environment: result.environment,
    capPatched: result.capPatched, summary: result.summary,
    sessions: result.sessions.map(({ session, rafIntervals, samples }) => ({
      session, device: samples[0]?.device ?? "unknown", rafIntervals: rafIntervals.map((value) => roundTo(value, 1)),
      durations: Object.fromEntries(legsInOrder.map((key) => {
        const [scenario, leg] = key.split(":");
        return [key, samples.filter((sample) => sample.scenario === scenario && sample.leg === leg)
          .sort((a, b) => a.roundTrip - b.roundTrip).map((sample) => sample.durationMs)];
      })) as Record<(typeof legsInOrder)[number], number[]>,
    })),
    fling: { flings: result.fling.flings.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? roundTo(value, 2) : value])) as FlingSample),
      timing: result.fling.timing },
  };
}

export function readNavigationBaseline(content: string | undefined, displayPath: string): { baseline?: unknown; note: string | null } {
  if (content === undefined) return { baseline: undefined, note: `No baseline file at ${displayPath}; nothing to compare.` };
  try { return { baseline: JSON.parse(content) as unknown, note: null }; }
  catch { throw new Error(`Invalid baseline JSON at ${displayPath}: malformed JSON`); }
}


const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function isFlingResult(value: unknown, expectedRepeat: number): boolean {
  const result = object(value);
  const flings = result.flings;
  const validMetrics = (row: unknown) => {
    const values = object(row);
    return ["p95", "blockingMs", "over33", "droppedPct"].every((key) => Number.isFinite(values[key]) && (values[key] as number) >= 0)
      && ["over33", "droppedPct"].every((key) => (values[key] as number) <= 100);
  };
  return Number.isSafeInteger(expectedRepeat) && expectedRepeat > 0 && Array.isArray(flings) && flings.length === expectedRepeat
    && flings.every((row) => {
      const values = object(row);
      return validMetrics(row) && Number.isInteger(values.maxRows) && (values.maxRows as number) >= 1
        && Number.isInteger(values.settledRows) && (values.settledRows as number) >= 1
        && Number.isInteger(values.historyWrites) && (values.historyWrites as number) >= 0
        && Number.isInteger(values.frames) && (values.frames as number) >= 3
        && (values.scrollHost === "document" || values.scrollHost === "main");
    })
    && validMetrics(result.timing) && typeof result.browserVersion === "string" && result.browserVersion.trim().length > 0;
}


export function baselineMismatches(current: unknown, baseline: unknown): string[] {
  const mismatches: string[] = [];
  const run = object(current);
  const previousRun = object(baseline);
  if (previousRun.version !== 1) mismatches.push("version: unsupported");
  const currentOptions = object(run.options);
  const baselineOptions = object(previousRun.options);
  if (currentOptions.skipBuild === true || baselineOptions.skipBuild === true) mismatches.push("options.skipBuild: unverified build provenance");
  else if (baselineOptions.skipBuild == null) mismatches.push("options.skipBuild: missing in baseline");
  else if (currentOptions.skipBuild == null) mismatches.push("options.skipBuild: missing in current run");
  else if (currentOptions.skipBuild !== baselineOptions.skipBuild) mismatches.push("options.skipBuild");
  for (const [section, keys] of [
    ["options", ["rows", "flingRepeat", "headed", "smoke"]],
    ["environment", ["headless", "webkit", "chromium", "platform", "cpu", "cores"]],
  ] as const) {
    const actualFields = object(run[section]);
    const previousFields = object(previousRun[section]);
    for (const key of keys) {
      const field = `${section}.${key}`;
      const actual = actualFields[key];
      const previous = previousFields[key];
      if (previous == null) mismatches.push(`${field}: missing in baseline`);
      else if (actual == null) mismatches.push(`${field}: missing in current run`);
      else if (actual !== previous) mismatches.push(field);
    }
  }
  const actualClock = object(run.environment).fixtureClock;
  const previousClock = object(previousRun.environment).fixtureClock;
  const knownClock = (clock: unknown) => clock === "system" || clock === "date" || clock === "playwright";
  if (!knownClock(previousClock)) mismatches.push(`environment.fixtureClock: ${previousClock == null ? "missing" : "unknown"} in baseline`);
  else if (!knownClock(actualClock)) mismatches.push(`environment.fixtureClock: ${actualClock == null ? "missing" : "unknown"} in current run`);
  else if (actualClock !== previousClock) mismatches.push("environment.fixtureClock");
  const groups = object(object(run.summary).groups);
  const baselineGroups = object(object(previousRun.summary).groups);
  for (const name of Object.keys(groups)) {
    const field = `summary.groups.${name}`;
    const previous = baselineGroups[name];
    if (typeof previous !== "object" || previous === null || Array.isArray(previous)) mismatches.push(`${field}: missing in baseline`);
    else if (!Number.isFinite(object(previous).p95)) mismatches.push(`${field}.p95: missing in baseline`);
    else if ((object(previous).p95 as number) < 0) mismatches.push(`${field}.p95: invalid baseline value`);
  }
  const currentFlings = object(run.fling).flings;
  const previousFlings = object(previousRun.fling).flings;
  if (Array.isArray(currentFlings) || Array.isArray(previousFlings)) {
    const host = (flings: unknown): string | null => {
      if (!Array.isArray(flings) || flings.length === 0) return null;
      const first = object(flings[0]).scrollHost;
      return (first === "main" || first === "document") && flings.every((row) => object(row).scrollHost === first) ? first : null;
    };
    const previousHost = host(previousFlings);
    const currentHost = host(currentFlings);
    if (previousHost === null) mismatches.push("fling.scrollHost: missing or mixed in baseline");
    else if (currentHost === null) mismatches.push("fling.scrollHost: missing or mixed in current run");
    else if (previousHost !== currentHost) mismatches.push("fling.scrollHost");
  }
  const timing = object(object(run.fling).timing);
  const baselineTiming = object(object(previousRun.fling).timing);
  for (const key of ["p95", "over33", "droppedPct", "blockingMs"] as const) {
    const field = `fling.timing.${key}`;
    if (!Number.isFinite(baselineTiming[key])) mismatches.push(`${field}: missing in baseline`);
    else if ((baselineTiming[key] as number) < 0 || ((key === "over33" || key === "droppedPct") && (baselineTiming[key] as number) > 100))
      mismatches.push(`${field}: invalid baseline value`);
    else if (!Number.isFinite(timing[key])) mismatches.push(`${field}: missing in current run`);
  }
  return mismatches;
}

export function baselineDeltas(current: NavigationSummary, baseline: NavigationSummary) {
  return Object.fromEntries(Object.entries(current.groups).map(([name, group]) => {
    const previous = baseline.groups[name];
    if (!previous || !Number.isFinite(previous.p95)) throw new Error(`Missing baseline group ${name}`);
    return [name, { baseline: previous.p95, current: group.p95, delta: group.p95 - previous.p95 }];
  }));
}

export function navigationMarkdown(result: Comparison, baseline?: unknown, baselineNote?: string): string {
  const format = (value: number) => String(roundTo(value, 2));
  const signed = (value: number) => `${roundTo(value, 2) > 0 ? "+" : ""}${format(value)}`;
  const { groups, legs } = result.summary;
  const lines = [`# Warm navigation profile${result.label ? ` — ${result.label}` : ""}`, "", `App SHA: ${result.environment.appSha}`,
    ...(result.options.skipBuild ? ["Build: reused existing .next (--skip-build); provenance not verified"] : []), "", "## Gate groups (report-only, ≤100 ms)", "",
    "| Group | n | p50 ms | pooled p95 ms | max ms | Status |", "|---|---:|---:|---:|---:|---|",
    ...Object.entries(groups).map(([name, row]) => `| ${name} | ${row.n} | ${format(row.p50)} | ${format(row.p95)} | ${format(row.max)} | ${row.pass === undefined ? "—" : row.pass ? "pass" : "fail"} |`),
    "", "## Per-leg", "", "| Leg | n | p50 ms | p95 ms | max ms |", "|---|---:|---:|---:|---:|",
    ...Object.entries(legs).map(([name, row]) => `| ${name} | ${row.n} | ${format(row.p50)} | ${format(row.p95)} | ${format(row.max)} |`),
    "", "## Per-session p95 (ms)", "", "| Group | Session | p95 ms |", "|---|---:|---:|",
    ...Object.entries(groups).flatMap(([name, row]) => Object.entries(row.perSessionP95).map(([session, value]) => `| ${name} | ${session} | ${format(value)} |`)),
    "", "## Chromium 300-row fling medians", "", "| p95 ms | >33.4 ms % | dropped % | blocking ms |", "|---:|---:|---:|---:|",
    `| ${format(result.fling.timing.p95)} | ${format(result.fling.timing.over33)} | ${format(result.fling.timing.droppedPct)} | ${format(result.fling.timing.blockingMs)} |`, ""];
  if (result.flingAttempts && result.flingAttempts.length > 1)
    lines.push(`Fling attempts: ${result.flingAttempts.length} (attempt ${result.flingAttempts.find((attempt) => !attempt.ok)?.attempt ?? 1} failed)`, "");
  if (baseline !== undefined) {
    const mismatches = baselineMismatches(result, baseline);
    if (mismatches.length) {
      const baselineOptions = object(object(baseline).options);
      const sampleDifferences = (["sessions", "roundTrips"] as const).filter((key) =>
        result.options[key] != null && baselineOptions[key] != null && result.options[key] !== baselineOptions[key]);
      lines.push("## Baseline comparison", "",
        `Comparison suppressed because configurations differ or baseline data is missing (${mismatches.join(", ")}); the baseline is the machine/build reference only${sampleDifferences.length ? `; ${sampleDifferences.join(" and ")} also differ but do not determine comparability` : ""}.`, "");
    } else {
      const comparable = baseline as Comparison;
      const baselineLabel = typeof comparable.label === "string" && comparable.label.length > 0 ? comparable.label : "unlabelled";
      const baselineSha = typeof comparable.environment.appSha === "string" && comparable.environment.appSha.length > 0 ? comparable.environment.appSha : "unknown SHA";
      lines.push(`## Baseline comparison (${baselineLabel}, ${baselineSha})`, "", "| Group | Baseline p95 ms | Run p95 ms | Δ ms |", "|---|---:|---:|---:|",
      ...Object.entries(baselineDeltas(result.summary, comparable.summary)).map(([name, row]) => `| ${name} | ${format(row.baseline)} | ${format(row.current)} | ${signed(row.delta)} |`),
      "", "| Fling median | Baseline | Run | Δ |", "|---|---:|---:|---:|",
      ...([ ["p95 ms", "p95"], [">33.4 ms %", "over33"], ["dropped %", "droppedPct"], ["blocking ms", "blockingMs"] ] as const)
        .map(([label, key]) => `| ${label} | ${format(comparable.fling.timing[key])} | ${format(result.fling.timing[key])} | ${signed(result.fling.timing[key] - comparable.fling.timing[key])} |`), "");
    }
  } else lines.push("## Baseline comparison", "", baselineNote ?? "No baseline file; nothing to compare.", "");
  return lines.join("\n");
}
