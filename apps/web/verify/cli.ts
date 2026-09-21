import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { finalizeEvidence, summarizeEvidence, type MarkResult } from "./evidence";
import { fixtureRoutes, requiresSignedInFixture } from "./fixtures";
import { readFeatureMap, type ReachStep } from "./map";

const args = Bun.argv.slice(2);
const featureMapPath = resolve(import.meta.dir, "../../../.agents/skills/browser-iteration/feature-map.md");
const surfaces = await readFeatureMap(featureMapPath);
if (args.includes("--list")) {
  for (const surface of surfaces.values()) {
    console.log(`${surface.id}: ${surface.manual ? "manual" : "automated"}`);
  }
  process.exit(0);
}

const surfaceId = args[0];
if (!surfaceId || surfaceId.startsWith("-")) {
  console.error("Usage: bun run verify <surface-id> [--base-url <url>] [--out <dir>] [--allow-console]");
  console.error("       bun run verify --list");
  process.exit(2);
}

const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const baseUrl = new URL(option("--base-url") ?? "http://127.0.0.1:3200");
const outputRoot = resolve(option("--out") ?? ".verify");
const allowConsole = args.includes("--allow-console");
const surface = surfaces.get(surfaceId);
if (!surface) {
  console.error(`Unknown surface id: ${surfaceId}`);
  console.error(`Available: ${[...surfaces.keys()].join(", ")}`);
  process.exit(2);
}
if (surface.manual) {
  console.error(`Surface ${surfaceId} is a manual-only surface.`);
  process.exit(2);
}
if (surface.reach.length === 0) {
  console.error(`Surface ${surfaceId} has no machine-readable Reach steps.`);
  process.exit(2);
}

const destination = resolve(outputRoot, surfaceId);
await mkdir(destination, { recursive: true });
const screenshotPath = resolve(destination, "screenshot.png");
const domPath = resolve(destination, "dom.txt");
const evidencePath = resolve(destination, "evidence.json");
const summaryPath = resolve(destination, "summary.md");
const session = `home-verify-${surfaceId}-${crypto.randomUUID().slice(0, 8)}`;
const initPath = resolve(destination, `.init-${session}.js`);
const env = {
  ...process.env,
  AGENT_BROWSER_SESSION: session,
  AGENT_BROWSER_ALLOWED_DOMAINS: `${baseUrl.hostname},localhost,127.0.0.1`,
  AGENT_BROWSER_MAX_OUTPUT: "12000",
};

function command(...commandArgs: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["bunx", "agent-browser", ...commandArgs, "--json"],
    cwd: resolve(import.meta.dir, "../../.."),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString().trim();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`agent-browser ${commandArgs[0]} failed: ${stderr || stdout || `exit ${result.exitCode}`}`);
  }
  return stdout;
}

function jsonResult(output: string): unknown {
  if (!output) return null;
  const parsed = JSON.parse(output) as unknown;
  if (typeof parsed === "object" && parsed !== null && "data" in parsed) {
    const data = (parsed as { data: unknown }).data;
    if (typeof data === "object" && data !== null && "result" in data) {
      return (data as { result: unknown }).result;
    }
    return data;
  }
  return parsed;
}

function messages(output: string, kind?: string): string[] {
  const parsed = jsonResult(output);
  const items = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed).find(Array.isArray) ?? []
      : [];
  return items.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (kind && record.type !== kind && record.level !== kind) return [];
    const value = record.text ?? record.message ?? record.error ?? record.url;
    return typeof value === "string" ? [value] : [];
  });
}

function requestFailures(output: string): string[] {
  const parsed = jsonResult(output);
  const items = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed).find(Array.isArray) ?? []
      : [];
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const request = item as Record<string, unknown>;
    const status = typeof request.status === "number" ? request.status : null;
    const failed = Boolean(request.failure ?? request.failed ?? request.errorText) || (status !== null && status >= 400);
    return failed ? [`${request.method ?? "GET"} ${request.url ?? "unknown"}${status === null ? "" : ` (${status})`}`] : [];
  });
}

