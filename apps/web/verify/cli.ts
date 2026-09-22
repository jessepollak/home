import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { finalizeEvidence, summarizeEvidence, type MarkResult } from "./evidence";
import { fixtureRoutes, requiresSignedInFixture } from "./fixtures";
import { defaultOtpSender, gmailCredentialsPath, pollGmailOtp, readGmailCredentials, runGmailAuth, type GmailCredentials } from "./gmail";
import {
  accountAddressFromDocument,
  accountPattern,
  accountPinError,
  automationEnvironmentError,
  composeAllowedDomains,
  composeLiveAllowedDomains,
  confirmReviewOrderError,
  confirmTerminalOrderError,
  decideConfirmGate,
  enabledButtonPredicate,
  enforceAmountCap,
  enforceCumulativeAmountCap,
  hostObservationRefusal,
  isRecipientFillStep,
  liveSessionExpired,
  liveStepError,
  outputInsideRepository,
  parseBorrowReviewAmounts,
  parseUsdAmount,
  parseUsdAmountFromLabel,
  partitionLiveFailures,
  recipientPlaceholderError,
  recipientRowError,
  resolveLiveRecipient,
  reviewAndLabelAmountError,
  unexpectedNetworkHosts,
  unlistedAmountClickError,
  type LiveRecipient,
  type RequestFailure,
} from "./live";
import { appendLedger, armCommentId, armEvent, readLedger, recordArmEvent, spendForDay, spendForRun, surfaceArmState, withLedgerLock, type ArmComment, type LedgerEntry } from "./ledger";
import { canaryReach, matchesConfirmLabel, readFeatureMap, type ReachStep } from "./map";
import { confirmPolicyRefusal, requestedCaps, resolveVerifyRole, verifyPolicy, type VerifyRole } from "./policy";

