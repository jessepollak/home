export const workloads = ["home-fling", "activity-fling", "nav-round-trips", "add-money-open", "activity-detail-open", "chart-scrub", "replace-state-probe", "record"] as const;
export type Workload = typeof workloads[number];
export type Plan = { workload: Workload; rows: number; label: string; repeat: number; duration: number };
export type Run = { frameCount: number; periodMs: number; missedDeadlinePct: number; longFramePct: number; longFrameCount: number; frameMs: { p50: number; p95: number; p99: number; max: number }; feedbackMs: number[]; blankCheck: { framesWithBlank: number; maxBlankPx: number }; longTasks: { count: number; totalMs: number }; loaf: { count: number; totalMs: number; blockingMs: number }; rowsLoaded?: number; partialSource?: string[]; scrollDriver?: "js"; replaceState?: { calls: number; maxCalls10s: number; errors: { name: string; message: string }[]; securityError: boolean }[]; trace?: { scriptMs: number; styleMs: number; layoutMs: number; paintMs: number } };
export type Result = { version: 1; plan: Plan; environment: { userAgent: string; viewport: { width: number; height: number }; dpr: number; standalone: boolean; navigatorStandalone: boolean; supportedEntryTypes: readonly string[]; fixture?: { tokenImages: "omitted" } }; runs: Run[]; error?: string; traceError?: string };
export const integer = (text: string | null | undefined, min: number, max: number): number | null => {
  if (text == null || !/^(0|[1-9]\d*)$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};
export const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "profile";
export const artifactName = (unique: string, workload: string, suffix: string) => `${safeName(unique)}-${safeName(workload)}${suffix}`;
export const runId = (index: number, label: string, now: number, nonce: string) => `${index}-${now.toString(36)}-${nonce}-${label}`;
export const CHROME_COMMAND_LINE = "_ --disable-fre --no-default-browser-check --no-first-run --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding";
export const chromeCommandLineArgs = (base64: string | null) => base64 === null
  ? ["shell", "rm", "-f", "/data/local/tmp/chrome-command-line"]
  : ["shell", "sh", "-c", `'echo ${base64} | base64 -d > /data/local/tmp/chrome-command-line'`];

export async function chromeCommandLineSnapshot(run: (args: string[]) => Promise<string>): Promise<string | null> {
  const path = "/data/local/tmp/chrome-command-line";
  const listed = await run(["shell", "ls", path]).then(() => true).catch((error: unknown) => {
    if (/no such file or directory/i.test(String(error))) return false;
    throw error;
  });
  if (!listed) return null;
  const value = (await run(["shell", "base64", path])).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]*$/.test(value)) throw new Error("Unrecognized chrome-command-line snapshot");
  return value;
}
export const debugAppFrom = (dumpsys: string) => {
  const name = /mDebugApp=([^/\s]+)\/orig=/.exec(dumpsys)?.[1];
  if (name === undefined) throw new Error("Could not read the emulator's debug-app state; refusing to change it");
  if (name === "null") return null;
  if (!/^[A-Za-z0-9_.:]+$/.test(name)) throw new Error("Unrecognized debug-app designation; refusing to restore it");
  return name;
};
export const isEmulatorDevice = (serial: string, qemuProperty: string) => serial.startsWith("emulator-") || qemuProperty.trim() === "1";
export const routeFor = (workload: Workload) => workload === "activity-fling" || workload === "activity-detail-open" ? "/activity" : workload === "chart-scrub" ? "/invest/cbbtc" : "/home";
export const productionTarget = (url: string, workload: Workload): string => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("--url requires HTTPS without credentials");
  return new URL(routeFor(workload), parsed.origin).href;
};
export const loadedRowCount = (items: { posinset: number; setsize: number }[], fallbackCount: number): number => Math.max(0, ...items.map((item) => item.setsize).filter((n) => n > 0)) || Math.max(0, ...items.map((item) => item.posinset).filter((n) => n > 0)) || fallbackCount;
export const detailPosition = (rows: number): number => { if (!Number.isSafeInteger(rows) || rows < 1) throw new Error("Detail requires at least one loaded row"); return Math.floor(rows / 2) + 1; };
export const deviceFields = (record: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((key) => typeof record[key] === "string" && record[key] !== "").map((key) => [key, record[key] as string]));
const simulatorIdentifiers = "com\\.apple\\.CoreSimulator\\.";
const runtimeGrammar = new RegExp(`^${simulatorIdentifiers}SimRuntime\\.(iOS|watchOS|tvOS|visionOS|xrOS)-(\\d{1,2})-(\\d{1,2})$`);
const simulatorFamilies: [RegExp, string][] = [[/SimDeviceType\.iPhone/, "iPhone"], [/SimDeviceType\.iPad/, "iPad"], [/SimDeviceType\.iPod/, "iPod"], [/SimDeviceType\.AppleTV/, "Apple TV"], [/SimDeviceType\.AppleWatch/, "Apple Watch"], [/SimDeviceType\.RealityDevice/, "Apple Vision"], [/SimDeviceType\.HomePod/, "HomePod"]];
const simulatorState = (state: string) => simulatorStates.has(state) ? state : "unknown";
const simulatorFamily = (identifier: string) => simulatorFamilies.find(([pattern]) => pattern.test(identifier))?.[1] ?? "unknown";
export const simulatorView = (simulator: { runtime: string; name: string; state: string; udid: string; deviceTypeIdentifier?: string }, publicView: boolean, known: KnownSimulatorFacts): { os?: string; osVersion?: string; family?: string; state: string; runtime?: string; deviceTypeIdentifier?: string; name?: string; udid?: string } => {
  if (!publicView) return { runtime: simulator.runtime, name: simulator.name, state: simulator.state, udid: simulator.udid };
  const runtime = runtimeGrammar.exec(simulator.runtime);
  if (!runtime || !known.runtimes.has(simulator.runtime) || simulator.deviceTypeIdentifier !== undefined && !known.deviceTypes.has(simulator.deviceTypeIdentifier)) return { os: "unknown", family: "unknown", state: simulatorState(simulator.state) };
  return { os: runtime[1]!, osVersion: `${runtime[2]}.${runtime[3]}`, family: simulatorFamily(simulator.deviceTypeIdentifier ?? ""), state: simulatorState(simulator.state) };
};
export const simulatorRuntimeVersion = (runtime: string) => {
  const match = runtimeGrammar.exec(runtime);
  return match ? `${match[2]}.${match[3]}` : null;
};

