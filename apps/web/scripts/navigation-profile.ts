import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { cpus, homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { webkit } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "../tests/browser/fixtures/api";
import { inlineFixtureMark, launch, launchBounded, twoFrames, withSession } from "./performance/browser";
import { installFeed, runFeed } from "./performance/feed";
import { gotoReady, ready } from "./performance/navigation";
import { flingAttemptOutcome, outcomesMarkdown, outcomesResult, type LoggedFailure } from "./performance/outcomes";
import { HarnessWaitFailure, outcomeFromError } from "./performance/readiness";
import { baselineMismatches, compactNavigationBaseline, firstNextEnvFile, hasNavigationCapGuard, isFlingResult, navigationMarkdown, parseNavigationReport, patchNavigationCap, readNavigationBaseline, summarizeNavigation, validateNavigationSample,
  type NavigationSample, type Scenario, type Leg } from "./performance/navigation-samples";

const defaultBaseline = join(import.meta.dir, "performance/navigation-baseline.json");
const fixtureClock = "system" as const;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const flingChildren = new WeakSet<ChildProcess>();
function killFlingGroup(child: ChildProcess) {
  try {
    if (child.pid === undefined) throw new Error("Fling worker has no PID");
    process.kill(-child.pid, "SIGKILL");
  } catch { child.kill("SIGKILL"); }
}
type ListedProcess = { pid: number; ppid: number; command: string };
export function playwrightBrowserPid(processList: readonly ListedProcess[], workerPid: number): number | null {
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0) return null;
  const parents = new Map(processList.map(({ pid, ppid }) => [pid, ppid]));
  const distanceFromWorker = (pid: number): number | null => {
    const seen = new Set<number>();
    let current = pid, distance = 0;
    while (current !== workerPid && !seen.has(current)) {
      seen.add(current);
      const parent = parents.get(current);
      if (parent === undefined || parent <= 0) return null;
      current = parent;
      distance++;
    }
    return current === workerPid && distance > 0 ? distance : null;
  };
  const matches = processList.flatMap(({ pid, command }) => {
    if (!Number.isSafeInteger(pid) || pid <= 0 || !command.includes("playwright_chromiumdev_profile")) return [];
    const distance = distanceFromWorker(pid);
    return distance === null ? [] : [{ pid, distance }];
  }).sort((a, b) => a.distance - b.distance);
  return matches.length && (matches.length === 1 || matches[0]!.distance < matches[1]!.distance) ? matches[0]!.pid : null;
}
type BrowserIdentity = { pid: number; profile: string };
const profileFlag = /(?:^|\s)--user-data-dir=(\/\S*\/playwright_chromiumdev_profile-[^\s/]+)(?=\s|$)/;
function browserProfile(command: string): string | null { return profileFlag.exec(command)?.[1] ?? null; }
export function playwrightBrowserIdentity(processList: readonly ListedProcess[], workerPid: number): BrowserIdentity | null {
  const pid = playwrightBrowserPid(processList, workerPid);
  const rows = processList.filter((row) => row.pid === pid);
  const profile = rows.length === 1 ? browserProfile(rows[0]!.command) : null;
  return pid !== null && profile !== null ? { pid, profile } : null;
}
export function flingBrowserPidFromStderr(stderr: string): BrowserIdentity | null {
  const marker = stderr.split(/\r?\n/).filter((line) => line.startsWith("fling worker: browser ")).at(-1);
  const match = marker && /^fling worker: browser \S+ pid (\d+) profile (\/\S*\/playwright_chromiumdev_profile-[^\s/]+)$/.exec(marker);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid, profile: match[2]! } : null;
}
const flingCloseTimedOutMarker = "fling worker: close timed out";
export function flingAttemptNeedsReap(failed: boolean, stderr: string): boolean {
  return failed || stderr.split(/\r?\n/).includes(flingCloseTimedOutMarker);
}
export function reapFlingBrowser(processList: readonly ListedProcess[], browser: BrowserIdentity, signal: (pid: number) => void): number {
  const rows = processList.filter(({ pid }) => pid === browser.pid);
  if (rows.length !== 1 || browserProfile(rows[0]!.command) !== browser.profile) return 0;
  signal(browser.pid);
  return 1;
}
function listedProcesses(): ListedProcess[] {
  const result = spawnSync("/bin/ps", ["-Ao", "pid=,ppid=,args="], { encoding: "utf8", timeout: 5_000 });
  if (result.error || result.status !== 0) throw new Error(`Unable to list processes for Chromium fling (ps -Ao pid=,ppid=,args=): ${result.error?.message ?? `exit ${result.status ?? result.signal}`}`);
  return result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }] : [];
  });
}
function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  const booleans = new Set(["--skip-build", "--headed", "--update-baseline", "--smoke"]);
  const allowed = new Set(["--out-dir", "--app-dir", "--port", "--sessions", "--round-trips", "--rows", "--fling-repeat", "--baseline", "--label", ...booleans]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!allowed.has(key) || values.has(key)) throw new Error(`Unknown or repeated flag: ${key}`);
    if (booleans.has(key)) values.set(key, "true");
    else if (args[i + 1] && !args[i + 1]!.startsWith("--")) values.set(key, args[++i]!);
    else throw new Error(`Missing value for ${key}`);
  }
  const integer = (key: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const n = Number(values.get(key) ?? fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  const smoke = values.has("--smoke");
  const sessions = integer("--sessions", 5, smoke ? 1 : 5);
  const roundTrips = integer("--round-trips", 10, smoke ? 1 : 10);
  if (smoke && values.has("--update-baseline")) throw new Error("Smoke runs cannot update a baseline");
  if (values.has("--skip-build") && values.has("--update-baseline")) throw new Error("--skip-build cannot be used with --update-baseline");
  const outDir = values.get("--out-dir");
  if (!outDir) throw new Error("--out-dir is required");
  const appDir = resolve(values.get("--app-dir") ?? join(import.meta.dir, ".."));
  const baselineDisplay = values.get("--baseline") ?? "scripts/performance/navigation-baseline.json";
  return { outDir: resolve(outDir), appDir, port: integer("--port", 3199, 1, 65535), sessions, roundTrips,
    rows: integer("--rows", 300, 25), flingRepeat: integer("--fling-repeat", 3, 1), baseline: resolve(values.get("--baseline") ?? defaultBaseline), baselineDisplay,
    label: values.get("--label") ?? null, smoke, skipBuild: values.has("--skip-build"), headed: values.has("--headed"),
    updateBaseline: values.has("--update-baseline") };
}

function git(dir: string, args: string[]): string {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}
function cleanEnv(): NodeJS.ProcessEnv {
  return { HOME: homedir(), PATH: process.env.PATH ?? "", NEXT_TELEMETRY_DISABLED: "1", HOME_PLAYWRIGHT_SMOKE: "1",
    HOME_OPERATOR_ADDRESSES: "0x1111111111111111111111111111111111111111,0x3333333333333333333333333333333333333333",
    NEXT_PUBLIC_HOME_INTERACTION_SAMPLE_RATE: "1" } as unknown as NodeJS.ProcessEnv;
}
async function assertFixtureAppDir(dir: string) {
  const blocked = firstNextEnvFile(await readdir(dir));
  if (blocked) throw new Error(`Refusing to profile --app-dir with Next-loadable environment file ${blocked}`);
}
function trackChild(child: ChildProcess, active: Set<ChildProcess>): ChildProcess {
  active.add(child);
  child.once("exit", () => active.delete(child));
  child.once("close", () => active.delete(child));
  return child;
}
function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
export function flingStderrTail(stderr: string): string {
  return stderr.slice(-2_048).trim() || "(empty)";
}
export function childFailureDetail(label: string, timeoutMs: number, stderr: string): string {
  return `${label} deadline ${timeoutMs / 1_000} s; stderr tail: ${flingStderrTail(stderr)}`;
}
async function stopTrackedChild(child: ChildProcess) {
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (childExited(child)) return;
  if (flingChildren.has(child)) killFlingGroup(child);
  await new Promise<void>((done, fail) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      child.off("exit", finish); child.off("close", finish); child.off("error", finish);
      done();
    };
    const escalate = () => {
      clearTimeout(timer);
      if (flingChildren.has(child)) killFlingGroup(child);
      else child.kill("SIGKILL");
      timer = setTimeout(() => {
        child.off("exit", finish); child.off("close", finish); child.off("error", finish);
        fail(new Error(`Child ${child.pid ?? "unknown"} did not exit after SIGKILL`));
      }, 5_000);
    };
    timer = setTimeout(escalate, 5_000);
    if (!child.kill("SIGTERM")) escalate();
  });
}
function waitForChild(child: ChildProcess, label: string, timeoutMs: number): Promise<number | null> {
  return new Promise<number | null>((done, fail) => {
    const finish = () => {
      clearTimeout(timer);
      child.off("exit", onExit); child.off("close", onExit); child.off("error", onError);
    };
    const onExit = (code: number | null) => { finish(); done(code); };
    const onError = (error: Error) => { finish(); fail(error); };
    const timer = setTimeout(() => {
      finish();
      if (flingChildren.has(child)) killFlingGroup(child);
      else child.kill("SIGKILL");
      fail(new Error(`${label} timed out after ${timeoutMs / 1_000} s`));
    }, timeoutMs);
    child.once("error", onError);
    child.once("exit", onExit); child.once("close", onExit);
  });
}
async function withDeadline<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_done, fail) => {
      timer = setTimeout(() => fail(new Error(`${label} timed out after ${timeoutMs / 1_000} s`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function command(dir: string, args: string[], logPath: string, active: Set<ChildProcess>) {
  const fd = openSync(logPath, "a");
  try {
    const child = trackChild(spawn(join(dir, "node_modules/.bin/next"), args, { cwd: dir, env: cleanEnv(), stdio: ["ignore", fd, fd] }), active);
    const status = await waitForChild(child, `next ${args[0]}`, 15 * 60_000);
    if (status !== 0) throw new Error(`next ${args[0]} exited ${status}; see ${logPath}`);
  } finally { closeSync(fd); }
}
async function freePort(port: number) {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", done); });
  await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
}
async function startServer(dir: string, port: number, logPath: string, active: Set<ChildProcess>) {
  await freePort(port);
  const fd = openSync(logPath, "a");
  const child = trackChild(spawn(join(dir, "node_modules/.bin/next"), ["start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: dir, env: cleanEnv(), stdio: ["ignore", fd, fd] }), active);
  closeSync(fd);
  let failure: Error | null = null;
  const exited = new Promise<never>((_done, fail) => {
    child.once("error", (error) => { failure ??= error; fail(failure); });
    child.once("exit", (code, signal) => {
      failure ??= new Error(`Server exited ${code ?? signal}; see ${logPath}`);
      fail(failure);
    });
  });
  void exited.catch(() => {});
  try {
    const ready = (async () => {
      const started = performance.now();
      while (performance.now() - started < 120_000) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/home`, { signal: AbortSignal.timeout(2_000) });
          if (response.status < 500) return;
        } catch { await sleep(250); continue; }
        await sleep(250);
      }
      throw new HarnessWaitFailure("fixture-start", 120_000, performance.now() - started);
    })();
    await Promise.race([ready, exited]);
    return { child, assertAlive: () => {
      if (failure) throw failure;
      if (childExited(child)) throw new Error(`Server exited during profile run; see ${logPath}`);
    } };
  } catch (error) { await stopServer(child); throw error; }
}
async function stopServer(child: ChildProcess) {
  if (childExited(child)) return;
  await new Promise<void>((done) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", finish); child.off("close", finish); child.off("error", finish);
      done();
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(); }, 10_000);
    child.once("exit", finish); child.once("close", finish); child.once("error", finish);
    child.kill("SIGTERM");
  });
}

async function runSession(browser: Awaited<ReturnType<typeof webkit.launch>>, baseUrl: string, session: number, rounds: number, rows: number) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const reports: NonNullable<ReturnType<typeof parseNavigationReport>>[] = [];
  let capPatches = 0;
  let routeFailure: Error | null = null;
  const samples: NavigationSample[] = [];
  const failures: LoggedFailure[] = [];
  let rafIntervals: number[] = [];
  let current = { path: "/home", leg: "initial-home", cycle: null as number | null };
  const result = () => ({ session, capPatched: capPatches === 1, rafIntervals, samples, reports, failures });
  try {
    await seedSignedInSession(page);
    await installApiFixtures(page, { clock: fixtureClock });
    await inlineFixtureMark(page);
    const fixture = await installFeed(page, rows);
    await page.route("**/api/client-performance**", async (route) => {
      try {
        const report = parseNavigationReport(route.request().postDataJSON());
        if (report) reports.push(report);
        await route.fulfill({ status: 204, body: "" });
      } catch (error) { routeFailure = error as Error; await route.abort(); }
    });
    await page.route("**/_next/static/chunks/*.js*", async (route) => {
      try {
        const response = await route.fetch();
        const source = await response.text();
        if (hasNavigationCapGuard(source)) {
          capPatches++;
          if (capPatches !== 1) throw new Error("Multiple navigation recorder chunks served");
          await route.fulfill({ response, body: patchNavigationCap(source) });
        } else await route.fulfill({ response });
      } catch (error) { routeFailure = error as Error; await route.abort(); }
    });
    await gotoReady(page, baseUrl, "/home", { leg: "initial-home" });
    console.log(`Session ${session}: Home loaded, filling feed`);
    const scrollFeed = (bottom: boolean) => page.evaluate((toBottom) => {
      const main = document.querySelector<HTMLElement>("main[data-app-main-authenticated]");
      const scroller = main && main.scrollHeight > main.clientHeight + 1 ? main : document.scrollingElement;
      if (scroller) scroller.scrollTop = toBottom ? scroller.scrollHeight : 0;
    }, bottom);
    const end = page.locator('section[data-activity-feed] [role="status"]').filter({ hasText: "End of activity" });
    const until = Date.now() + 120_000;
    while (!(fixture.filled() && await end.isVisible()) && Date.now() < until) {
      if (routeFailure) throw routeFailure;
      await scrollFeed(true);
      await sleep(65);
    }
    if (!fixture.filled() || !await end.isVisible()) throw new Error(`Feed fill timed out at ${rows} rows`);
    fixture.verify();
    await scrollFeed(false);
    await twoFrames(page);
    if (routeFailure) throw routeFailure;
    if (capPatches !== 1) throw new Error(`Navigation recorder cap patched ${capPatches} times, expected 1`);
    console.log(`Session ${session}: feed filled; cap patched; ${reports.length} reports`);
    rafIntervals = await withDeadline(page.evaluate(() => new Promise<number[]>((done) => {
      const intervals: number[] = []; let last = 0;
      const tick = (now: number) => { if (last) intervals.push(now - last); last = now; if (intervals.length >= 20) done(intervals); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    })), "rAF calibration", 10_000);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const cash = page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ });
    const invest = nav.getByRole("button", { name: "Invest", exact: true });
    const home = nav.getByRole("button", { name: "Home", exact: true });
    let warmUp = 0;
    const action = async (run: () => Promise<unknown>, route: "/cash" | "/invest" | "/home", from: "/home" | "/cash" | "/invest", trigger: "in-app" | "history", record?: { roundTrip: number; scenario: Scenario; leg: Leg }) => {
      if (routeFailure) throw routeFailure;
      const leg = record ? `${record.scenario}:${record.leg}` : `warm-up ${++warmUp}`;
      current = { path: route, leg, cycle: record?.roundTrip ?? null };
      const index = reports.length;
      await run();
      const started = performance.now();
      while (reports.length === index && performance.now() - started < 15_000) {
        if (routeFailure) throw routeFailure;
        await sleep(20);
      }
      if (routeFailure) throw routeFailure;
      const report = reports[index];
      await ready(page, route, { baseUrl, leg, cycle: record?.roundTrip });
      if (!report) throw new HarnessWaitFailure("report-arrival", 15_000, performance.now() - started);
      if (record) {
        validateNavigationSample(report, { route, from, trigger });
        samples.push({ session, ...record, route: report.route, from: report.from, trigger: report.trigger,
          cache: report.cache, device: report.device, durationMs: report.durationMs });
      } else if (report.route !== route || report.from !== from || report.trigger !== trigger) throw new Error(`Unexpected warm-up report: ${JSON.stringify(report)}`);
      await twoFrames(page);
      await sleep(75);
      if (reports.length !== index + 1) throw new Error("Unexpected extra navigation report");
    };
    await action(() => cash.click(), "/cash", "/home", "in-app");
    await action(() => home.click(), "/home", "/cash", "in-app");
    await action(() => invest.click(), "/invest", "/home", "in-app");
    await action(() => home.click(), "/home", "/invest", "in-app");
    console.log(`Session ${session}: warm-up complete; ${reports.length} reports`);
    for (let roundTrip = 1; roundTrip <= rounds; roundTrip++) {
      for (const scenario of ["cash", "invest", "back"] as const) {
        const to = scenario === "invest" ? "/invest" : "/cash";
        await action(() => (scenario === "invest" ? invest : cash).click(), to, "/home", "in-app", { roundTrip, scenario, leg: "to" });
        await action(() => scenario === "back" ? page.goBack() : home.click(), "/home", to, scenario === "back" ? "history" : "in-app", { roundTrip, scenario, leg: "return" });
      }
    }
    if (routeFailure) throw routeFailure;
    console.log(`Session ${session}: ${samples.length} measured samples; ${reports.length} total reports`);
    return result();
  } catch (error) {
    if (routeFailure) throw routeFailure;
    const outcome = outcomeFromError(error, current);
    if (!outcome || outcome.outcome === "completed") throw error;
    failures.push({ ...outcome, outcome: outcome.outcome, session, roundTrip: current.cycle });
    return result();
  } finally { await context.close(); }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const active = new Set<ChildProcess>();
  const flingErrors = new Map<ChildProcess, string>();
  let interrupted = false;
  const onSignal = () => {
    if (interrupted) return;
    interrupted = true;
    const watchdog = setTimeout(() => process.exit(2), 11_000);
    for (const child of flingErrors.keys()) {
      if (!childExited(child)) killFlingGroup(child);
      child.stdout?.destroy(); child.stderr?.destroy();
    }
    const stopping = [...active].map(stopTrackedChild);
    for (const stderr of flingErrors.values()) {
      const browser = flingBrowserPidFromStderr(stderr);
      if (!browser) continue;
      try { reapFlingBrowser(listedProcesses(), browser, (pid) => process.kill(pid, "SIGKILL")); }
      catch (error) { console.error(`Chromium interrupt reap failed: ${(error as Error).message}`); }
    }
    void Promise.allSettled(stopping).finally(() => { clearTimeout(watchdog); process.exit(2); });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await mkdir(options.outDir, { recursive: true });
    await Promise.all(["results.json", "summary.md", "server.log"].map((name) => rm(join(options.outDir, name), { force: true })));
    const logPath = join(options.outDir, "server.log");
    await assertFixtureAppDir(options.appDir);
    if (!options.skipBuild) await command(options.appDir, ["build"], logPath, active);
    await assertFixtureAppDir(options.appDir);
    const server = await startServer(options.appDir, options.port, logPath, active);
    try {
    const baseUrl = `http://127.0.0.1:${options.port}`;
    const webkitBrowser = await launchBounded((timeout) => webkit.launch({ headless: !options.headed, timeout }), 30_000);
    let sessions: Awaited<ReturnType<typeof runSession>>[];
    const webkitVersion = webkitBrowser.version();
    const environment = { appSha: git(options.appDir, ["rev-parse", "HEAD"]), appDirty: git(options.appDir, ["status", "--porcelain"]) !== "",
      harnessSha: git(import.meta.dir, ["rev-parse", "HEAD"]), webkit: webkitVersion, fixtureClock,
      cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, platform: platform(), headless: !options.headed };
    try {
      sessions = [];
      for (let i = 1; i <= options.sessions; i++) {
        sessions.push(await withDeadline(runSession(webkitBrowser, baseUrl, i, options.roundTrips, options.rows), `WebKit session ${i}`, 300_000));
        server.assertAlive();
      }
    } finally { console.log("Closing WebKit"); await withDeadline(webkitBrowser.close(), "WebKit close", 60_000); console.log("WebKit closed"); }
    const failures = sessions.flatMap((session) => session.failures);
    const samples = sessions.flatMap((session) => session.samples);
    const completed = samples.map((sample) => ({ path: sample.route, leg: `${sample.scenario}:${sample.leg}` }));
    console.log("Starting isolated Chromium fling");
    const flingDeadlineMs = 180_000;
    type FlingResult = { flings: Awaited<ReturnType<typeof runFeed>>["flings"];
      timing: Awaited<ReturnType<typeof runFeed>>["timing"]; browserVersion: string };
    const flingAttempts: { attempt: number; ok: boolean; exitCode: number | null; durationMs: number; stderrTail: string; strayChromiumReaped: number | null; reapError?: string; outcome?: "harness-wait-failure"; wait?: "worker-start" }[] = [];
    let fling: FlingResult | undefined;
    const workerStartFailures: LoggedFailure[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      const child = trackChild(spawn(process.execPath, [import.meta.path, "--fling-worker", baseUrl, String(options.flingRepeat)], { cwd: options.appDir,
        env: { HOME: homedir(), PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
        detached: true, stdio: ["ignore", "pipe", "pipe"] }), active);
      flingChildren.add(child);
      let output = "", errorOutput = "", failure: Error | undefined;
      flingErrors.set(child, errorOutput);
      child.stdout!.on("data", (data: Buffer) => { output += data.toString(); });
      child.stderr!.on("data", (data: Buffer) => { errorOutput += data.toString(); flingErrors.set(child, errorOutput); process.stderr.write(data); });
      try {
        const status = await waitForChild(child, `Chromium fling attempt ${attempt}`, flingDeadlineMs);
        await withDeadline(Promise.all([child.stdout!, child.stderr!].map((stream) => new Promise<void>((done) => {
          if (stream.readableEnded || stream.destroyed) return done();
          stream.once("end", done); stream.once("close", done);
        }))), "Chromium fling pipe drain", 1_000).catch(() => {});
        if (status !== 0) throw new Error(`Chromium fling attempt ${attempt} exited ${status ?? child.signalCode}`);
        const parsed: unknown = JSON.parse(output);
        if (!isFlingResult(parsed, options.flingRepeat)) throw new Error(`Chromium fling attempt ${attempt} returned invalid result`);
        fling = parsed as FlingResult;
      } catch (error) { failure = error as Error;
      } finally {
        await stopTrackedChild(child);
        let strayChromiumReaped: number | null = null;
        let reapError: string | undefined;
        const browser = flingAttemptNeedsReap(failure !== undefined, errorOutput) ? flingBrowserPidFromStderr(errorOutput) : null;
        if (browser) {
          strayChromiumReaped = 0;
          try { strayChromiumReaped = reapFlingBrowser(listedProcesses(), browser, (pid) => process.kill(pid, "SIGKILL")); }
          catch (error) { reapError = (error as Error).message; }
        }
        flingErrors.delete(child);
        const durationMs = Date.now() - started;
        const outcome = flingAttemptOutcome(failure !== undefined, errorOutput);
        if (outcome) workerStartFailures.push({ outcome, path: "/home", leg: `fling attempt ${attempt}`, cycle: null,
          detail: { wait: "worker-start", deadlineMs: flingDeadlineMs, elapsedMs: durationMs },
          message: failure?.message ?? "Fling worker did not start measuring" });
        flingAttempts.push({ attempt, ok: !failure, exitCode: child.exitCode, durationMs, stderrTail: flingStderrTail(errorOutput), strayChromiumReaped,
          ...(outcome ? { outcome, wait: "worker-start" as const } : {}), ...(reapError ? { reapError } : {}) });
      }
      if (fling) break;
      console.error(`${failure?.message}; ${childFailureDetail(`Chromium fling attempt ${attempt}`, flingDeadlineMs, errorOutput)}`);
      server.assertAlive();
    }
    if (!fling) {
      failures.push(...workerStartFailures);
      const summary = summarizeNavigation(samples);
      const outcomes = outcomesResult(completed, failures);
      server.assertAlive();
      await writeFile(join(options.outDir, "results.json"), JSON.stringify({ version: 1, label: options.label, startedAt,
        options: { port: options.port, sessions: options.sessions, roundTrips: options.roundTrips, rows: options.rows, flingRepeat: options.flingRepeat,
          smoke: options.smoke, skipBuild: options.skipBuild, headed: options.headed },
        environment: { ...environment, chromium: null }, capPatched: sessions.every((session) => session.capPatched),
        sessions, summary, fling: null, flingAttempts, outcomes, baselineComparable: false, baselineEligible: outcomes.baselineEligible }, null, 2) + "\n");
      server.assertAlive();
      await writeFile(join(options.outDir, "summary.md"), [`# Warm navigation profile`, "", `App SHA: ${environment.appSha}`, "",
        ...outcomesMarkdown(outcomes.byLeg, failures, completed.length), "Chromium fling attempts failed; no fling percentiles are available.", ""].join("\n"));
      server.assertAlive();
      if (options.updateBaseline && !outcomes.baselineEligible) console.log("Baseline update skipped: run has non-completed outcomes.");
      console.log(`Wrote ${options.outDir}/results.json and summary.md; ${outcomes.headline}`);
      if (failures.length) throw new Error(`Navigation profile recorded ${failures.length} non-completed outcome(s); see summary.md in ${options.outDir}; Chromium fling attempts 1 and 2 failed`);
      throw new Error(`Chromium fling attempts 1 and 2 failed; ${childFailureDetail("Chromium fling", flingDeadlineMs, flingAttempts.at(-1)!.stderrTail)}`);
    }
    server.assertAlive();
    const chromiumVersion = fling.browserVersion;
    const summary = summarizeNavigation(samples);
    const outcomes = outcomesResult(completed, failures);
    const result = { version: 1, label: options.label, startedAt,
      options: { port: options.port, sessions: options.sessions, roundTrips: options.roundTrips, rows: options.rows,
        flingRepeat: options.flingRepeat, smoke: options.smoke, skipBuild: options.skipBuild, headed: options.headed },
      capPatched: sessions.every((session) => session.capPatched),
      environment: { ...environment, chromium: chromiumVersion },
      sessions, summary, outcomes, fling: { flings: fling.flings, timing: fling.timing }, flingAttempts };
    let content: string | undefined;
    if (!options.updateBaseline) {
      try { content = await readFile(options.baseline, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const { baseline, note } = options.updateBaseline
      ? { baseline: undefined, note: "Baseline update requested; no comparison was made." }
      : readNavigationBaseline(content, options.baselineDisplay);
    const mismatches = baseline !== undefined ? baselineMismatches(result, baseline) : [];
    const baselineComparable = baseline !== undefined && mismatches.length === 0;
    const baselineNote = note;
    server.assertAlive();
    await writeFile(join(options.outDir, "results.json"), JSON.stringify({ ...result, baselineComparable, baselineMismatches: mismatches, baselineNote }, null, 2) + "\n");
    server.assertAlive();
    await writeFile(join(options.outDir, "summary.md"), navigationMarkdown(result, baseline, baselineNote ?? undefined) + "\n");
    server.assertAlive();
    if (options.updateBaseline && !outcomes.baselineEligible) console.log("Baseline update skipped: run has non-completed outcomes.");
    if (options.updateBaseline && outcomes.baselineEligible) {
      await mkdir(dirname(options.baseline), { recursive: true });
      await writeFile(options.baseline, JSON.stringify(compactNavigationBaseline(result), null, 2) + "\n");
    }
    server.assertAlive();
    console.log(`Wrote ${options.outDir}/results.json and summary.md; ${outcomes.headline}; navigation p95: ${Object.entries(summary.groups).map(([key, row]) => `${key}=${row.p95}ms`).join(", ")}${baseline !== undefined && !baselineComparable ? `; baseline comparison suppressed (${mismatches.map((entry) => entry.split(":")[0]).join(", ")})` : ""}`);
    if (failures.length) throw new Error(`Navigation profile recorded ${failures.length} non-completed outcome(s); see summary.md in ${options.outDir}`);
    } finally { await stopServer(server.child); await Promise.all([...active].map(stopTrackedChild)); }
  } catch (error) {
    const failure = outcomeFromError(error, { path: "/home", leg: null });
    if (failure?.outcome === "harness-wait-failure" && failure.detail && "wait" in failure.detail
      && (failure.detail.wait === "browser-launch" || failure.detail.wait === "fixture-start")) {
      const failures: LoggedFailure[] = [{ ...failure, outcome: failure.outcome }];
      const outcomes = outcomesResult([], failures);
      await writeFile(join(options.outDir, "results.json"), JSON.stringify({ version: 1, label: options.label, startedAt,
        options: { port: options.port, sessions: options.sessions, roundTrips: options.roundTrips, rows: options.rows,
          flingRepeat: options.flingRepeat, smoke: options.smoke, skipBuild: options.skipBuild, headed: options.headed },
        sessions: [], summary: summarizeNavigation([]), outcomes, baselineComparable: false, baselineEligible: false }, null, 2) + "\n");
      await writeFile(join(options.outDir, "summary.md"), ["# Warm navigation profile", "", ...outcomesMarkdown(outcomes.byLeg, failures, 0)].join("\n"));
      if (options.updateBaseline) console.log("Baseline update skipped: run has non-completed outcomes.");
      console.log(`Wrote ${options.outDir}/results.json and summary.md; ${outcomes.headline}`);
    }
    throw error;
  } finally {
    await Promise.all([...active].map(stopTrackedChild));
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
  }
}
async function flingWorker() {
  const [, , , baseUrl, repeatArg] = process.argv;
  const repeat = Number(repeatArg);
  if (!baseUrl || !Number.isSafeInteger(repeat) || repeat < 1) throw new Error("Invalid fling worker arguments");
  console.error("fling worker: launching chromium");
  const browser = await launchBounded(launch, 120_000);
  const browserVersion = browser.version();
  let browserIdentity: BrowserIdentity | null = null;
  try { browserIdentity = playwrightBrowserIdentity(listedProcesses(), process.pid); }
  catch (error) { console.error(`fling worker: browser pid resolution failed: ${(error as Error).message}`); }
  console.error(`fling worker: browser ${browserVersion} pid ${browserIdentity?.pid ?? "unknown"} profile ${browserIdentity?.profile ?? "unknown"}`);
  let result: Awaited<ReturnType<typeof runFeed>> | undefined;
  let failure: unknown;
  try {
    console.error("fling worker: fixture ready");
    console.error(`fling worker: runFeed ${repeat} flings starting`);
    result = await withDeadline(withSession(browser, null, (session) => runFeed(session, baseUrl, 300, repeat, false)), "Chromium runFeed", 240_000);
  } catch (error) { failure = error; throw error;
  } finally {
    if (failure) await withDeadline(browser.close(), "Chromium close", 5_000).catch((error) => console.error(error));
    else try { await withDeadline(browser.close(), "Chromium close", 5_000); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "Chromium close timed out after 5 s") throw error;
      console.error(error);
      console.error(flingCloseTimedOutMarker);
    }
  }
  console.error("fling worker: writing result");
  await new Promise<void>((done, fail) => process.stdout.write(JSON.stringify({ flings: result.flings, timing: result.timing, browserVersion }) + "\n",
    (error) => error ? fail(error) : done()));
}


if (import.meta.main) (process.argv[2] === "--fling-worker" ? flingWorker() : main())
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(2); });
