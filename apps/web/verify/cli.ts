import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { MONEY_ACTION_ID_ATTRIBUTE } from "../shared/money-actions";
import { checkPreparedAction, confirmControlScript, preparedFromHar, protectedControlScript } from "./action";
import { resolve } from "node:path";
import { finalizeEvidence, summarizeEvidence, type MarkResult } from "./evidence";
import { fixtureAccount, fixtureRecipient, fixtureRoutes, requiresSignedInFixture } from "./fixtures";
import { defaultOtpSender, gmailCredentialsPath, pollGmailOtp, readGmailCredentials, runGmailAuth, verifyAccountEmail, type GmailCredentials } from "./gmail";
import {
  accountAddressFromDocument,
  accountPattern,
  accountPinError,
  automationEnvironmentError,
  buttonPresentPredicate,
  composeAllowedDomains,
  composeLiveAllowedDomains,
  confirmReviewOrderError,
  confirmTerminalOrderError,
  decideConfirmGate,
  enabledButtonPredicate,
  enforceAmountCap,
  enforceCumulativeAmountCap,
  hostObservationRefusal,
  inputPresentPredicate,
  labelledInputFillScript,
  canonicalCashoutHandle,
  cashoutHandleFillValue,
  clickPrefixNamesScript,
  clickPrefixPresentPredicate,
  isCashoutHandleFillStep,
  isRecipientFillStep,
  liveSessionExpired,
  liveStepError,
  outputInsideRepository,
  parseUsdAmount,
  partitionLiveFailures,
  recipientFillValue,
  refVisibleNameScript,
  recipientPlaceholderError,
  resolveClickPrefix,
  resolveLiveCashoutHandle,
  resolveLiveRecipient,
  unexpectedNetworkHosts,
  unlistedAmountClickError,
  type LiveRecipient,
  type RequestFailure,
} from "./live";
import { appendLedger, readLedger, spendForDay, spendForRun, withLedgerLock, type LedgerEntry } from "./ledger";
import { canaryReach, effectiveBudgets, matchesConfirmLabel, readFeatureMap, type ReachStep } from "./map";
import { confirmPolicyRefusal, requestedCaps, resolveVerifyRole, verifyPolicy, type VerifyRole } from "./policy";

const invocation = Bun.argv.slice(2);
const sessionFlags = invocation.flatMap((argument, index) => argument === "--session" ? [index] : []);
const sessionName = sessionFlags.length === 0 ? "active-session" : invocation[sessionFlags[0] + 1];
if (sessionFlags.length > 1 || !sessionName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(sessionName)) {
  console.error("--session requires one safe name of 1–64 letters, digits, dots, underscores, or hyphens.");
  process.exit(2);
}
const activePath = resolve(homedir(), ".home-verify", `${sessionName}.json`);
const invocationArgs = sessionFlags.length ? invocation.filter((_, index) => index !== sessionFlags[0] && index !== sessionFlags[0] + 1) : invocation;
const verb = ["start", "snapshot", "click", "fill", "press", "goto", "confirm", "finish"].includes(invocationArgs[0] ?? "") ? invocationArgs[0] : null;
if (verb === "start" && await Bun.file(activePath).exists()) {
  console.error(`An active verify session named ${sessionName} already exists; finish it before starting another.`);
  process.exit(2);
}
type ActiveSession = { options: string[]; browserSession: string; role: VerifyRole; handleHash: string | null; steps: Array<{ step: string; status: "pending" | "done" | "failed" }>; afterReview: boolean; pinnedAccount: string | null; renderedBalanceUsd: number | null; cumulativeAmountUsd: number; confirmedAmountsUsd: number[]; confirmPerformed: boolean; confirmClickAttempted: boolean; spendReserved: boolean; actionId: string | null; confirmIntent: unknown; destination: string };
let active: ActiveSession | null = null;
if (verb && verb !== "start") {
  try { active = JSON.parse(await readFile(activePath, "utf8")) as ActiveSession; }
  catch { console.error("No active verify session; run verify start <surface> first."); process.exit(2); }
}
const args = verb === "start" ? invocationArgs.slice(1) : active ? active.options : invocationArgs;
const repositoryRoot = resolve(import.meta.dir, "../../..");
const featureMapPath = resolve(repositoryRoot, ".agents/skills/browser-iteration/feature-map.md");
const { surfaces, liveHosts, liveExpectedFailures } = await readFeatureMap(featureMapPath);
const ledgerPath = resolve(homedir(), ".home-verify", "ledger.jsonl");
function accountEmailOrExit(): string {
  try {
    return verifyAccountEmail(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "HOME_VERIFY_ACCOUNT_EMAIL is not set.");
    process.exit(2);
  }
}
let verifyRole: VerifyRole;
try {
  verifyRole = resolveVerifyRole(process.env.HOME_VERIFY_ROLE);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid verification role.");
  process.exit(2);
}
if (active && active.role !== verifyRole) {
  console.error("The verify role changed during the active session.");
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
  console.log(`caps: $${verifyPolicy.factory.perClickUsd.toFixed(2)} click; $${verifyPolicy.factory.perRunUsd.toFixed(2)} run; $${verifyPolicy.factory.perDayUsd.toFixed(2)} day`);
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
    const label = statusHost === null ? surface.id : `${surface.id} @ ${statusHost}`;
    const state = surface.live === "confirm"
      ? "confirm-bounded (rung 3 under caps)"
      : surface.live === "up-to-review"
        ? "review-bounded (rung 2)"
        : "read-only (rung 1)";
    console.log(`${label}: ${state}`);
  }
  const recentIncidents = entries.filter((entry) => entry.incidents.length > 0).slice(-5);
  if (recentIncidents.length === 0) {
    console.log("recent incidents: none");
  } else {
    console.log("recent incidents:");
    for (const entry of recentIncidents) {
      console.log(`  ${entry.timestamp} ${entry.surface} @ ${entry.host}: ${entry.incidents.join(", ")}`);
    }
  }
  process.exit(0);
}