function executeStep(step: ReachStep): string {
  if (step.kind === "goto") {
    command("navigate", new URL(step.path, baseUrl).toString());
    return `goto ${step.path}`;
  }
  if (step.kind === "click") {
    command("find", "role", "button", "click", "--name", step.label, "--exact");
    return `click ${step.label}`;
  }
  if (step.kind === "fill") {
    command("find", "label", step.label, "fill", step.value, "--exact");
    return `fill ${step.label}`;
  }
  if (step.kind === "press") {
    command("press", step.key);
    return `press ${step.key}`;
  }
  command("wait", "--text", step.text);
  return `expect ${step.text}`;
}

const init = `${requiresSignedInFixture(surfaceId) ? 'sessionStorage.setItem("home:playwright-smoke:signed-in", "1");localStorage.setItem("home.country.v1", "US");' : ""}window.__homeVerifyLongTasks=[];try{new PerformanceObserver((list)=>window.__homeVerifyLongTasks.push(...list.getEntries().map((entry)=>entry.duration))).observe({type:"longtask",buffered:true})}catch{}`;
await writeFile(initPath, init, { mode: 0o600 });
let exitCode = 1;
try {
  command("open", "--init-script", initPath);
  command("set", "viewport", "390", "844");
  for (const [pattern, body] of fixtureRoutes()) {
    command("network", "route", pattern, "--body", JSON.stringify(body));
  }
  command("console", "--clear");
  command("errors", "--clear");
  command("network", "requests", "--clear");
  const steps = surface.reach.map(executeStep);
  const requiredMarks = Object.keys(surface.budgets);
  if (requiredMarks.length > 0) {
    try {
      command("wait", "--fn", requiredMarks.map((name) => `performance.getEntriesByName(${JSON.stringify(name)},\"mark\").length>0`).join("&&"));
    } catch {
      exitCode = 1;
    }
  }
  command("screenshot", "--full", screenshotPath);
  const dom = jsonResult(command("eval", "document.body.innerText"));
  await writeFile(domPath, typeof dom === "string" ? dom : JSON.stringify(dom, null, 2));
  const performance = jsonResult(command("eval", `({marks:performance.getEntriesByType("mark").map((entry)=>({name:entry.name,startTime:entry.startTime})),longTaskCount:(window.__homeVerifyLongTasks||[]).length})`)) as { marks?: Array<{ name: string; startTime: number }>; longTaskCount?: number };
  const markNames = new Set([...Object.keys(surface.budgets), ...(performance.marks ?? []).map((mark) => mark.name).filter((name) => ["shell:paint", "session:verified", "balances:painted", "action:first-interactive"].includes(name))]);
  const marks: MarkResult[] = [...markNames].map((name) => {
    const startTime = performance.marks?.find((mark) => mark.name === name)?.startTime ?? null;
    const budgetMs = surface.budgets[name] ?? null;
    return { name, startTime, budgetMs, passed: budgetMs === null ? null : startTime !== null && startTime <= budgetMs };
  });
  const consoleErrors = messages(command("console"), "error");
  const pageErrors = messages(command("errors"));
  const failedRequests = requestFailures(command("network", "requests"));
  const evidence = finalizeEvidence({
    surfaceId,
    baseUrl: baseUrl.origin,
    capturedAt: new Date().toISOString(),
    viewport: { width: 390, height: 844 },
    steps,
    artifacts: { screenshot: "screenshot.png", dom: "dom.txt" },
    consoleErrors,
    failedRequests,
    pageErrors,
    marks,
    longTaskCount: performance.longTaskCount ?? 0,
  }, allowConsole);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, summarizeEvidence(evidence));
  console.log(summaryPath);
  exitCode = evidence.passed ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Verification failed.");
} finally {
  try {
    command("close");
  } catch {
    exitCode = 1;
  }
  await rm(initPath, { force: true });
}
process.exit(exitCode);
