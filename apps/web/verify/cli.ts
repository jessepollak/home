import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { finalizeEvidence, summarizeEvidence, type MarkResult } from "./evidence";
import { fixtureRoutes, requiresSignedInFixture } from "./fixtures";
import {
  accountPattern,
  accountPinError,
  automationEnvironmentError,
  composeAllowedDomains,
  confirmLabelPattern,
  decideConfirmGate,
  enforceAmountCap,
  outputInsideRepository,
  parseUsdAmount,
} from "./live";
import { readFeatureMap, type ReachStep } from "./map";

const args = Bun.argv.slice(2);
const repositoryRoot = resolve(import.meta.dir, "../../..");
const featureMapPath = resolve(repositoryRoot, ".agents/skills/browser-iteration/feature-map.md");
const surfaces = await readFeatureMap(featureMapPath);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const options = (name: string) => args.flatMap((argument, index) =>
  argument === name ? [args[index + 1] ?? ""] : []
);
const hasFlag = (name: string) => args.includes(name);

if (args.includes("--list")) {
  for (const surface of surfaces.values()) {
    console.log(`${surface.id}: ${surface.manual ? "manual" : "automated"}; live ${surface.live ?? "read-only"}`);
  }
  process.exit(0);
}

const liveLogin = args[0] === "live-login";
const live = hasFlag("--live") || liveLogin;
const baseUrlValue = option("--base-url");
if (live && !baseUrlValue) {
  console.error("Live verification requires --base-url <url>.");
  process.exit(2);
}
const automationError = live ? automationEnvironmentError(process.env) : null;
if (automationError) {
  console.error(automationError);
  process.exit(2);
}

const baseUrl = new URL(baseUrlValue ?? "http://127.0.0.1:3200");
const hostKey = baseUrl.host.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
const stateDirectory = resolve(homedir(), ".home-verify", hostKey, "state");
const statePath = resolve(stateDirectory, "browser-state.json");
const pinPath = resolve(stateDirectory, "account");
function resolveAllowedDomains(): string {
  try {
    return composeAllowedDomains(baseUrl, options("--allow-domain"), !live).join(",");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid --allow-domain value.");
    process.exit(2);
  }
}
const allowedDomains = resolveAllowedDomains();
const sessionSurface = liveLogin ? "live-login" : args[0] ?? "unknown";
const session = `home-verify-${sessionSurface}-${crypto.randomUUID().slice(0, 8)}`;
const browserEnv: Record<string, string | undefined> = {
  ...process.env,
  AGENT_BROWSER_SESSION: session,
  AGENT_BROWSER_ALLOWED_DOMAINS: allowedDomains,
  AGENT_BROWSER_MAX_OUTPUT: "12000",
  AGENT_BROWSER_DEFAULT_TIMEOUT: liveLogin ? "600000" : "25000",
  AGENT_BROWSER_HEADED: liveLogin ? "true" : undefined,
};
delete browserEnv.HOME_ACCESS_PASSWORD;