export type AvailableSimulator = { runtime: string; name: string; udid: string; state: string };

export function selectSimulator(devices: AvailableSimulator[], selector: string): AvailableSimulator {
  const byUdid = devices.filter((device) => device.udid === selector);
  if (byUdid.length > 1) throw new Error(`Simulator identifier is ambiguous: ${selector}`);
  if (byUdid.length === 1) return byUdid[0]!;
  const separator = selector.lastIndexOf("@");
  const name = separator === -1 ? selector : selector.slice(0, separator);
  const qualifier = separator === -1 ? null : selector.slice(separator + 1);
  if (qualifier === "") throw new Error(`Empty runtime qualifier: ${selector}`);
  const named = devices.filter((device) => device.name === name);
  const matches = qualifier === null ? named : named.filter((device) => device.runtime === qualifier || simulatorRuntimeVersion(device.runtime) === qualifier);
  if (!matches.length) throw new Error(`Simulator not available: ${selector}`);
  if (matches.length > 1) {
    const choices = matches.map((device) => `${device.name}@${simulatorRuntimeVersion(device.runtime) ?? device.runtime}`).join(", ");
    throw new Error(`Simulator name ${name} matches ${matches.length} runtimes (${choices}); add a runtime qualifier or pass the device UDID`);
  }
  return matches[0]!;
}
export const publicPlatforms = new Set(["iOS", "iPadOS", "tvOS", "watchOS", "visionOS", "macOS", "xrOS"]);
export const simulatorStates = new Set(["Booted", "Shutdown", "Booting", "ShuttingDown", "Creating", "Unavailable"]);
export type KnownSimulatorFacts = { runtimes: Set<string>; deviceTypes: Set<string> };
export const publicOsVersion = /^\d{1,2}(\.\d{1,2}){0,2}$/;
export const publicChromeVersion = /^\d{1,3}(\.\d{1,4}){1,3}$/;
const published = (value: string, pattern: RegExp) => pattern.test(value) ? value : "unknown";
const androidFamilies: [RegExp, string][] = [[/^Pixel(?![A-Za-z])/i, "Pixel"], [/^Nexus(?![A-Za-z])/i, "Nexus"], [/^SM-/i, "Samsung Galaxy"], [/^SAMSUNG/i, "Samsung Galaxy"], [/^moto/i, "Motorola"], [/^OnePlus(?![A-Za-z])/i, "OnePlus"], [/^Redmi(?![A-Za-z])/i, "Redmi"], [/^Xiaomi(?![A-Za-z])/i, "Xiaomi"], [/^OPPO(?![A-Za-z])/i, "OPPO"], [/^vivo(?![A-Za-z])/i, "vivo"], [/^HUAWEI/i, "Huawei"], [/^AOSP/i, "AOSP"], [/emulator/i, "Android emulator"]];
export const androidFamily = (model: string) => androidFamilies.find(([pattern]) => pattern.test(model.trim()))?.[1] ?? "Android";
export const androidView = (device: { model: string; release: string; chrome: string; serial?: string }, publicView: boolean) => {
  if (!publicView) return { ...device };
  return { family: androidFamily(device.model), release: published(device.release, /^\d{1,2}(\.\d{1,2}){0,2}$/), chrome: device.chrome === "unavailable" ? "unavailable" : published(device.chrome, publicChromeVersion) };
};
export const appleFamilies: [RegExp, string][] = [[/^Apple Vision\b/, "Apple Vision"], [/^Apple Watch\b/, "Apple Watch"], [/^Apple TV\b/, "Apple TV"], [/^HomePod\b/, "HomePod"], [/^iPhone\b/, "iPhone"], [/^iPad\b/, "iPad"], [/^iPod\b/, "iPod"]];
export const phoneFamily = (deviceType: string) => appleFamilies.find(([pattern]) => pattern.test(deviceType))?.[1] ?? "unknown";
export const phoneView = (device: Record<string, unknown>, publicView: boolean) => publicView
  ? deviceFields({ ...device, platform: typeof device.platform === "string" && publicPlatforms.has(device.platform) ? device.platform : "unknown", deviceType: typeof device.deviceType === "string" ? phoneFamily(device.deviceType) : "unknown", ...typeof device.osVersion === "string" ? { osVersion: published(device.osVersion, publicOsVersion) } : {} }, ["platform", "deviceType", "osVersion"])
  : deviceFields(device, ["name", "platform", "deviceType", "osVersion", "udid"]);
