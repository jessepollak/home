import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { measureRoute } from "./bundle";
import { launch, withSession } from "./browser";
import { cpuThrottle, feedSizes, gateIds, maxTracedScenarios, modalCycles, navigationPaths, repetitions, routes, type GateId } from "./config";
import { evaluateStructural, evaluateTiming, exitCode, limitFor, median, percentile, type Baseline, type StructuralInput, type TimingInput } from "./evaluate";
import { runFeed } from "./feed";
import { runModal } from "./modal";
import { runNavigation } from "./navigation";

const baselineFile = join(import.meta.dir, "baseline.json");
function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (!key.startsWith("--") || flags.has(key)) throw new Error(`Unknown or repeated flag ${key}`);
    if (key === "--update-baseline") flags.set(key, "true");
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) flags.set(key, argv[++i]!);
    else throw new Error(`Missing value for ${key}`);
  }
  if ([...flags.keys()].some((flag) => !["--base-url", "--out-dir", "--only", "--seed", "--update-baseline"].includes(flag)))
    throw new Error("Unexpected CLI option");
  const baseUrl = flags.get("--base-url"), outDir = flags.get("--out-dir");
  if (!baseUrl || !outDir) throw new Error("--base-url and --out-dir are required");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/")
    throw new Error("A local HTTP fixture server is required");
  const only = flags.get("--only") ?? null, seed = flags.get("--seed") ?? null;
  if ((only && !gateIds.includes(only as GateId)) || (seed && !gateIds.includes(seed as GateId))) throw new Error("Invalid gate id");
  if (flags.has("--update-baseline") && (only || seed)) throw new Error("Baseline updates cannot be filtered or seeded");
  return { baseUrl: url.origin, outDir: resolve(outDir), only: only as GateId | null,
    seed: seed as GateId | null, updateBaseline: flags.has("--update-baseline") };
}

const round = (value: number) => Math.round(value * 100) / 100;
const format = (value: number) => Number.isInteger(value) ? String(value) : String(round(value));