if (args[0] === "gmail-auth") {
  console.log(`Sign in as ${accountEmailOrExit()} to authorize Gmail readonly access.`);
  const portValue = option("--port");
  const port = portValue === undefined ? undefined : Number(portValue);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    console.error("--port must be an integer between 0 and 65535.");
    process.exit(2);
  }
  try {
    const path = gmailCredentialsPath(process.env);
    await runGmailAuth(path, { open: !hasFlag("--no-open"), port });
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Gmail authorization failed.");
    process.exit(1);
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
const session = active?.browserSession ?? `home-verify-${sessionSurface}-${crypto.randomUUID().slice(0, 8)}`;
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

function secretCommand(step: string, input: string, ...commandArgs: string[]): string {
  try {
    return commandWithInput(input, ...commandArgs);
  } catch {
    throw new Error(`agent-browser ${commandArgs[0]} failed while ${step}.`);
  }
}

function waitForEnabledButton(label: string): void {
  try {
    command("wait", "--fn", buttonPresentPredicate(label), "--timeout", "30000");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "the wait timed out";
    throw new Error(`The button “${label}” did not render within 30 seconds: ${detail}`);
  }
  try {
    command("wait", "--fn", enabledButtonPredicate(label));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "the wait timed out";
    throw new Error(`The button “${label}” is still disabled: ${detail}`);
  }
}

function waitForInput(label: string, failure: string): void {
  try {
    command("wait", "--fn", inputPresentPredicate(label));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "the wait timed out";
    throw new Error(`${failure}: ${detail}`);
  }
}

function browserGetField(output: string, field: "value" | "html"): unknown {
  const parsed = JSON.parse(output) as { data?: Record<string, unknown> };
  if (!parsed.data || !Object.hasOwn(parsed.data, field)) throw new Error(`agent-browser get did not return ${field}.`);
  return parsed.data[field];
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

function prefixButtonNames(prefix: string): string[] {
  try {
    command("wait", "--fn", clickPrefixPresentPredicate(prefix), "--timeout", "15000");
  } catch {
    return [];
  }
  const result = jsonResult(command("eval", clickPrefixNamesScript(prefix)));
  return Array.isArray(result) ? result.filter((name): name is string => typeof name === "string") : [];
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
  waitForInput("Access password", "The access gate did not render");
  secretCommand("filling the deployment access password", labelledInputFillScript("Access password", password), "eval", "--stdin");
  waitForEnabledButton("Continue");
  secretCommand("submitting the deployment access password", "", "find", "role", "button", "click", "--name", "Continue", "--exact");
  secretCommand("waiting for the deployment access gate to clear", "", "wait", "--fn", `location.pathname!=="/access"`);
}

function settleBeforeLeaving(): void {
  try {
    command("wait", "--load", "networkidle", "--timeout", "30000");
  } catch (error) {
    console.error(`The page did not reach network idle before the next navigation: ${error instanceof Error ? error.message : String(error)}`);
  }
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

async function runLiveLogin(accountEmail: string): Promise<never> {
  await ensurePrivateStateDirectory();
  let exitCode = 1;
  try {
    command("open", "--headed");
    command("navigate", new URL("/?account=signin", baseUrl).toString());
    handleAccessGate();
    if (!currentPath().includes("account=signin")) {
      command("navigate", new URL("/?account=signin", baseUrl).toString());
    }
    waitForInput("Email address", "The sign-in sheet did not render");
    command("find", "label", "Email address", "fill", accountEmail, "--exact");
    waitForEnabledButton("Continue with email");
    const submittedAt = Date.now();
    command("find", "role", "button", "click", "--name", "Continue with email", "--exact");
    const credentials = await readGmailCredentials(gmailCredentialsPath(process.env)) as Required<GmailCredentials>;
    const code = await pollGmailOtp(credentials, process.env.HOME_VERIFY_OTP_SENDER ?? defaultOtpSender, submittedAt);
    waitForInput("Verification code", "The verification code entry did not render");
    secretCommand("filling the sign-in code", labelledInputFillScript("Verification code", code), "eval", "--stdin");
    secretCommand("submitting the sign-in code", "", "find", "role", "button", "click", "--name", "Verify and continue", "--exact");
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

if (liveLogin) await runLiveLogin(accountEmailOrExit());

const surfaceId = args[0];
if (!surfaceId || surfaceId.startsWith("-")) {
  console.error("Usage: bun run verify <surface-id> [--base-url <url>] [--out <dir>] [--allow-console] [--allow-domain <host>]");
  console.error("       bun run verify live-login --base-url <url> [--allow-domain <host>]");
  console.error("       bun run verify gmail-auth [--no-open] [--port <n>]");
  console.error("       bun run verify status [--base-url <url>]");
  console.error("       bun run verify <surface-id> --live --base-url <url> --out <dir> [--recipient <0x-address|jesse.base.eth>] [--allow-domain <host>] [--allow-confirm --account <0x…> --max-usd <n> [--max-usd-total <n>]]");
  console.error("       bun run verify --list");
  process.exit(2);
}

const liveWithSession = live && requiresSignedInFixture(surfaceId);
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
let effectiveRecipient: LiveRecipient | null = !live && surfaceId === "send" ? { name: "jesse.base.eth", address: fixtureRecipient } : null;
if (live && (recipientPlaceholder || recipientOption !== undefined)) {
  const resolution = resolveLiveRecipient(recipientOption);
  if (resolution.action === "refuse") {
    console.error(resolution.reason);
    process.exit(2);
  }
  effectiveRecipient = resolution.recipient;
}
const cashoutHandleRequired = surfaceId === "cash-out" || selectedReach.some(isCashoutHandleFillStep);
let liveCashoutHandle: string | null = null;
if (live && cashoutHandleRequired) {
  const resolution = resolveLiveCashoutHandle(process.env.HOME_VERIFY_CASHOUT_HANDLE);
  if (resolution.action === "refuse") {
    console.error(resolution.reason);
    process.exit(1);
  }
  liveCashoutHandle = resolution.handle;
}
const cashoutOperation = surfaceId === "cash-out" ? option("--canary-operation") ?? "cash-out" : null;
const canonicalCashoutPayoutHandle = cashoutOperation === "cash-out" && liveCashoutHandle !== null
  ? canonicalCashoutHandle(liveCashoutHandle)
  : null;
const handleHash = liveCashoutHandle === null ? null : createHash("sha256").update(liveCashoutHandle).digest("hex");
if (active && active.handleHash !== handleHash) {
  console.error("The pinned payout handle changed during the active session.");
  process.exit(2);
}
const reachSteps = selectedReach
  .map((step): ReachStep =>
    isRecipientFillStep(step)
      ? { ...step, value: live ? recipientFillValue(effectiveRecipient) ?? step.value : recipientOption ?? step.value }
      : step,
  )
  .map((step): ReachStep =>
    live && liveCashoutHandle !== null && isCashoutHandleFillStep(step)
      ? { ...step, value: cashoutHandleFillValue(step.label, liveCashoutHandle) }
      : step,
  );
if (live && outputInsideRepository(outputRoot, repositoryRoot)) {
  console.error("Live evidence --out must be outside the repository root.");
  process.exit(2);
}
const ledgerEntries = live ? await readLedger(ledgerPath) : [];
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
let pinnedAccount: string | null = active?.pinnedAccount ?? (!live && requiresSignedInFixture(surfaceId) ? fixtureAccount : null);
if (liveWithSession) {
  try {
    pinnedAccount = (await readFile(pinPath, "utf8")).trim();
    await stat(statePath);
  } catch {
    console.error(`No saved live session exists for ${baseUrl.host}; run verify live-login --base-url ${baseUrl.origin}.`);
    process.exit(2);
  }
  if (active?.pinnedAccount && active.pinnedAccount.toLowerCase() !== pinnedAccount.toLowerCase()) {
    console.error("The pinned account changed during the active session.");
    process.exit(2);
  }
  if (allowConfirm && accountIntent && accountIntent.toLowerCase() !== pinnedAccount.toLowerCase()) {
    console.error(`--account ${accountIntent} does not match the pinned test account ${pinnedAccount}.`);
    process.exit(2);
  }
}

const destination = active?.destination ?? (live
  ? resolve(outputRoot, surfaceId, new Date().toISOString())
  : resolve(outputRoot, surfaceId));
if (live && !active) {
  await mkdir(resolve(outputRoot, surfaceId), { recursive: true, mode: 0o700 });
  await chmod(resolve(outputRoot, surfaceId), 0o700);
  await mkdir(destination, { mode: 0o700 });
  await chmod(destination, 0o700);
} else if (!active) {
  await mkdir(destination, { recursive: true });
}
const tempDirectory = await mkdtemp(resolve(tmpdir(), "home-verify-"));
const initPath = resolve(tempDirectory, `init-${session}.js`);
const harPath = resolve(tempDirectory, `prepare-${session}.har`);
const screenshotPath = resolve(destination, "screenshot.png");
const domPath = resolve(destination, "dom.txt");
const evidencePath = resolve(destination, "evidence.json");
const summaryPath = resolve(destination, "summary.md");
const livePath = resolve(destination, "live.json");

type ResolvedReachStep = Exclude<ReachStep, { kind: "click-prefix" }>;

function executeStep(step: ResolvedReachStep): string {
  if (step.kind === "goto") {
    command("navigate", new URL(step.path, baseUrl).toString());
    if (live) handleAccessGate();
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

let confirmPerformed = active?.confirmPerformed ?? false;
let liveRefusal: string | null = null;
let renderedBalanceUsd: number | null = active?.renderedBalanceUsd ?? null;
let finalEvidencePassed = false;
let ledgerRecorded = false;
let observedReview = active?.afterReview ?? false;
const confirmedAmountsUsd: number[] = active?.confirmedAmountsUsd ?? [];
let spendReserved = active?.spendReserved ?? false;
type StepRecord = { step: string; status: "pending" | "done" | "failed" };
const steps: StepRecord[] = active?.steps ?? [];
let cumulativeAmountUsd = active?.cumulativeAmountUsd ?? 0;
let confirmIntent: { label: string; parsedAmountUsd: number; capUsd: number; totalCapUsd: number; recipient: LiveRecipient | null; timestamp: string } | null = active?.confirmIntent as typeof confirmIntent ?? null;
let confirmClickAttempted = active?.confirmClickAttempted ?? false;
let stoppedBefore: string | null = null;
let note: string | null = null;
let withdrawalEmpty = false;
let unexpectedHosts: string[] = [];
let expectedFailures: string[] = [];
let transactionHash: string | null = null;
let actionId: string | null = active?.actionId ?? null;
async function saveActive(afterReview: boolean): Promise<void> {
  await mkdir(resolve(homedir(), ".home-verify"), { recursive: true, mode: 0o700 });
  await writeFile(activePath, JSON.stringify({ options: args, browserSession: session, role: verifyRole, handleHash, steps, afterReview, pinnedAccount, renderedBalanceUsd, cumulativeAmountUsd, confirmedAmountsUsd, confirmPerformed, confirmClickAttempted, spendReserved, actionId, confirmIntent, destination } satisfies ActiveSession), { mode: 0o600 });
}
function redactPayoutHandle(contents: string): string {
  if (liveCashoutHandle === null) return contents;
  const forms = new Set([liveCashoutHandle, cashoutHandleFillValue("Re-enter handle", liveCashoutHandle)].filter((form) => form.length >= 3));
  let redacted = contents;
  for (const form of forms) redacted = redacted.split(form).join("<payout-handle>");
  return redacted;
}
async function writeEvidenceFile(path: string, contents: string): Promise<void> {
  await writeFile(path, redactPayoutHandle(contents));
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
    cumulativeAmountUsd,
    renderedBalanceUsd,
    transactionHash,
    actionId,
    stoppedBefore,
    note,
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
  if (liveRefusal?.includes("recipient does not match")) incidents.push("recipient-mismatch");
  if (liveRefusal?.includes("transfer differs from the prepared amount") || liveRefusal?.includes("send value differs from the prepared amount")) incidents.push("amount-mismatch");
  if (confirmClickAttempted && !confirmPerformed) incidents.push("ambiguous-result");
  if (confirmPerformed && !finalEvidencePassed) incidents.push("post-confirm-failure");
  return [...new Set(incidents)];
}
async function reserveSpend(amountUsd: number): Promise<string | null> {
  return withLedgerLock(ledgerPath, async () => {
    const currentEntries = await readLedger(ledgerPath);
    const refusal = confirmPolicyRefusal({
      role: verifyRole,
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
  const rungReached = confirmPerformed ? 3 : withdrawalEmpty || observedReview || steps.some((step) =>
    step.status === "done" && (step.step.startsWith("expect Confirm") || step.step.startsWith("expect Review"))) ||
    (stoppedBefore !== null && matchesConfirmLabel(surface?.confirmLabels ?? [], stoppedBefore)) ? 2 : 1;
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
  await appendLedger(ledgerPath, entry);
  ledgerRecorded = true;
}
try {
  if (!active) {
  command("open", "--init-script", initPath);
  command("set", "viewport", "390", "844");
  command("network", "har", "start", "--content", live ? "text" : "all");
  if (liveWithSession) {
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
      const renderedBalance = jsonResult(command("eval", `document.querySelector('[aria-label="Total balance"] [data-slot="money-ticker"]')?.getAttribute("aria-label")||null`));
      renderedBalanceUsd = typeof renderedBalance === "string" ? parseUsdAmount(renderedBalance) : null;
      if (renderedBalanceUsd === null) throw new Error("The rendered account balance is not knowable; confirmation was refused.");
      settleBeforeLeaving();
    }
  } else if (!live) {
    for (const [pattern, body] of fixtureRoutes()) {
      command("network", "route", pattern, "--body", JSON.stringify(body));
    }
  }
  command("console", "--clear");
  command("errors", "--clear");
  if (!live) command("network", "requests", "--clear");
  }
  if (verb === "start") {
    await saveActive(false);
    await rm(tempDirectory, { recursive: true, force: true });
    console.log(`Session started: ${surfaceId}. Run verify snapshot for current controls.`);
    process.exit(0);
  }
  let afterReview = active?.afterReview ?? false;
  if (active && live && !afterReview) {
    const reviewTitle = jsonResult(command("eval", `(() => [...document.querySelectorAll('[role="dialog"]')].filter(node => node.getClientRects().length).at(-1)?.querySelector('h1,h2,[role="heading"]')?.textContent?.trim() ?? null)()`));
    afterReview = typeof reviewTitle === "string" && /^(?:Confirm|Review)(?:\s|$)/i.test(reviewTitle);
  }
  observedReview = afterReview;
  async function recoverStepFailure(error: unknown, record: StepRecord): Promise<never> {
    record.status = "failed";
    if (!active || !verb) throw error;
    const snapshot = command("snapshot", "-i");
    steps.push({ step: "snapshot", status: "done" });
    await saveActive(afterReview);
    await rm(tempDirectory, { recursive: true, force: true });
    console.error(error instanceof Error ? error.message : "The browser step failed.");
    console.log(redactPayoutHandle(snapshot));
    process.exit(1);
  }
  if (verb === "snapshot") {
    const snapshot = command("snapshot", "-i");
    steps.push({ step: "snapshot", status: "done" });
    await saveActive(afterReview);
    await rm(tempDirectory, { recursive: true, force: true });
    console.log(redactPayoutHandle(snapshot));
    process.exit(0);
  }
  const commandArgs = invocationArgs.slice(1);
  async function recoverUsage(message: string): Promise<never> {
    const record: StepRecord = { step: `${verb} usage`, status: "pending" };
    steps.push(record);
    return await recoverStepFailure(new Error(message), record);
  }
  let drivenSteps: ReachStep[] = reachSteps;
  if (verb === "goto") {
    if (commandArgs.length !== 1) await recoverUsage("Usage: verify goto </path>");
    const target = commandArgs[0];
    if (!target || !target.startsWith("/") || target.startsWith("//")) throw new Error("Goto must be an app path on the pinned origin.");
    const route = new URL(target, baseUrl);
    if (route.origin !== baseUrl.origin || /^\/api(?:\/|$)/.test(route.pathname)) throw new Error("Goto must be an app path on the pinned origin.");
    drivenSteps = [{ kind: "goto", path: target }];
  } else if (verb === "fill") {
    if (commandArgs.length !== 2) await recoverUsage("Usage: verify fill <label> <value>");
    drivenSteps = [{ kind: "fill", label: commandArgs[0], value: commandArgs[1] }];
  } else if (verb === "press") {
    if (commandArgs.length !== 1 || !commandArgs[0]) await recoverUsage("Usage: verify press <key>");
    drivenSteps = [{ kind: "press", key: commandArgs[0] }];
  } else if (verb === "click") {
    if (commandArgs.length !== 1 || !commandArgs[0]) await recoverUsage("Usage: verify click <@ref|name>");
    drivenSteps = [{ kind: "click", label: commandArgs[0] }];
  } else if (verb === "confirm") {
    if (!live && surfaceId !== "send") throw new Error(`no fixture prepared action for ${surfaceId}`);
    const controls = jsonResult(command("eval", confirmControlScript(MONEY_ACTION_ID_ATTRIBUTE)));
    if (!Array.isArray(controls) || controls.length !== 1 || typeof controls[0]?.name !== "string") throw new Error("A unique prepared money control is required.");
    drivenSteps = [{ kind: "click", label: controls[0].name }];
  } else if (verb === "finish") {
    drivenSteps = [];
  }
  for (const original of drivenSteps) {
    if (verb === "press" && live) throw new Error("Live verification refuses press steps.");
    if (verb === "fill" && live) {
      const approved = reachSteps.flatMap((item) => item.kind === "fill" ? [item.label] : []);
      if (original.kind === "fill" && !approved.includes(original.label)) throw new Error(`Live verification refuses an unlisted fill for “${original.label}”.`);
      const error = liveStepError(surface.live, original, approved);
      if (error) throw new Error(error);
      if (original.kind === "fill" && (original.label === "Cash App handle" || original.label === "Re-enter handle") &&
          liveCashoutHandle !== null && original.value !== cashoutHandleFillValue(original.label, liveCashoutHandle)) {
        throw new Error("The payout handle must match the pinned handle.");
      }
      if (original.kind === "fill" && original.label === "To" && effectiveRecipient && original.value !== recipientFillValue(effectiveRecipient)) {
        throw new Error("The recipient must match the pinned recipient.");
      }
    }
    let step: ResolvedReachStep;
    let opensReview = false;
    if (original.kind === "click-prefix") {
      const resolution = resolveClickPrefix(original.prefix, prefixButtonNames(original.prefix));
      if (resolution.action === "single") {
        step = { kind: "click", label: resolution.label };
        opensReview = original.opens === "review";
      } else {
        const detail = resolution.action === "none"
          ? "no visible enabled button matches"
          : `${resolution.candidates.length} visible buttons match: ${resolution.candidates.join("; ")}`;
        const message = `Live verification refuses click-prefix “${original.prefix}”: ${detail}.`;
        if (resolution.action === "none" && original.onNoMatch === "note") {
          steps.push({ step: `click-prefix "${original.prefix}" (nothing in flight)`, status: "done" });
          note = "No in-flight Peer cash-out to withdraw.";
          withdrawalEmpty = true;
          break;
        }
        steps.push({ step: `click-prefix "${original.prefix}"`, status: "failed" });
        liveRefusal = message;
        stoppedBefore = `click-prefix ${original.prefix}`;
        throw new Error(message);
      }
    } else {
      step = original;
    }
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
    if (live) console.error(`[live] ${new Date().toISOString()} ${description}`);
    let confirmStep = false;
    let clickRef: string | null = null;
    if (verb === "click" && step.kind === "click" && step.label.startsWith("@")) {
      let attrOutput = "";
      try { attrOutput = command("get", "attr", step.label, MONEY_ACTION_ID_ATTRIBUTE); }
      catch (error) { await recoverStepFailure(error, record); }
      const protectedRef = browserGetField(attrOutput, "value");
      if (protectedRef !== null) throw new Error("Plain click refuses an identified prepared money control; use verify confirm.");
      let labelOutput = "";
      try { labelOutput = command("get", "attr", step.label, "aria-label"); }
      catch (error) { await recoverStepFailure(error, record); }
      const label = browserGetField(labelOutput, "value");
      let htmlOutput = "";
      if (typeof label !== "string" || !label.trim()) {
        try { htmlOutput = command("get", "html", step.label); }
        catch (error) { await recoverStepFailure(error, record); }
      }
      const html = htmlOutput ? browserGetField(htmlOutput, "html") : "";
      if (typeof html !== "string") throw new Error("The clicked reference has no readable contents.");
      const name = jsonResult(command("eval", refVisibleNameScript(html, typeof label === "string" ? label : null)));
      if (typeof name !== "string" || !name) throw new Error("The clicked reference has no visible name.");
      clickRef = step.label;
      step = { kind: "click", label: name };
    }
    if ((live || verb === "confirm") && step.kind === "click") {
      confirmStep = verb === "confirm" || matchesConfirmLabel(surface.confirmLabels, step.label);
      if (verb === "click" && confirmStep) throw new Error("Plain click refuses a money confirm; use verify confirm.");
      if (live) {
        const amountClickError = opensReview ? null : unlistedAmountClickError(step.label, confirmStep);
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
      }
      if (confirmStep) {
        waitForEnabledButton(step.label);
        const controls = jsonResult(command("eval", confirmControlScript(MONEY_ACTION_ID_ATTRIBUTE)));
        if (!Array.isArray(controls) || controls.length !== 1 || typeof controls[0]?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(controls[0].id) || controls[0].name !== step.label) {
          liveRefusal = "The confirm control has no unique prepared action id.";
          record.status = "failed";
          stoppedBefore = step.label;
          await writeLiveEvidence();
          break;
        }
        const preparedId: string = controls[0].id;
        actionId = preparedId;
        command("network", "har", "stop", harPath);
        await chmod(harPath, 0o600);
        try {
          const prepared = preparedFromHar(JSON.parse(await readFile(harPath, "utf8")), baseUrl.origin, preparedId, live ? 201 : 200);
          const checked = checkPreparedAction(prepared, preparedId, surfaceId, option("--canary-operation") ?? null,
            effectiveRecipient?.address ?? null, canonicalCashoutPayoutHandle, pinnedAccount ?? "");
          parsedAmountUsd = checked.amountUsd;
        } catch (error) {
          liveRefusal = error instanceof Error ? error.message : "The prepared action could not be checked.";
          record.status = "failed";
          stoppedBefore = step.label;
          await writeLiveEvidence();
          break;
        }
        if (live) {
          liveRefusal = enforceAmountCap(parsedAmountUsd, maxUsd ?? Number.NaN);
          if (!liveRefusal && parsedAmountUsd !== null) {
            liveRefusal = enforceCumulativeAmountCap(cumulativeAmountUsd, parsedAmountUsd, maxUsdTotal ?? Number.NaN);
          }
          if (!liveRefusal && maxUsd !== null && maxUsdTotal !== null) {
            liveRefusal = confirmPolicyRefusal({
              role: verifyRole,
              amountUsd: parsedAmountUsd,
              balanceUsd: renderedBalanceUsd,
              runSpendUsd: spendForRun(ledgerEntries, session),
              todayFactorySpendUsd: spendForDay(ledgerEntries, new Date().toISOString().slice(0, 10)),
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
            recipient: canonicalCashoutPayoutHandle === null ? effectiveRecipient : { name: null, address: canonicalCashoutPayoutHandle },
            timestamp: new Date().toISOString(),
          };
        }
        confirmClickAttempted = true;
        await writeLiveEvidence();
      }
    }
    try {
      if (confirmStep && actionId) {
        command("click", `[${MONEY_ACTION_ID_ATTRIBUTE}="${actionId}"]`);
      } else {
        if (step.kind === "click") {
          const protectedControl = jsonResult(command("eval", protectedControlScript(MONEY_ACTION_ID_ATTRIBUTE, step.label)));
          if (protectedControl) throw new Error("Plain click refuses a prepared money control; use verify confirm.");
        }
        try {
          if (clickRef) command("click", clickRef);
          else executeStep(step);
        } catch (error) {
          await recoverStepFailure(error, record);
        }
      }
      record.status = "done";
      if (confirmStep && parsedAmountUsd !== null) {
        confirmPerformed = true;
        cumulativeAmountUsd += parsedAmountUsd;
        confirmedAmountsUsd.push(parsedAmountUsd);
        await writeLiveEvidence();
        if (verb === "confirm") command("network", "har", "start", "--content", live ? "text" : "all");
      }
    } catch (error) {
      record.status = "failed";
      await writeLiveEvidence();
      throw error;
    }
    if (step.kind === "expect" && /^(?:Confirm|Review)/i.test(step.text)) {
      afterReview = true;
      observedReview = true;
    }
  }
  if (verb && verb !== "finish") {
    if (liveRefusal || stoppedBefore) throw new Error(liveRefusal ?? `Verification stopped before ${stoppedBefore}.`);
    if (live) {
      unexpectedHosts = observeUnexpectedHosts();
      const hostError = hostObservationRefusal(unexpectedHosts);
      if (hostError) throw new Error(hostError);
    }
    await saveActive(afterReview);
    await rm(tempDirectory, { recursive: true, force: true });
    console.log(steps.at(-1)?.step ?? "done");
    process.exit(0);
  }
  const budgets = effectiveBudgets(surface, live);
  const requiredMarks = Object.keys(budgets);
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
  const markNames = new Set([...Object.keys(budgets), ...(performance.marks ?? []).map((mark) => mark.name).filter((name) => ["shell:paint", "session:verified", "balances:painted", "action:first-interactive"].includes(name))]);
  const marks: MarkResult[] = [...markNames].map((name) => {
    const startTime = performance.marks?.find((mark) => mark.name === name)?.startTime ?? null;
    const budgetMs = budgets[name] ?? null;
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
  await writeEvidenceFile(summaryPath, summarizeEvidence(evidence, live ? "live" : "fixture", note ?? undefined));
  if (live) {
    transactionHash = domText.match(/\b0x[0-9a-fA-F]{64}\b/)?.[0] ?? null;
    actionId = actionId ?? domText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0] ?? null;
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
    try {
      command("screenshot", "--full", screenshotPath);
      await chmod(screenshotPath, 0o600);
      const failedDom = jsonResult(command("eval", "document.body.innerText"));
      await writeEvidenceFile(domPath, typeof failedDom === "string" ? failedDom : JSON.stringify(failedDom, null, 2));
    } catch (captureError) {
      console.error(`Failure artifacts were not captured: ${captureError instanceof Error ? captureError.message : String(captureError)}`);
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
  if (verb && verb !== "start") await rm(activePath, { force: true });
}
process.exit(exitCode);