export const duplicateValues = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);
export const adbStates = new Set(["device", "offline", "unauthorized", "no", "bootloader", "recovery", "sideload", "host", "rescue", "connecting", "authorizing"]);
export function parseAdbDevices(listing: string): { serial: string; state: string }[] {
  const lines = listing.split("\n").map((line) => line.trim()).filter(Boolean);
  const [header, ...rows] = lines;
  if (header !== "List of devices attached") throw new Error("unrecognized adb device list");
  const devices = rows.filter((row) => !row.startsWith("*")).map((row) => {
    const parts = row.split(/\s+/);
    if (parts.length < 2 || !parts[0] || !adbStates.has(parts[1]!)) throw new Error("unrecognized adb device row");
    return { serial: parts[0], state: parts[1]! };
  });
  if (new Set(devices.map((device) => device.serial)).size !== devices.length) throw new Error("duplicate adb device row");
  return devices;
}
export async function probeInto<T>(unavailable: string[], name: string, run: () => Promise<T>, fallback: T, report: (name: string, error: unknown) => void): Promise<T> {
  try { return await run(); } catch (error) { unavailable.push(name); report(name, error); return fallback; }
}
export function matrix(workload: string, rows: number, production: boolean): { workload: Workload; rows: number }[] {
  if (workload === "all") return [...(production ? [rows] : [20, 100, 300]).flatMap((n): { workload: Workload; rows: number }[] => ([{ workload: "home-fling", rows: n }, { workload: "activity-fling", rows: n }])), ...["nav-round-trips", "add-money-open", "activity-detail-open", "chart-scrub", "replace-state-probe"].map((id) => ({ workload: id as Workload, rows: production ? rows : 300 }))];
  if (!workloads.includes(workload as Workload)) throw new Error("Invalid workload");
  return [{ workload: workload as Workload, rows }];
}
export function parseArgs(command: string | undefined, args: string[]): { flags: Map<string, string>; paths: string[] } {
  const allowed: Record<string, string[]> = { serve: ["port", "host", "upstream", "rows", "out-dir"], inventory: ["public"], "ios-sim": ["device", "port", "rows", "repeat", "workload", "label"], android: ["serial", "rows", "repeat", "port", "workload", "label", "url", "trace"], summarize: ["markdown"] };
  const flags = new Map<string, string>(), paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!key.startsWith("--")) { if (command !== "summarize") throw new Error(`Unexpected argument ${key}`); paths.push(key); continue; }
    const name = key.slice(2);
    if (!allowed[command ?? ""]?.includes(name)) throw new Error(`Unknown --${name} for ${command}`);
    if (key === "--public" || key === "--markdown") { flags.set(name, "true"); continue; }
    if (!args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`Missing value for ${key}`);
    flags.set(name, args[++i]!);
  }
  if (command === "android" && flags.has("url")) for (const name of ["rows", "port"]) if (flags.has(name)) throw new Error(`--${name} is not supported with --url`);
  return { flags, paths };
}
export const validPlan = (value: unknown): value is Plan => {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return workloads.includes(p.workload as Workload) && typeof p.rows === "number" && integer(String(p.rows), 1, 2000) === p.rows && typeof p.label === "string" && p.label.length <= 100 && typeof p.repeat === "number" && integer(String(p.repeat), 1, 20) === p.repeat && typeof p.duration === "number" && integer(String(p.duration), 1, 120) === p.duration;
};
export function validResult(value: unknown): value is Result {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<Result>;
  return r.version === 1 && validPlan(r.plan) && !!r.environment && typeof r.environment.userAgent === "string" && Array.isArray(r.runs) && r.runs.length <= r.plan.repeat && r.runs.every((run) => !!run && typeof run.frameCount === "number" && Number.isFinite(run.frameCount) && typeof run.periodMs === "number" && typeof run.missedDeadlinePct === "number" && typeof run.longFrameCount === "number" && typeof run.frameMs?.p95 === "number" && Array.isArray(run.feedbackMs) && run.feedbackMs.every((n) => typeof n === "number") && (run.replaceState === undefined || (Array.isArray(run.replaceState) && run.replaceState.every((x) => Array.isArray(x?.errors)))) && (run.partialSource === undefined || (Array.isArray(run.partialSource) && run.partialSource.every((s) => typeof s === "string"))) && (run.trace === undefined || [run.trace?.scriptMs, run.trace?.styleMs, run.trace?.layoutMs, run.trace?.paintMs].every((n) => typeof n === "number"))) && (r.error === undefined || typeof r.error === "string") && (r.traceError === undefined || typeof r.traceError === "string");
}
export const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2 : 0; };
export const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.ceil(sorted.length * p) - 1]! : 0; };
export const round = (n: number) => Math.round(n * 100) / 100;
export const visibilityProblem = (visibility: string, hiddenDuring = false) => hiddenDuring
  ? "The measured page was hidden during the measurement; its frames and timers were throttled"
  : visibility === "visible" ? null : `The measured page is not visible (visibilityState ${visibility}); a background page has throttled frames and timers`;