const args = Bun.argv.slice(2);
const repositoryRoot = resolve(import.meta.dir, "../../..");
const featureMapPath = resolve(repositoryRoot, ".agents/skills/browser-iteration/feature-map.md");
const { surfaces, liveHosts, liveExpectedFailures } = await readFeatureMap(featureMapPath);
const ledgerPath = resolve(homedir(), ".home-verify", "ledger.jsonl");
let verifyRole: VerifyRole;
try {
  verifyRole = resolveVerifyRole(process.env.HOME_VERIFY_ROLE);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid verification role.");
  process.exit(2);
}
function revision(name: string): string {
  const result = Bun.spawnSync({ cmd: ["git", "rev-parse", name], cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Could not resolve ${name} for the verification ledger.`);
  return result.stdout.toString().trim();
}
let cachedMainRevision: string | null = null;
function currentMainRevision(): string {
  cachedMainRevision ??= revision("origin/main");
  return cachedMainRevision;
}
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
    console.log(`${surface.id}: ${surface.manual ? "manual" : "automated"}; live ${surface.live ?? "read-only"}${surface.liveReach ? "; live Reach override" : ""}`);
  }
  process.exit(0);
}

if (args[0] === "status") {
  const entries = await readLedger(ledgerPath);
  const today = new Date().toISOString().slice(0, 10);
  console.log(`role: ${verifyRole}`);
  console.log(`today's factory spend: $${spendForDay(entries, today).toFixed(2)} / $${verifyPolicy.factory.perDayUsd.toFixed(2)}`);
  console.log(`caps: $${verifyPolicy.factory.perClickUsd.toFixed(2)} click; $${verifyPolicy.factory.perRunUsd.toFixed(2)} run; $${verifyPolicy.factory.perDayUsd.toFixed(2)} day; $${verifyPolicy.balanceCeilingUsd.toFixed(2)} ceiling`);
  const statusBaseValue = option("--base-url");
  let statusHost: string | null = null;
  if (statusBaseValue !== undefined) {
    try {
      statusHost = new URL(statusBaseValue).host;
    } catch {
      console.error("--base-url must be a valid URL.");
      process.exit(2);
    }
  }
  for (const surface of surfaces.values()) {
    const runHosts = [...new Set(entries.flatMap((entry) => entry.type === "run" && entry.surface === surface.id ? [entry.host] : []))];
    const hosts = statusHost !== null ? [statusHost] : runHosts.length > 0 ? runHosts : [""];
    for (const host of hosts) {
      const state = surfaceArmState(entries, surface.id, currentMainRevision(), host);
      const label = host === "" ? surface.id : `${surface.id} @ ${host}`;
      console.log(`${label}: ${state.armed ? "armed" : "disarmed"} (${state.reason}; ${state.cleanRuns}/${verifyPolicy.cleanRunsToArm} clean Rung 2 runs)`);
    }
  }
  process.exit(0);
}

if (args[0] === "gmail-auth") {
  try {
    const path = gmailCredentialsPath(process.env);
    await runGmailAuth(path);
    console.log(`Gmail readonly authorization saved to ${path}.`);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Gmail authorization failed.");
    process.exit(1);
  }
}

if (args[0] === "arm") {
  const surfaceId = args[1];
  const byIndex = args.indexOf("--by");
  const by = byIndex === -1 ? undefined : args[byIndex + 1];
  if (!surfaceId || !surfaces.has(surfaceId) || !by) {
    console.error("Usage: bun run verify arm <surface> --by <GitHub-comment-url>");
    process.exit(2);
  }
  if (verifyRole !== "operator") {
    console.error("verify arm requires the operator role; the factory role cannot re-arm a surface.");
    process.exit(2);
  }
  try {
    const commentId = armCommentId(by);
    const result = Bun.spawnSync({
      cmd: ["gh", "api", `repos/jessepollak/home/issues/comments/${commentId}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error("Could not resolve the Jesse re-arm comment.");
    const comment = JSON.parse(result.stdout.toString()) as ArmComment;
    const event = armEvent(surfaceId, by, comment);
    await recordArmEvent(ledgerPath, event);
    console.log(`${surfaceId}: armed by ${by}`);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not record arm event.");
    process.exit(2);
  }
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
function resolveAllowedDomains(): string[] {
  try {
    return live
      ? composeLiveAllowedDomains(baseUrl, liveHosts, options("--allow-domain"))
      : composeAllowedDomains(baseUrl, options("--allow-domain"), true);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid --allow-domain value.");
    process.exit(2);
  }
}
const allowedDomains = resolveAllowedDomains();
const allowedDomainFlags = options("--allow-domain").map((domain) => domain.toLowerCase());
const sessionSurface = liveLogin ? "live-login" : args[0] ?? "unknown";
const session = `home-verify-${sessionSurface}-${crypto.randomUUID().slice(0, 8)}`;
const browserEnv: Record<string, string | undefined> = {
  ...process.env,
  AGENT_BROWSER_SESSION: session,
  AGENT_BROWSER_MAX_OUTPUT: "12000",
  AGENT_BROWSER_DEFAULT_TIMEOUT: live ? "600000" : "25000",
  AGENT_BROWSER_HEADED: liveLogin ? "true" : undefined,
};
delete browserEnv.HOME_ACCESS_PASSWORD;
if (!live) browserEnv.AGENT_BROWSER_ALLOWED_DOMAINS = allowedDomains.join(",");

function commandWithInput(input: string | undefined, ...commandArgs: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["bunx", "agent-browser", ...commandArgs, "--json"],
    cwd: repositoryRoot,
    env: browserEnv,
    stdin: input === undefined ? undefined : Buffer.from(input),
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

function command(...commandArgs: string[]): string {
  return commandWithInput(undefined, ...commandArgs);
}

function secretCommand(input: string, ...commandArgs: string[]): string {
  try {
    return commandWithInput(input, ...commandArgs);
  } catch {
    throw new Error(`agent-browser ${commandArgs[0]} failed while handling the deployment access gate.`);
  }
}

function waitForEnabledButton(label: string): void {
  try {
    command("wait", "--fn", enabledButtonPredicate(label));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "the wait timed out";
    throw new Error(`The button “${label}” is still disabled: ${detail}`);
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

function networkItems(output: string): unknown[] {
  const parsed = jsonResult(output);
  return Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed).find(Array.isArray) ?? []
      : [];
}

function requestUrls(output: string): string[] {
  return networkItems(output).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const url = (item as Record<string, unknown>).url;
    return typeof url === "string" ? [url] : [];
  });
}

function requestFailures(output: string): RequestFailure[] {
  return networkItems(output).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const request = item as Record<string, unknown>;
    const status = typeof request.status === "number" ? request.status : null;
    const failed = Boolean(request.failure ?? request.failed ?? request.errorText) || (status !== null && status >= 400);
    return failed
      ? [{
        method: typeof request.method === "string" ? request.method : "GET",
        url: typeof request.url === "string" ? request.url : "unknown",
        status,
      }]
      : [];
  });
}

function currentPath(): string {
  const result = jsonResult(command("eval", "location.pathname + location.search"));
  return typeof result === "string" ? result : "";
}

function authenticatedAccountAddress(): string | null {
  const result = jsonResult(command(
    "eval",
    `(${accountAddressFromDocument.toString()})(document)`,
  ));
  return typeof result === "string" && accountPattern.test(result) ? result : null;
}

function sessionExpired(): boolean {
  const result = jsonResult(command("eval", "document.body.innerText"));
  return typeof result === "string" && liveSessionExpired(result);
}

function livePageAuthenticated(): boolean {
  const result = jsonResult(command("eval", 'Boolean(document.querySelector("[data-app-main-authenticated]"))'));
  return result === true;
}

function handleAccessGate(): void {
  if (!currentPath().startsWith("/access")) return;
  const password = process.env.HOME_ACCESS_PASSWORD;
  if (!password) throw new Error("This deployment requires HOME_ACCESS_PASSWORD in the operator environment.");
  secretCommand(`(()=>{const input=document.querySelector('input[aria-label="Access password"],input[name="password"]');if(!(input instanceof HTMLInputElement))throw new Error("Access password field not found");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;setter?.call(input,${JSON.stringify(password)});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));return true})()`, "eval", "--stdin");
  waitForEnabledButton("Continue");
  secretCommand("", "find", "role", "button", "click", "--name", "Continue", "--exact");
  secretCommand("", "wait", "--fn", `location.pathname!=="/access"`);
}

async function ensurePrivateStateDirectory(): Promise<void> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await chmod(resolve(stateDirectory, ".."), 0o700);
  await chmod(stateDirectory, 0o700);
}

async function saveLiveSession(): Promise<void> {
  command("state", "save", statePath);
  await chmod(statePath, 0o600);
}

async function saveLiveSessionIfAuthenticated(): Promise<"saved" | "not-authenticated" | "failed"> {
  try {
    if (!livePageAuthenticated()) return "not-authenticated";
    await saveLiveSession();
    return "saved";
  } catch {
    return "failed";
  }
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
    waitForEnabledButton("Continue with email");
    const submittedAt = Date.now();
    command("find", "role", "button", "click", "--name", "Continue with email", "--exact");
    const credentials = await readGmailCredentials(gmailCredentialsPath(process.env)) as Required<GmailCredentials>;
    const code = await pollGmailOtp(credentials, process.env.HOME_VERIFY_OTP_SENDER ?? defaultOtpSender, submittedAt);
    secretCommand(`(()=>{const input=document.querySelector('input[aria-label="Verification code"],input[name="otp"]');if(!(input instanceof HTMLInputElement))throw new Error("Verification code field not found");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;setter?.call(input,${JSON.stringify(code)});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));return true})()`, "eval", "--stdin");
    secretCommand("", "find", "role", "button", "click", "--name", "Verify and continue", "--exact");
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
  console.error("       bun run verify gmail-auth");
  console.error("       bun run verify status [--base-url <url>] | arm <surface> --by <GitHub-comment-url>");
  console.error("       bun run verify <surface-id> --live --base-url <url> --out <dir> [--recipient <0x-address|jesse.base.eth>] [--allow-domain <host>] [--allow-confirm --account <0x…> --max-usd <n> [--max-usd-total <n>]]");
  console.error("       bun run verify --list");
  process.exit(2);
}

const outputRoot = resolve(option("--out") ?? ".verify");
const allowConsole = hasFlag("--allow-console");
const allowConfirm = hasFlag("--allow-confirm");
if (allowConsole && allowConfirm) {
  console.error("--allow-console cannot be combined with --allow-confirm.");
  process.exit(2);
}
const accountIntent = option("--account");
const maxUsdValue = option("--max-usd");
const requestedMaxUsd = maxUsdValue === undefined ? null : Number(maxUsdValue);
const maxUsdTotalValue = option("--max-usd-total");
const requestedMaxUsdTotal = maxUsdTotalValue === undefined ? null : Number(maxUsdTotalValue);
let maxUsd: number | null = requestedMaxUsd;
let maxUsdTotal: number | null = requestedMaxUsdTotal ?? requestedMaxUsd;
const recipientOption = option("--recipient");
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
let selectedReach = live ? surface.liveReach ?? surface.reach : surface.reach;
try {
  selectedReach = canaryReach(surfaceId, option("--canary-operation"), selectedReach);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid canary operation.");
  process.exit(2);
}
if (selectedReach.length === 0) {
  console.error(`Surface ${surfaceId} has no machine-readable Reach steps.`);
  process.exit(2);
}
const recipientPlaceholder = selectedReach.some(isRecipientFillStep);
if (live) {
  const placeholderError = recipientPlaceholderError(selectedReach);
  if (placeholderError) {
    console.error(placeholderError);
    process.exit(2);
  }
}
let effectiveRecipient: LiveRecipient | null = null;
if (live && (recipientPlaceholder || recipientOption !== undefined)) {
  const resolution = resolveLiveRecipient(recipientOption);
  if (resolution.action === "refuse") {
    console.error(resolution.reason);
    process.exit(2);
  }
  effectiveRecipient = resolution.recipient;
}
const reachSteps = selectedReach.map((step): ReachStep =>
  isRecipientFillStep(step)
    ? { ...step, value: live ? effectiveRecipient?.address ?? step.value : recipientOption ?? step.value }
    : step
);
const toFillRecipient = live
  ? reachSteps.flatMap((step) => (step.kind === "fill" && step.label === "To" ? [step.value] : []))[0] ?? null
  : null;
if (live && outputInsideRepository(outputRoot, repositoryRoot)) {
  console.error("Live evidence --out must be outside the repository root.");
  process.exit(2);
}
const ledgerEntries = live ? await readLedger(ledgerPath) : [];
const armState = live
  ? surfaceArmState(ledgerEntries, surfaceId, currentMainRevision(), baseUrl.host)
  : { armed: false, cleanRuns: 0, reason: "insufficient-clean-runs" as const };
if (live && allowConfirm) {
  const authority = decideConfirmGate(surface.live, "Continue", true);
  if (authority.action === "refuse") {
    console.error(authority.reason);
    process.exit(2);
  }
  if (verifyRole === "operator" && (!accountIntent || !accountPattern.test(accountIntent))) {
    console.error("Live confirmation requires --account <0x…> in operator mode.");
    process.exit(2);
  }
  try {
    const caps = requestedCaps(verifyRole, requestedMaxUsd, requestedMaxUsdTotal);
    maxUsd = caps.clickCapUsd;
    maxUsdTotal = caps.runCapUsd;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid confirmation caps.");
    process.exit(2);
  }
  if (!armState.armed) {
    console.error(`Rung 3 is disarmed for ${surfaceId}; ${armState.cleanRuns}/${verifyPolicy.cleanRunsToArm} clean current-main Rung 2 runs are recorded.`);
    process.exit(2);
  }
}
if (live) {
  const orderError = confirmReviewOrderError(reachSteps, surface.confirmLabels) ??
    confirmTerminalOrderError(reachSteps, surface.confirmLabels);
  if (orderError) {
    console.error(orderError);
    process.exit(2);
  }
  const approvedFillFields = reachSteps.flatMap((step) => step.kind === "fill" ? [step.label] : []);
  for (const step of reachSteps) {
    const stepError = liveStepError(surface.live, step, approvedFillFields);
    if (stepError) {
      console.error(stepError);
      process.exit(2);
    }
  }
}
let pinnedAccount: string | null = null;
if (live) {
  try {
    pinnedAccount = (await readFile(pinPath, "utf8")).trim();
    await stat(statePath);
  } catch {
    console.error(`No saved live session exists for ${baseUrl.host}; run verify live-login --base-url ${baseUrl.origin}.`);
    process.exit(2);
  }
  if (allowConfirm && accountIntent && accountIntent.toLowerCase() !== pinnedAccount.toLowerCase()) {
    console.error(`--account ${accountIntent} does not match the pinned test account ${pinnedAccount}.`);
    process.exit(2);
  }
}

const destination = live
  ? resolve(outputRoot, surfaceId, new Date().toISOString())
  : resolve(outputRoot, surfaceId);
if (live) {
  await mkdir(resolve(outputRoot, surfaceId), { recursive: true, mode: 0o700 });
  await chmod(resolve(outputRoot, surfaceId), 0o700);
  await mkdir(destination, { mode: 0o700 });
  await chmod(destination, 0o700);
} else {
  await mkdir(destination, { recursive: true });
}
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
    waitForEnabledButton(step.label);
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

const hostObserver = `window.__homeVerifyHosts=[];const __homeVerifyRecord=(value)=>{try{window.__homeVerifyHosts.push(new URL(String(value),location.href).hostname.toLowerCase())}catch{}};const __homeVerifyFetch=window.fetch;window.fetch=(input,init)=>{__homeVerifyRecord(typeof input==="string"?input:input.url);return __homeVerifyFetch(input,init)};const __homeVerifyOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){__homeVerifyRecord(url);return __homeVerifyOpen.call(this,method,url,...rest)};const __homeVerifyWebSocket=window.WebSocket;window.WebSocket=function(url,protocols){__homeVerifyRecord(url);return new __homeVerifyWebSocket(url,protocols)};window.WebSocket.prototype=__homeVerifyWebSocket.prototype;const __homeVerifyBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(url,data)=>{__homeVerifyRecord(url);return __homeVerifyBeacon(url,data)};`;
const init = `${!live && requiresSignedInFixture(surfaceId) ? 'sessionStorage.setItem("home:playwright-smoke:signed-in", "1");localStorage.setItem("home.country.v1", "US");' : ""}${live ? hostObserver : ""}window.__homeVerifyLongTasks=[];try{new PerformanceObserver((list)=>window.__homeVerifyLongTasks.push(...list.getEntries().map((entry)=>entry.duration))).observe({type:"longtask",buffered:true})}catch{}`;
await writeFile(initPath, init, { mode: 0o600 });
let exitCode = 1;
let parsedAmountUsd: number | null = null;
let reviewText: string | null = null;
let recipientMismatch: string | null = null;
let borrowedAmount: string | null = null;
let collateralAmount: string | null = null;
let confirmPerformed = false;
let liveRefusal: string | null = null;
let renderedBalanceUsd: number | null = null;
let finalEvidencePassed = false;
let ledgerRecorded = false;
const confirmedAmountsUsd: number[] = [];
let spendReserved = false;
type StepRecord = { step: string; status: "pending" | "done" | "failed" };
const steps: StepRecord[] = [];
let cumulativeAmountUsd = 0;
let confirmIntent: { label: string; parsedAmountUsd: number; capUsd: number; totalCapUsd: number; recipient: LiveRecipient | null; timestamp: string } | null = null;
let confirmClickAttempted = false;
let stoppedBefore: string | null = null;
let unexpectedHosts: string[] = [];
let expectedFailures: string[] = [];
let transactionHash: string | null = null;
let actionId: string | null = null;
async function writeEvidenceFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  if (live) await chmod(path, 0o600);
}
async function writeLiveEvidence(): Promise<void> {
  if (!live) return;
  await writeEvidenceFile(livePath, `${JSON.stringify({
    baseHost: baseUrl.host,
    allowedDomains: allowedDomainFlags,
    surface: surfaceId,
    pinnedAccount,
    steps,
    confirmIntent,
    confirmPerformed,
    parsedAmountUsd,
    reviewText,
    recipientMismatch,
    borrowedAmount,
    collateralAmount,
    cumulativeAmountUsd,
    renderedBalanceUsd,
    transactionHash,
    actionId,
    stoppedBefore,
    unexpectedHosts,
    expectedFailures,
  }, null, 2)}\n`);
}
function observeUnexpectedHosts(): string[] {
  const networkOutput = command("network", "requests");
  const observedByScript = jsonResult(command("eval", "[...new Set(window.__homeVerifyHosts||[])]"));
  const scriptUrls = Array.isArray(observedByScript)
    ? observedByScript.flatMap((host) => typeof host === "string" ? [`https://${host}`] : [])
    : [];
  return unexpectedNetworkHosts([...requestUrls(networkOutput), ...scriptUrls], allowedDomains);
}
function runIncidents(): string[] {
  const incidents = [];
  if (unexpectedHosts.length > 0) incidents.push("unexpected-host");
  if (recipientMismatch) incidents.push("recipient-mismatch");
  if (liveRefusal?.includes("does not match")) incidents.push("amount-mismatch");
  if (confirmClickAttempted && !confirmPerformed) incidents.push("ambiguous-result");
  if (confirmPerformed && !finalEvidencePassed) incidents.push("post-confirm-failure");
  return [...new Set(incidents)];
}
function syncDisarmIssue(incidents: string[]): void {
  const title = `verify: ${surfaceId} disarmed`;
  const listed = Bun.spawnSync({
    cmd: ["gh", "issue", "list", "--repo", "jessepollak/home", "--state", "open", "--search", `${title} in:title`, "--json", "number", "--jq", ".[0].number"],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (listed.exitCode !== 0) throw new Error("Could not query the disarm issue.");
  const number = listed.stdout.toString().trim();
  const body = `Verifier incident for \`${surfaceId}\`: ${incidents.join(", ")}. Run id: \`${session}\`. The surface remains disarmed until Jesse comments \`/verify arm ${surfaceId}\` and that comment URL is recorded.`;
  const result = number
    ? Bun.spawnSync({ cmd: ["gh", "issue", "comment", number, "--repo", "jessepollak/home", "--body", body], cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" })
    : Bun.spawnSync({ cmd: ["gh", "issue", "create", "--repo", "jessepollak/home", "--title", title, "--body", body], cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("Could not create or update the disarm issue.");
}
async function reserveSpend(amountUsd: number): Promise<string | null> {
  return withLedgerLock(ledgerPath, async () => {
    const currentEntries = await readLedger(ledgerPath);
    const currentArmState = surfaceArmState(currentEntries, surfaceId, currentMainRevision(), baseUrl.host);
    const refusal = confirmPolicyRefusal({
      role: verifyRole,
      armed: currentArmState.armed,
      amountUsd,
      balanceUsd: renderedBalanceUsd,
      runSpendUsd: spendForRun(currentEntries, session),
      todayFactorySpendUsd: spendForDay(currentEntries, new Date().toISOString().slice(0, 10)),
      clickCapUsd: maxUsd ?? Number.NaN,
      runCapUsd: maxUsdTotal ?? Number.NaN,
    });
    if (refusal) return refusal;
    await appendLedger(ledgerPath, {
      type: "run",
      timestamp: new Date().toISOString(),
      runId: session,
      host: baseUrl.host,
      surface: surfaceId,
      role: verifyRole,
      mainRevision: currentMainRevision(),
      rungReached: 2,
      amountsUsd: [amountUsd],
      incidents: [],
      clean: false,
    });
    spendReserved = true;
    return null;
  });
}
async function recordLiveLedger(): Promise<void> {
  if (!live || ledgerRecorded) return;
  const incidents = runIncidents();
  const rungReached = confirmPerformed ? 3 : steps.some((step) => step.status === "done" && (step.step.startsWith("expect Confirm") || step.step.startsWith("expect Review"))) ? 2 : 1;
  const entry: LedgerEntry = {
    type: "run",
    timestamp: new Date().toISOString(),
    runId: session,
    host: baseUrl.host,
    surface: surfaceId,
    role: verifyRole,
    mainRevision: currentMainRevision(),
    rungReached,
    amountsUsd: spendReserved ? [] : confirmedAmountsUsd,
    incidents,
    clean: rungReached >= 2 && finalEvidencePassed && incidents.length === 0,
  };
  if (incidents.length > 0) {
    await appendLedger(ledgerPath, { type: "disarm", timestamp: new Date().toISOString(), surface: surfaceId, incidents, runId: session });
  }
  await appendLedger(ledgerPath, entry);
  if (incidents.length > 0) {
    syncDisarmIssue(incidents);
  }
  ledgerRecorded = true;
}
try {
  command("open", "--init-script", initPath);
  command("set", "viewport", "390", "844");
  if (live) {
    await ensurePrivateStateDirectory();
    command("state", "load", statePath);
    command("navigate", new URL("/home?account=settings", baseUrl).toString());
    handleAccessGate();
    command("wait", "--fn", `document.body.innerText.includes("Show small balances")||(${liveSessionExpired.toString()})(document.body.innerText)`);
    if (sessionExpired()) {
      throw new Error(`The live session expired; run verify live-login --base-url ${baseUrl.origin}.`);
    }
    const observedAccount = authenticatedAccountAddress();
    const pinError = accountPinError(observedAccount, pinnedAccount ?? "");
    if (pinError) throw new Error(pinError);
    await saveLiveSession();
    if (allowConfirm) {
      command("navigate", new URL("/home", baseUrl).toString());
      command("wait", "--fn", `Boolean(document.querySelector('[aria-label="Total balance"]'))`);
      const renderedBalance = jsonResult(command("eval", `document.querySelector('[aria-label="Total balance"]')?.innerText||null`));
      renderedBalanceUsd = typeof renderedBalance === "string" ? parseUsdAmount(renderedBalance) : null;
      if (renderedBalanceUsd === null) throw new Error("The rendered account balance is not knowable; confirmation was refused.");
    }
  } else {
    for (const [pattern, body] of fixtureRoutes()) {
      command("network", "route", pattern, "--body", JSON.stringify(body));
    }
  }
  command("console", "--clear");
  command("errors", "--clear");
  if (!live) command("network", "requests", "--clear");
  let afterReview = false;
  for (const step of reachSteps) {
    const description = step.kind === "goto"
      ? `goto ${step.path}`
      : step.kind === "click"
        ? `click ${step.label}`
        : step.kind === "fill"
          ? `fill ${step.label}`
          : step.kind === "press"
            ? `press ${step.key}`
            : `expect ${step.text}`;
    const record: StepRecord = { step: description, status: "pending" };
    steps.push(record);
    let confirmStep = false;
    if (live && step.kind === "click") {
      confirmStep = matchesConfirmLabel(surface.confirmLabels, step.label);
      const amountClickError = unlistedAmountClickError(step.label, confirmStep);
      if (amountClickError) {
        record.status = "failed";
        stoppedBefore = step.label;
        liveRefusal = amountClickError;
        await writeLiveEvidence();
        break;
      }
      const decision = decideConfirmGate(surface.live, step.label, allowConfirm, confirmStep, afterReview);
      if (decision.action === "refuse") {
        record.status = "failed";
        stoppedBefore = step.label;
        await writeLiveEvidence();
        throw new Error(decision.reason);
      }
      if (decision.action === "stop") {
        record.status = "failed";
        stoppedBefore = step.label;
        if (!confirmStep) liveRefusal = decision.reason;
        await writeLiveEvidence();
        break;
      }
      if (confirmStep) {
        const evaluatedReview = jsonResult(command(
          "eval",
          `(()=>{const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter((node)=>node.getClientRects().length>0);return (dialogs.at(-1)||document.body).innerText})()`,
        ));
        const review = typeof evaluatedReview === "string" ? evaluatedReview : "";
        reviewText = review;
        if (toFillRecipient !== null) {
          recipientMismatch = recipientRowError(review, toFillRecipient);
          if (recipientMismatch) {
            record.status = "failed";
            stoppedBefore = step.label;
            liveRefusal = recipientMismatch;
            await writeLiveEvidence();
            break;
          }
        }
        if (surfaceId === "borrow" && option("--canary-operation") !== "repay") {
          const borrowReview = parseBorrowReviewAmounts(review);
          parsedAmountUsd = borrowReview.borrowedAmountUsd;
          borrowedAmount = borrowReview.borrowedAmount;
          collateralAmount = borrowReview.collateralAmount;
        } else {
          parsedAmountUsd = parseUsdAmount(review);
        }
        const labelAmount = parseUsdAmountFromLabel(step.label);
        liveRefusal = reviewAndLabelAmountError(parsedAmountUsd, labelAmount) ??
          enforceAmountCap(parsedAmountUsd, maxUsd ?? Number.NaN);
        if (!liveRefusal && parsedAmountUsd !== null) {
          liveRefusal = enforceCumulativeAmountCap(cumulativeAmountUsd, parsedAmountUsd, maxUsdTotal ?? Number.NaN);
        }
        if (!liveRefusal && maxUsd !== null && maxUsdTotal !== null) {
          liveRefusal = confirmPolicyRefusal({
            role: verifyRole,
            armed: armState.armed,
            amountUsd: parsedAmountUsd,
            balanceUsd: renderedBalanceUsd,
            runSpendUsd: spendForRun(ledgerEntries, session) + cumulativeAmountUsd,
            todayFactorySpendUsd: spendForDay(ledgerEntries, new Date().toISOString().slice(0, 10)) + cumulativeAmountUsd,
            clickCapUsd: maxUsd,
            runCapUsd: maxUsdTotal,
          });
        }
        if (liveRefusal || parsedAmountUsd === null || maxUsd === null || maxUsdTotal === null) {
          record.status = "failed";
          stoppedBefore = step.label;
          await writeLiveEvidence();
          break;
        }
        unexpectedHosts = observeUnexpectedHosts();
        liveRefusal = hostObservationRefusal(unexpectedHosts);
        if (!liveRefusal && parsedAmountUsd !== null) liveRefusal = await reserveSpend(parsedAmountUsd);
        if (liveRefusal) {
          record.status = "failed";
          stoppedBefore = step.label;
          await writeLiveEvidence();
          break;
        }
        confirmIntent = {
          label: step.label,
          parsedAmountUsd,
          capUsd: maxUsd,
          totalCapUsd: maxUsdTotal,
          recipient: effectiveRecipient,
          timestamp: new Date().toISOString(),
        };
        confirmClickAttempted = true;
        await writeLiveEvidence();
      }
    }
    try {
      executeStep(step);
      record.status = "done";
      if (confirmStep && parsedAmountUsd !== null) {
        confirmPerformed = true;
        cumulativeAmountUsd += parsedAmountUsd;
        confirmedAmountsUsd.push(parsedAmountUsd);
        await writeLiveEvidence();
      }
    } catch (error) {
      record.status = "failed";
      await writeLiveEvidence();
      throw error;
    }
    if (step.kind === "expect" && /^(?:Confirm|Review)/i.test(step.text)) afterReview = true;
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
  if (live) await chmod(screenshotPath, 0o600);
  const dom = jsonResult(command("eval", "document.body.innerText"));
  const domText = typeof dom === "string" ? dom : JSON.stringify(dom, null, 2);
  await writeEvidenceFile(domPath, domText);
  const performance = jsonResult(command("eval", `({marks:performance.getEntriesByType("mark").map((entry)=>({name:entry.name,startTime:entry.startTime})),longTaskCount:(window.__homeVerifyLongTasks||[]).length})`)) as { marks?: Array<{ name: string; startTime: number }>; longTaskCount?: number };
  const markNames = new Set([...Object.keys(surface.budgets), ...(performance.marks ?? []).map((mark) => mark.name).filter((name) => ["shell:paint", "session:verified", "balances:painted", "action:first-interactive"].includes(name))]);
  const marks: MarkResult[] = [...markNames].map((name) => {
    const startTime = performance.marks?.find((mark) => mark.name === name)?.startTime ?? null;
    const budgetMs = surface.budgets[name] ?? null;
    return { name, startTime, budgetMs, passed: budgetMs === null ? null : startTime !== null && startTime <= budgetMs };
  });
  const consoleErrors = messages(command("console"), "error");
  const networkOutput = command("network", "requests");
  unexpectedHosts = live ? observeUnexpectedHosts() : [];
  liveRefusal = hostObservationRefusal(unexpectedHosts) ?? liveRefusal;
  const pageErrors = [...messages(command("errors")), ...(liveRefusal ? [liveRefusal] : [])];
  const failurePartition = partitionLiveFailures(requestFailures(networkOutput), live ? liveExpectedFailures : [], baseUrl);
  const failedRequests = failurePartition.unexpected;
  expectedFailures = failurePartition.expected;
  const finalizedEvidence = finalizeEvidence({
    surfaceId,
    baseUrl: baseUrl.origin,
    capturedAt: new Date().toISOString(),
    viewport: { width: 390, height: 844 },
    steps: steps.filter((step) => step.status === "done").map((step) => step.step),
    artifacts: { screenshot: "screenshot.png", dom: "dom.txt" },
    consoleErrors,
    failedRequests,
    expectedFailures,
    pageErrors,
    marks,
    longTaskCount: performance.longTaskCount ?? 0,
  }, allowConsole);
  const evidence = liveRefusal ? { ...finalizedEvidence, passed: false } : finalizedEvidence;
  finalEvidencePassed = evidence.passed;
  await writeEvidenceFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeEvidenceFile(summaryPath, summarizeEvidence(evidence, live ? "live" : "fixture"));
  if (live) {
    transactionHash = domText.match(/\b0x[0-9a-fA-F]{64}\b/)?.[0] ?? null;
    actionId = domText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0] ?? null;
    await writeLiveEvidence();
  }
  console.log(summaryPath);
  exitCode = evidence.passed ? 0 : 1;
} catch (error) {
  if (live) {
    try {
      unexpectedHosts = observeUnexpectedHosts();
    } catch {
      unexpectedHosts = [];
    }
    await writeLiveEvidence();
  }
  const message = error instanceof Error ? error.message : "Verification failed.";
  console.error(confirmClickAttempted
    ? `${message} A confirm click may have been dispatched; check Activity before re-running because a re-run confirms again.`
    : message);
} finally {
  if (live) {
    const sessionSave = await saveLiveSessionIfAuthenticated();
    if (sessionSave === "failed") {
      console.error("The authenticated live session could not be re-saved; run verify live-login before the next live run.");
    }
  }
  try {
    command("close");
  } catch {
    exitCode = 1;
    finalEvidencePassed = false;
  }
  if (live) {
    try {
      await recordLiveLedger();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Could not record the verification ledger.");
      exitCode = 1;
    }
  }
  await rm(tempDirectory, { recursive: true, force: true });
}
process.exit(exitCode);