async function main() {
  const { baseUrl, outDir, only, seed, updateBaseline } = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString(), started = performance.now();
  await mkdir(outDir, { recursive: true });
  for (const entry of ["results.json", "summary.md", "traces"]) await rm(join(outDir, entry), { recursive: true, force: true });
  const sha = process.env.GITHUB_SHA || spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim() || null;
  const browser = await launch();
  const phaseRows: { name: string; durationMs: number }[] = [];
  const structuralInputs: StructuralInput[] = [];
  const timingInputs: TimingInput[] = [];
  const traces: string[] = [];
  const reruns = new Map<string, (dir: string) => Promise<void>>();
  const phase = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const at = performance.now();
    try { return await run(); } finally { phaseRows.push({ name, durationMs: round(performance.now() - at) }); }
  };
  try {
    const baseline: Baseline = updateBaseline ? { version: 1, domNodes: {}, initialJs: {} }
      : JSON.parse(await readFile(baselineFile, "utf8")) as Baseline;
    if (baseline.version !== 1) throw new Error("Unsupported baseline version");
    if (updateBaseline || !only || only === "dom-nodes" || only === "initial-js") {
      for (const path of routes) {
        const key = `route-${path.slice(1)}`;
        const measure = () => withSession(browser, seed, (session) => measureRoute(session, baseUrl, path));
        const observed = await phase(key, measure);
        if (updateBaseline) {
          baseline.domNodes[path] = observed.nodes;
          baseline.initialJs[path] = observed.initialJs;
        } else {
          if (!only || only === "dom-nodes") structuralInputs.push({ id: "dom-nodes", label: path, value: observed.nodes,
            limit: limitFor("dom-nodes", baseline.domNodes[path]), unit: "nodes", detail: { baseline: baseline.domNodes[path] } });
          if (!only || only === "initial-js") structuralInputs.push({ id: "initial-js", label: path, value: observed.initialJs,
            limit: limitFor("initial-js", baseline.initialJs[path]), unit: "gzip bytes", detail: { baseline: baseline.initialJs[path], scripts: observed.scripts } });
          reruns.set(key, async (dir) => { await withSession(browser, seed, (session) => measureRoute(session, baseUrl, path), { dir, name: key }); });
        }
      }
    }
    if (updateBaseline) {
      await writeFile(baselineFile, JSON.stringify(baseline, null, 2) + "\n");
      await writeFile(join(outDir, "results.json"), JSON.stringify({
        version: 1, startedAt, durationMs: round(performance.now() - started), sha, seed, only,
        environment: { browser: `chromium ${browser.version()}`, viewport: "mobile", cpuThrottle, platform: platform() },
        phases: phaseRows, structural: [], timing: [], timingMode: "report-only", reportOnlyUntil: "2026-10-11", traces: [],
      }, null, 2) + "\n");
      await writeFile(join(outDir, "summary.md"), ["# Performance baseline updated", "", "| Route | DOM nodes | Initial JS gzip bytes |", "|---|---:|---:|",
        ...routes.map((route) => `| ${route} | ${baseline.domNodes[route]} | ${baseline.initialJs[route]} |`), ""].join("\n"));
      console.log(`Updated ${baselineFile}`);
      return;
    }
    if (!only || only === "mounted-rows" || only === "history-writes") {
      const sizes = seed ? [20, 300] : feedSizes;
      const reps = seed ? 1 : repetitions;
      const includeDetail = only === null;
      const feedResults = new Map<number, Awaited<ReturnType<typeof runFeed>>>();
      for (const rows of sizes) {
        const key = `feed-${rows}`;
        const measure = (count: number) => withSession(browser, seed, (session) => runFeed(session, baseUrl, rows, count, includeDetail));
        feedResults.set(rows, await phase(key, () => measure(reps)));
        reruns.set(key, async (dir) => { await withSession(browser, seed, (session) => runFeed(session, baseUrl, rows, 1, includeDetail), { dir, name: key }); });
      }
      const calibration = feedResults.get(20)!.timing;
      for (const [rows, result] of feedResults) {
        const scenario = `feed-${rows}`;
        for (const [id, field, unit] of [
          ["fling-p95", "p95", "ms"], ["fling-over33", "over33", "%"], ["fling-dropped", "droppedPct", "%"], ["fling-loaf-blocking", "blockingMs", "ms"],
          ...(includeDetail ? [["detail-open", "detailOpen", "ms"] as const] : []),
        ] as const) timingInputs.push({ id, scenario, unit, value: round(result.timing[field]), calibration: round(calibration[field]),
          samples: id === "detail-open" ? result.opens.length : reps });
        if (!only || only === "history-writes") structuralInputs.push({ id: "history-writes", label: scenario,
          value: result.historyWrites, limit: limitFor("history-writes"), unit: "writes/fling", detail: { writes: result.flings.map((run) => run.historyWrites) } });
      }
      if (!only || only === "mounted-rows") for (const rows of sizes) {
        const result = feedResults.get(rows)!;
        structuralInputs.push({ id: "mounted-rows", label: `feed-${rows}`, value: result.settledRows, limit: limitFor("mounted-rows"), unit: "rows",
          detail: { measured: "settled window after each fling", settled: result.flings.map((run) => run.settledRows),
            peakDuringFling: result.flings.map((run) => run.maxRows) } });
      }
    }
    const addGrowth = (scenario: string, growth: { nodes: number; listeners: number; heapBytes: number; second: unknown; tenth: unknown } | null) => {
      if (!growth) throw new Error(`Missing growth measurements for ${scenario}`);
      for (const [metric, unit] of [["nodes", "nodes"], ["listeners", "listeners"], ["heapBytes", "bytes"]] as const)
        structuralInputs.push({ id: "resource-growth", label: `${scenario} ${metric}`, value: growth[metric],
          limit: limitFor("resource-growth", undefined, metric), unit,
          detail: { scenario, metric, second: growth.second, tenth: growth.tenth } });
    };
    if (!only || only === "warm-requests" || only === "resource-growth") {
      const navigation = new Map<number, { p50: number; p95: number; samples: number }>();
      for (const rows of seed ? [20] : [20, 300]) {
        const latencies: number[] = [];
        let slowest: { path: string; p95: number } | null = null;
        for (const path of seed ? navigationPaths.slice(0, 1) : navigationPaths) {
          const key = `nav-${rows}-${path.slice(1)}`;
          const measure = () => withSession(browser, seed, (session) =>
            runNavigation(session, baseUrl, rows, !only || only === "resource-growth", seed === "resource-growth", [path]));
          const result = await phase(key, measure);
          latencies.push(...result.latencies);
          if (!slowest || result.p95 > slowest.p95) slowest = { path, p95: result.p95 };
          if (!only || only === "warm-requests") structuralInputs.push({ id: "warm-requests", label: key,
            value: result.requests.length, limit: limitFor("warm-requests"), unit: "requests", detail: { requests: result.requests } });
          if (!only || only === "resource-growth") addGrowth(key, result.growth);
          reruns.set(key, async (dir) => { await withSession(browser, seed, (session) =>
            runNavigation(session, baseUrl, rows, false, seed === "resource-growth", [path]), { dir, name: key }); });
        }
        navigation.set(rows, { p50: median(latencies), p95: percentile(latencies, 0.95), samples: latencies.length });
        const slowestPath = slowest!.path;
        reruns.set(`nav-${rows}`, async (dir) => { await withSession(browser, seed, (session) =>
          runNavigation(session, baseUrl, rows, false, seed === "resource-growth", [slowestPath]), { dir, name: `nav-${rows}` }); });
      }
      for (const [rows, result] of navigation) {
        const calibration = navigation.get(20)!;
        for (const [id, key] of [["nav-p50", "p50"], ["nav-p95", "p95"]] as const)
          timingInputs.push({ id, scenario: `nav-${rows}`, unit: "ms", value: round(result[key]), calibration: round(calibration[key]), samples: result.samples });
      }
    }
    if (!only || only === "resource-growth") {
      const calibrations = new Map<string, number>();
      for (const rows of seed ? [20] : [20, 300]) for (const kind of seed ? ["detail"] as const : ["detail", "send"] as const) {
        const key = `modal-${kind}-${rows}`;
        const measure = () => withSession(browser, seed, (session) => runModal(session, baseUrl, rows, kind, seed === "resource-growth"));
        const result = await phase(key, measure);
        addGrowth(key, result.growth);
        if (rows === 20) calibrations.set(kind, result.openMs);
        timingInputs.push({ id: "modal-open", scenario: key, unit: "ms", value: round(result.openMs),
          calibration: round(calibrations.get(kind)!), samples: modalCycles });
        reruns.set(key, async (dir) => { await withSession(browser, seed, (session) => runModal(session, baseUrl, rows, kind, seed === "resource-growth"), { dir, name: key }); });
      }
    }
    const structural = evaluateStructural(structuralInputs), timing = evaluateTiming(timingInputs);
    const failures = new Set<string>();
    for (const row of structural) if (!row.pass) {
      const scenario = row.id === "mounted-rows" ? row.label : row.id === "dom-nodes" || row.id === "initial-js" ? `route-${row.label.slice(1)}` :
        row.id === "warm-requests" || row.id === "history-writes" ? row.label : String(row.detail.scenario);
      failures.add(scenario);
    }
    for (const row of timing) if (row.breach) failures.add(row.scenario);
    for (const name of seed ? [] : [...failures].slice(0, maxTracedScenarios)) {
      const rerun = reruns.get(name);
      if (!rerun) throw new Error(`Missing trace rerun for ${name}`);
      await phase(`trace-${name}`, () => rerun(join(outDir, "traces")));
      traces.push(`traces/${name}.zip`, `traces/${name}.cpuprofile`);
    }
    const results = {
      version: 1, startedAt, durationMs: round(performance.now() - started), sha, seed, only,
      environment: { browser: `chromium ${browser.version()}`, viewport: "mobile", cpuThrottle, platform: platform() },
      phases: phaseRows, structural, timing, timingMode: "report-only", reportOnlyUntil: "2026-10-11", traces,
    };
    await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
    const lines = ["# Performance budgets", "", `Run: ${round(results.durationMs / 1000)} s · ${results.environment.browser} · ${results.environment.platform}`,
      "", "## Structural (blocking)", "", "| Gate | Scenario | Value | Limit | Pass |", "|---|---|---:|---:|:---:|",
      ...structural.map((row) => `| ${row.id} | ${row.label} | ${format(row.value)} ${row.unit} | ${format(row.limit)} ${row.unit} | ${row.pass ? "yes" : "NO"} |`),
      "", ...structural.filter((row) => row.id === "warm-requests" && !row.pass)
        .flatMap((row) => (row.detail.requests as { method: string; path: string }[]).map((request) => `- ${row.label}: ${request.method} ${request.path}`)),
      "", "## Timing (report only)", "", "| Metric | Scenario | Value | 20-row calibration | Ratio | Absolute ceiling | Relative ceiling | Breach |", "|---|---|---:|---:|---:|---:|---:|:---:|",
      ...timing.map((row) => `| ${row.id} | ${row.scenario} | ${format(row.value)} ${row.unit} | ${format(row.calibration)} ${row.unit} | ${row.ratio === null ? "—" : `${format(row.ratio)}×`} | ${row.absoluteCeiling === null ? "—" : `${format(row.absoluteCeiling)} ${row.unit}`} | ${row.relativeCeiling === null ? "—" : row.relativeMode === "delta" ? `+${format(row.relativeCeiling)} ${row.unit}` : `${format(row.relativeCeiling)}×`} | ${row.breach ? "yes" : "no"} |`),
      "", "## Phase runtimes", "", "| Phase | Duration |", "|---|---:|",
      ...phaseRows.map((row) => `| ${row.name} | ${format(row.durationMs)} ms |`), "",
      ...(traces.length ? ["Traces: " + traces.join(", "), ""] : [])];
    await writeFile(join(outDir, "summary.md"), lines.join("\n"));
    process.exitCode = exitCode(structural);
    console.log(`Performance budgets: ${structural.filter((row) => !row.pass).length} structural failures, ${timing.filter((row) => row.breach).length} report-only timing breaches; ${round(results.durationMs / 1000)} s`);
  } finally { await browser.close(); }
}

main().catch((error: unknown) => { console.error("Performance harness error:", error); process.exitCode = 2; });