export const frameProblem = (sampleCount: number) => sampleCount > 0 ? null : "No animation frame arrived during the measurement; the page or its frames are throttled";
export const resultFailure = (result: Result) => result.error ?? (result.runs.length === result.plan.repeat ? null : `Incomplete result: ${result.runs.length}/${result.plan.repeat} runs`);
export const settledPages = (listed: number, previous: number, settled: number) => listed === previous ? settled + 1 : 0;
export const partialFeedComplete = (partialSourceCount: number, settled: number) => partialSourceCount > 0 && settled >= 2;
export function summarize(results: Result[], markdown = false) {
  const lines = ["Device | Workload | Rows | Period ms | Missed % | Long frames | p95 ms | Feedback median ms | Script/Style/Layout/Paint ms | replaceState errors | Partial | Status"];
  const cell = (text: string) => text.replace(/\s*[|\r\n]+\s*/g, " ").slice(0, 80);
  for (const r of results) {
    const expected = r.plan.repeat ?? r.runs.length, completed = r.runs.length;
    const status = r.error ? `failed ${completed}/${expected}: ${cell(r.error)}` : completed < expected ? `incomplete ${completed}/${expected}` : `ok ${completed}/${expected}`;
    if (!completed) { lines.push(`${cell(r.environment.userAgent).slice(0, 55)} | ${r.plan.workload} | ${r.environment.fixture ? r.plan.rows : "—"} | — | — | — | — | — | — | — | — | ${status}`); continue; }
    for (const run of r.runs) lines.push(`${cell(r.environment.userAgent).slice(0, 55)} | ${r.plan.workload} | ${r.environment.fixture ? r.plan.rows : (run.rowsLoaded ?? "—")} | ${run.periodMs} | ${run.missedDeadlinePct} | ${run.longFrameCount} | ${run.frameMs.p95} | ${run.feedbackMs.length ? round(median(run.feedbackMs)) : "—"} | ${run.trace ? [run.trace.scriptMs, run.trace.styleMs, run.trace.layoutMs, run.trace.paintMs].join("/") : r.traceError ? `— (${cell(r.traceError)})` : "—"} | ${run.replaceState?.reduce((n, x) => n + x.errors.length, 0) ?? 0} | ${run.partialSource?.length ? cell(run.partialSource.join("; ")) : "—"} | ${status}`);
  }
  if (markdown) lines.splice(1, 0, lines[0]!.split(" | ").map(() => "---").join(" | "));
  return lines.map((line) => markdown ? `| ${line} |` : line).join("\n");
}
export type TraceEvent = { name?: string; cat?: string; ph?: string; ts?: number; dur?: number; pid?: number; tid?: number; args?: { name?: string } };
type TraceTotal = NonNullable<Run["trace"]>;
export function traceTotals(events: TraceEvent[], runCount: number, skipRuns = 0): { runs: (TraceTotal | null)[]; error?: string } {
  const missing = (error: string) => ({ runs: Array<null>(runCount).fill(null), error });
  const mainThreads = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const marks = events.filter((e) => (e.ph === "I" || e.ph === "R") && e.cat?.split(",").includes("blink.user_timing") && (e.name === "home-device-profile:measure-start" || e.name === "home-device-profile:measure-end")).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  if (marks.length !== (runCount + skipRuns) * 2 || marks.some((e) => !mainThreads.has(`${e.pid}:${e.tid}`) || !Number.isFinite(e.ts))) return missing(`Expected ${runCount + skipRuns} measured trace windows on CrRendererMain; found ${marks.length} marks`);
  const names: Record<string, keyof TraceTotal> = { FunctionCall: "scriptMs", EvaluateScript: "scriptMs", RecalculateStyles: "styleMs", UpdateLayoutTree: "styleMs", Layout: "layoutMs", Paint: "paintMs" };
  const runs: TraceTotal[] = [];
  for (let i = 0; i < marks.length; i += 2) {
    const start = marks[i]!, end = marks[i + 1]!;
    if (start.name !== "home-device-profile:measure-start" || end.name !== "home-device-profile:measure-end" || start.pid !== end.pid || start.tid !== end.tid || end.ts! <= start.ts!) return missing("Measured trace marks are unpaired or out of order on CrRendererMain");
    if (i / 2 < skipRuns) continue;
    const totals: TraceTotal = { scriptMs: 0, styleMs: 0, layoutMs: 0, paintMs: 0 };
    const candidates = events.filter((e) => e.ph === "X" && e.pid === start.pid && e.tid === start.tid && e.name && names[e.name] && Number.isFinite(e.ts) && Number.isFinite(e.dur) && e.dur! > 0 && e.ts! < end.ts! && e.ts! + e.dur! > start.ts!).sort((a, b) => a.ts! - b.ts! || (b.ts! + b.dur!) - (a.ts! + a.dur!));
    const stack: { finish: number; key: keyof TraceTotal }[] = [];
    for (const e of candidates) {
      while (stack.length && stack.at(-1)!.finish <= e.ts!) stack.pop();
      const finish = e.ts! + e.dur!, key = names[e.name!]!, parent = stack.at(-1);
      if (parent && parent.finish < finish) continue;
      const clipped = (Math.min(finish, end.ts!) - Math.max(e.ts!, start.ts!)) / 1000;
      totals[key] += clipped;
      if (parent) totals[parent.key] -= clipped;
      stack.push({ finish, key });
    }
    runs.push(Object.fromEntries(Object.entries(totals).map(([k, n]) => [k, round(n)])) as TraceTotal);
  }
  return { runs };
}