function command(...commandArgs: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["bunx", "agent-browser", ...commandArgs, "--json"],
    cwd: repositoryRoot,
    env: browserEnv,
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

function secretCommand(...commandArgs: string[]): string {
  try {
    return command(...commandArgs);
  } catch {
    throw new Error(`agent-browser ${commandArgs[0]} failed while handling the deployment access gate.`);
  }
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

function currentPath(): string {
  const result = jsonResult(command("eval", "location.pathname + location.search"));
  return typeof result === "string" ? result : "";
}

function authenticatedAccountAddress(): string | null {
  const result = jsonResult(command(
    "eval",
    `(()=>{const values=[...document.querySelectorAll("button[title]")].map((node)=>node.getAttribute("title"));return values.find((value)=>/^0x[0-9a-fA-F]{40}$/.test(value||""))||null})()`,
  ));
  return typeof result === "string" && accountPattern.test(result) ? result : null;
}

function sessionExpired(): boolean {
  const result = jsonResult(command(
    "eval",
    `location.search.includes("account=signin")||document.body.innerText.includes("Sign in to Home")`,
  ));
  return result === true;
}

function handleAccessGate(): void {
  if (!currentPath().startsWith("/access")) return;
  const password = process.env.HOME_ACCESS_PASSWORD;
  if (!password) throw new Error("This deployment requires HOME_ACCESS_PASSWORD in the operator environment.");
  secretCommand("find", "label", "Access password", "fill", password, "--exact");
  secretCommand("find", "role", "button", "click", "--name", "Continue", "--exact");
  secretCommand("wait", "--fn", `location.pathname!=="/access"`);
}

async function ensurePrivateStateDirectory(): Promise<void> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await chmod(resolve(stateDirectory, ".."), 0o700);
  await chmod(stateDirectory, 0o700);
}

async function runLiveLogin(): Promise<never> {
  await ensurePrivateStateDirectory();
  let exitCode = 1;
  try {
    command("open", "--headed");
    command("navigate", new URL("/?account=signin", baseUrl).toString());
    handleAccessGate();
    if (!currentPath().includes("account=signin")) {
      command("navigate", new URL("/?account=signin", baseUrl).toString());
    }
    command("find", "label", "Email address", "fill", "j@pollak.io", "--exact");
    command("find", "role", "button", "click", "--name", "Continue with email", "--exact");
    console.log("Complete the email OTP in the visible browser. Waiting up to 10 minutes…");
    command("wait", "--fn", `Boolean(document.querySelector("[data-app-main-authenticated]"))`);
    command("navigate", new URL("/home?account=settings", baseUrl).toString());
    command("wait", "--text", "Show small balances");
    const account = authenticatedAccountAddress();
    if (!account) throw new Error("Could not read the smart account address from the rendered Account surface.");
    command("state", "save", statePath);
    await writeFile(pinPath, `${account}\n`, { mode: 0o600 });
    await chmod(statePath, 0o600);
    await chmod(pinPath, 0o600);
    console.log(`Pinned Home test account ${account} for ${baseUrl.host}.`);
    exitCode = 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Live login failed.");
  } finally {
    try {
      command("close");
    } catch {
      exitCode = 1;
    }
  }
  process.exit(exitCode);
}

if (liveLogin) await runLiveLogin();

const surfaceId = args[0];
if (!surfaceId || surfaceId.startsWith("-")) {
  console.error("Usage: bun run verify <surface-id> [--base-url <url>] [--out <dir>] [--allow-console] [--allow-domain <host>]");
  console.error("       bun run verify live-login --base-url <url> [--allow-domain <host>]");
  console.error("       bun run verify <surface-id> --live --base-url <url> --out <dir> [--allow-domain <host>] [--allow-confirm --account <0x…> --max-usd <n>]");
  console.error("       bun run verify --list");
  process.exit(2);
}

const outputRoot = resolve(option("--out") ?? ".verify");
const allowConsole = hasFlag("--allow-console");
const allowConfirm = hasFlag("--allow-confirm");
const accountIntent = option("--account");
const maxUsdValue = option("--max-usd");
const maxUsd = maxUsdValue === undefined ? null : Number(maxUsdValue);
const surface = surfaces.get(surfaceId);
if (!surface) {
  console.error(`Unknown surface id: ${surfaceId}`);
  console.error(`Available: ${[...surfaces.keys()].join(", ")}`);
  process.exit(2);
}
if (surface.manual && !live) {
  console.error(`Surface ${surfaceId} is a manual-only surface.`);
  process.exit(2);
}
if (surface.reach.length === 0) {
  console.error(`Surface ${surfaceId} has no machine-readable Reach steps.`);
  process.exit(2);
}
if (live && outputInsideRepository(outputRoot, repositoryRoot)) {
  console.error("Live evidence --out must be outside the repository root.");
  process.exit(2);
}
if (live && allowConfirm) {
  const authority = decideConfirmGate(surface.live, "Continue", true);
  if (authority.action === "refuse") {
    console.error(authority.reason);
    process.exit(2);
  }
  if (!accountIntent || !accountPattern.test(accountIntent)) {
    console.error("Live confirmation requires --account <0x…>.");
    process.exit(2);
  }
  if (maxUsd === null || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    console.error("Live confirmation requires --max-usd <positive-number> with no default.");
    process.exit(2);
  }
}

const destination = resolve(outputRoot, surfaceId);
if (live) await rm(destination, { recursive: true, force: true });
const tempDirectory = await mkdtemp(resolve(tmpdir(), "home-verify-"));
const initPath = resolve(tempDirectory, `init-${session}.js`);
const screenshotPath = resolve(destination, "screenshot.png");
const domPath = resolve(destination, "dom.txt");
const evidencePath = resolve(destination, "evidence.json");
const summaryPath = resolve(destination, "summary.md");
const livePath = resolve(destination, "live.json");

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

const init = `${!live && requiresSignedInFixture(surfaceId) ? 'sessionStorage.setItem("home:playwright-smoke:signed-in", "1");localStorage.setItem("home.country.v1", "US");' : ""}window.__homeVerifyLongTasks=[];try{new PerformanceObserver((list)=>window.__homeVerifyLongTasks.push(...list.getEntries().map((entry)=>entry.duration))).observe({type:"longtask",buffered:true})}catch{}`;
await writeFile(initPath, init, { mode: 0o600 });
let exitCode = 1;
let pinnedAccount: string | null = null;
let parsedAmountUsd: number | null = null;
let confirmPerformed = false;
let liveRefusal: string | null = null;
const steps: string[] = [];
try {
  command("open", "--init-script", initPath);
  command("set", "viewport", "390", "844");
  if (live) {
    await ensurePrivateStateDirectory();
    try {
      pinnedAccount = (await readFile(pinPath, "utf8")).trim();
      await stat(statePath);
    } catch {
      throw new Error(`No saved live session exists for ${baseUrl.host}; run verify live-login --base-url ${baseUrl.origin}.`);
    }
    command("state", "load", statePath);
    browserEnv.AGENT_BROWSER_ALLOWED_DOMAINS = allowedDomains;
    command("navigate", new URL("/home?account=settings", baseUrl).toString());
    handleAccessGate();
    command("wait", "--fn", `document.body.innerText.includes("Show small balances")||location.search.includes("account=signin")||document.body.innerText.includes("Sign in to Home")`);
    if (sessionExpired()) {
      throw new Error(`The live session expired; run verify live-login --base-url ${baseUrl.origin}.`);
    }
    const observedAccount = authenticatedAccountAddress();
    const pinError = accountPinError(observedAccount, pinnedAccount);
    if (pinError) throw new Error(pinError);
    if (allowConfirm && accountIntent?.toLowerCase() !== pinnedAccount.toLowerCase()) {
      throw new Error(`--account ${accountIntent} does not match the pinned test account ${pinnedAccount}.`);
    }
  } else {
    for (const [pattern, body] of fixtureRoutes()) {
      command("network", "route", pattern, "--body", JSON.stringify(body));
    }
  }
  await mkdir(destination, { recursive: true });
  command("console", "--clear");
  command("errors", "--clear");
  command("network", "requests", "--clear");
  for (const step of surface.reach) {
    if (live && step.kind === "click") {
      const decision = decideConfirmGate(surface.live, step.label, allowConfirm);
      if (decision.action === "refuse") throw new Error(decision.reason);
      if (decision.action === "stop") break;
      if (allowConfirm && confirmLabelPattern.test(step.label)) {
        const reviewText = jsonResult(command(
          "eval",
          `(()=>{const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter((node)=>node.getClientRects().length>0);return (dialogs.at(-1)||document.body).innerText})()`,
        ));
        parsedAmountUsd = parseUsdAmount(typeof reviewText === "string" ? reviewText : "");
        liveRefusal = enforceAmountCap(parsedAmountUsd, maxUsd ?? Number.NaN);
        if (liveRefusal) break;
        confirmPerformed = true;
      }
    }
    steps.push(executeStep(step));
  }
  const requiredMarks = Object.keys(surface.budgets);
  if (requiredMarks.length > 0) {
    try {
      command("wait", "--fn", requiredMarks.map((name) => `performance.getEntriesByName(${JSON.stringify(name)},"mark").length>0`).join("&&"));
    } catch {
      exitCode = 1;
    }
  }
  command("screenshot", "--full", screenshotPath);
  const dom = jsonResult(command("eval", "document.body.innerText"));
  const domText = typeof dom === "string" ? dom : JSON.stringify(dom, null, 2);
  await writeFile(domPath, domText);
  const performance = jsonResult(command("eval", `({marks:performance.getEntriesByType("mark").map((entry)=>({name:entry.name,startTime:entry.startTime})),longTaskCount:(window.__homeVerifyLongTasks||[]).length})`)) as { marks?: Array<{ name: string; startTime: number }>; longTaskCount?: number };
  const markNames = new Set([...Object.keys(surface.budgets), ...(performance.marks ?? []).map((mark) => mark.name).filter((name) => ["shell:paint", "session:verified", "balances:painted", "action:first-interactive"].includes(name))]);
  const marks: MarkResult[] = [...markNames].map((name) => {
    const startTime = performance.marks?.find((mark) => mark.name === name)?.startTime ?? null;
    const budgetMs = surface.budgets[name] ?? null;
    return { name, startTime, budgetMs, passed: budgetMs === null ? null : startTime !== null && startTime <= budgetMs };
  });
  const consoleErrors = messages(command("console"), "error");
  const pageErrors = [...messages(command("errors")), ...(liveRefusal ? [liveRefusal] : [])];
  const failedRequests = requestFailures(command("network", "requests"));
  const finalizedEvidence = finalizeEvidence({
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
  const evidence = liveRefusal ? { ...finalizedEvidence, passed: false } : finalizedEvidence;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, summarizeEvidence(evidence, live ? "live" : "fixture"));
  if (live) {
    const transactionHash = domText.match(/\b0x[0-9a-fA-F]{64}\b/)?.[0] ?? null;
    const actionId = domText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0] ?? null;
    await writeFile(livePath, `${JSON.stringify({
      baseHost: baseUrl.host,
      surface: surfaceId,
      pinnedAccount,
      stepsExecuted: steps,
      confirmPerformed,
      parsedAmountUsd,
      transactionHash,
      actionId,
    }, null, 2)}\n`);
  }
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
  await rm(tempDirectory, { recursive: true, force: true });
}
process.exit(exitCode);
