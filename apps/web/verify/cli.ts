import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { MONEY_ACTION_ID_ATTRIBUTE } from "../shared/money-actions";
import { finalizeEvidence, summarizeEvidence } from "./evidence";
import { fixtureRoutes, requiresSignedInFixture } from "./fixtures";
import { defaultOtpSender, gmailCredentialsPath, pollGmailOtp, readGmailCredentials, runGmailAuth, verifyAccountEmail, type GmailCredentials } from "./gmail";
import { appendLedger, confirmsForDay, confirmsForRun, readLedger, withLedgerLock, type LedgerEntry } from "./ledger";
import { automationEnvironmentError, composeAllowedDomains, hostObservationRefusal, outputInsideRepository, unexpectedNetworkHosts } from "./live";
import { readFeatureMap } from "./map";
import { confirmCountRefusal, requestedConfirmLimit, resolveVerifyRole, verifyPolicy, type VerifyRole } from "./policy";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const { surfaces, liveHosts } = await readFeatureMap(resolve(repositoryRoot, ".agents/skills/browser-iteration/feature-map.md"));
const ledgerPath = resolve(homedir(), ".home-verify", "ledger.jsonl");
const invocation = Bun.argv.slice(2);
const sessionFlags = invocation.flatMap((argument, index) => argument === "--session" ? [index] : []);
const sessionName = sessionFlags.length ? invocation[sessionFlags[0] + 1] : "active-session";
if (sessionFlags.length > 1 || !sessionName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(sessionName)) {
  console.error("--session requires one safe name of 1–64 letters, digits, dots, underscores, or hyphens.");
  process.exit(2);
}
const activePath = resolve(homedir(), ".home-verify", `${sessionName}.json`);
const argumentsWithoutSession = sessionFlags.length ? invocation.filter((_, index) => index !== sessionFlags[0] && index !== sessionFlags[0] + 1) : invocation;
const verb = argumentsWithoutSession[0];
const commandArgs = argumentsWithoutSession.slice(1);
const role = resolveVerifyRole(process.env.HOME_VERIFY_ROLE);
const ledgerRole = role;

const option = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const options = (args: string[], name: string) => args.flatMap((value, index) => value === name ? [args[index + 1] ?? ""] : []);
const flag = (args: string[], name: string) => args.includes(name);
const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
const handleHash = () => process.env.HOME_VERIFY_CASHOUT_HANDLE ? createHash("sha256").update(process.env.HOME_VERIFY_CASHOUT_HANDLE.trim()).digest("hex") : null;

function revision(): string {
  const result = Bun.spawnSync({ cmd: ["git", "rev-parse", "origin/main"], cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("Could not resolve origin/main for the verification ledger.");
  return result.stdout.toString().trim();
}

let fixtureAllowedDomains: string | undefined;
function browserCommand(session: string, live: boolean, input: string | undefined, ...args: string[]): string {
  const env: Record<string, string | undefined> = { ...process.env, AGENT_BROWSER_SESSION: session,
    AGENT_BROWSER_MAX_OUTPUT: "12000", AGENT_BROWSER_DEFAULT_TIMEOUT: live ? "600000" : "25000" };
  delete env.HOME_ACCESS_PASSWORD;
  if (!live && fixtureAllowedDomains) env.AGENT_BROWSER_ALLOWED_DOMAINS = fixtureAllowedDomains;
  const result = Bun.spawnSync({ cmd: ["bunx", "agent-browser", "--session", session, ...args, "--json"], cwd: repositoryRoot,
    env, stdin: input === undefined ? undefined : Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`agent-browser ${args[0]} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim() || result.exitCode}`);
  return result.stdout.toString().trim();
}

function data(output: string): Record<string, unknown> {
  const parsed = JSON.parse(output) as { data?: Record<string, unknown> };
  if (!parsed.data || typeof parsed.data !== "object") throw new Error("agent-browser returned an invalid result.");
  return parsed.data;
}

function browserField(output: string, name: string): unknown {
  const parsed = data(output);
  if (!Object.hasOwn(parsed, name)) throw new Error(`agent-browser did not return ${name}.`);
  return parsed[name];
}

function messages(output: string, level?: string): string[] {
  const values = Object.values(data(output)).find(Array.isArray) ?? [];
  return values.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (level && record.type !== level && record.level !== level) return [];
    const text = record.text ?? record.message ?? record.error;
    return typeof text === "string" ? [text] : [];
  });
}

function hostObserver(): string {
  return `window.__homeVerifyHosts=[];const record=(value)=>{try{window.__homeVerifyHosts.push(new URL(String(value),location.href).hostname.toLowerCase())}catch{}};const originalFetch=window.fetch;window.fetch=(input,init)=>{record(typeof input==="string"?input:input.url);return originalFetch(input,init)};const originalOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){record(url);return originalOpen.call(this,method,url,...rest)};const OriginalWebSocket=window.WebSocket;window.WebSocket=function(url,protocols){record(url);return new OriginalWebSocket(url,protocols)};window.WebSocket.prototype=OriginalWebSocket.prototype;const originalBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(url,body)=>{record(url);return originalBeacon(url,body)};`;
}

function secretFill(session: string, label: string, secret: string): void {
  const script = `(()=>{const name=${JSON.stringify(label)};const matched=[...document.querySelectorAll('label')].find(node=>node.textContent?.replace(/\\*/g,'').trim()===name);const field=[...document.querySelectorAll('input')].find(input=>input.getAttribute('aria-label')===name||matched?.contains(input)||(input.id&&matched?.htmlFor===input.id));if(!field)throw new Error('Secret field unavailable');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(field,${JSON.stringify(secret)});field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));return true})()`;
  try { browserCommand(session, true, script, "eval", "--stdin"); }
  catch { throw new Error(`Could not fill ${label} during authentication.`); }
}

function accountEmail(): string {
  return verifyAccountEmail(process.env);
}

if (verb === "--list") {
  for (const surface of surfaces.values()) console.log(`${surface.id}: ${surface.manual ? "manual" : "automated"}`);
  process.exit(0);
}
if (verb === "status") {
  const entries = await readLedger(ledgerPath);
  const count = confirmsForDay(entries, new Date().toISOString().slice(0, 10));
  console.log(`role: ${role}`);
  console.log(`today's confirms: ${count} / ${verifyPolicy.perDayConfirms}`);
  console.log(`default session limit: ${verifyPolicy.perSessionConfirms}`);
  for (const entry of entries.filter((item) => item.incidents.length).slice(-5)) {
    console.log(`${entry.timestamp} ${entry.surface} @ ${entry.host}: ${entry.incidents.join(", ")}`);
  }
  process.exit(0);
}
if (verb === "gmail-auth") {
  try {
    const email = accountEmail();
    console.log(`Sign in as ${email} to authorize Gmail readonly access.`);
    const portValue = option(commandArgs, "--port");
    const port = portValue === undefined ? undefined : Number(portValue);
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error("--port must be an integer between 0 and 65535.");
    await runGmailAuth(gmailCredentialsPath(process.env), { open: !flag(commandArgs, "--no-open"), port });
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Gmail authorization failed.");
    process.exit(1);
  }
}

if (verb === "live-login") {
  const baseValue = option(commandArgs, "--base-url");
  if (!baseValue || automationEnvironmentError(process.env)) {
    console.error(automationEnvironmentError(process.env) ?? "Live login requires --base-url <url>.");
    process.exit(2);
  }
  const base = new URL(baseValue);
  const directory = resolve(homedir(), ".home-verify", base.host.replaceAll(/[^a-zA-Z0-9._-]/g, "_"), "state");
  const session = `home-verify-login-${crypto.randomUUID().slice(0, 8)}`;
  let result = 1;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(resolve(homedir(), ".home-verify"), 0o700);
    await chmod(resolve(directory, ".."), 0o700);
    await chmod(directory, 0o700);
    const run = (...args: string[]) => browserCommand(session, true, undefined, ...args);
    run("open", "--headed");
    run("navigate", new URL("/?account=signin", base).toString());
    const pageUrl = browserField(run("get", "url"), "url");
    if (typeof pageUrl === "string" && new URL(pageUrl).pathname === "/access") {
      const password = process.env.HOME_ACCESS_PASSWORD;
      if (!password) throw new Error("This deployment requires HOME_ACCESS_PASSWORD in the operator environment.");
      secretFill(session, "Access password", password);
      run("find", "role", "button", "click", "--name", "Continue", "--exact");
      run("navigate", new URL("/?account=signin", base).toString());
    }
    const email = accountEmail();
    run("find", "label", "Email address", "fill", email, "--exact");
    const submittedAt = Date.now();
    run("find", "role", "button", "click", "--name", "Continue with email", "--exact");
    const credentials = await readGmailCredentials(gmailCredentialsPath(process.env)) as Required<GmailCredentials>;
    const code = await pollGmailOtp(credentials, process.env.HOME_VERIFY_OTP_SENDER ?? defaultOtpSender, submittedAt);
    secretFill(session, "Verification code", code);
    run("find", "role", "button", "click", "--name", "Verify and continue", "--exact");
    run("wait", "--url", `${base.origin}/home*`);
    const statePath = resolve(directory, "browser-state.json");
    run("state", "save", statePath);
    await chmod(statePath, 0o600);
    const provenance = { version: 1, emailHash: emailHash(email), createdAt: new Date().toISOString(), role };
    const provenancePath = resolve(directory, "provenance.json");
    await writeFile(provenancePath, `${JSON.stringify(provenance)}\n`, { mode: 0o600 });
    await chmod(provenancePath, 0o600);
    console.log(`Saved a private live session for ${base.host}.`);
    result = 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Live login failed.");
  } finally {
    try { browserCommand(session, true, undefined, "close"); }
    catch { result = 1; }
  }
  process.exit(result);
}

type StepRecord = { step: string; status: "done" | "failed" };
type ActiveSession = {
  options: string[];
  browserSession: string;
  role: VerifyRole;
  live: boolean;
  allowConfirm: boolean;
  maxConfirms: number;
  handleHash: string | null;
  steps: StepRecord[];
  actionIds: string[];
  confirmPerformed: number;
  confirmClickAttempted: boolean;
  destination: string;
};

if (verb === "start" && await Bun.file(activePath).exists()) {
  console.error(`An active verify session named ${sessionName} already exists; finish it first.`);
  process.exit(2);
}
let active: ActiveSession | null = null;
if (verb !== "start") {
  try { active = JSON.parse(await readFile(activePath, "utf8")) as ActiveSession; }
  catch { console.error("No active verify session; run verify start <surface> first."); process.exit(2); }
}
if (verb !== "start" && !["snapshot", "click", "fill", "press", "goto", "confirm", "finish"].includes(verb ?? "")) {
  console.error("Use verify start <surface>, snapshot, click, fill, press, goto, confirm, or finish.");
  process.exit(2);
}
if (verb !== "start" && ["--live", "--allow-confirm", "--max-confirms", "--allow-domain", "--base-url", "--out", "--allow-console"].some((name) => commandArgs.includes(name))) {
  console.error("Session authority and options are fixed at start.");
  process.exit(2);
}
const args = verb === "start" ? commandArgs : active!.options;
const surfaceId = args[0];
const surface = surfaces.get(surfaceId);
if (!surface) {
  console.error(`Unknown surface id: ${surfaceId ?? "none"}. Available: ${[...surfaces.keys()].join(", ")}`);
  process.exit(2);
}
const live = flag(args, "--live");
const allowConfirm = flag(args, "--allow-confirm");
const baseValue = option(args, "--base-url");
if (live && !baseValue) { console.error("Live verification requires --base-url <url>."); process.exit(2); }
const environmentError = live ? automationEnvironmentError(process.env) : null;
if (environmentError) { console.error(environmentError); process.exit(2); }
if (["--max-usd", "--max-usd-total", "--recipient", "--canary-operation", "--account"].some((name) => flag(args, name))) {
  console.error("Amount, recipient, account, and canary flags are retired; the agent reviews the page.");
  process.exit(2);
}
if (args.filter((value) => value === "--max-confirms").length > 1 ||
    (flag(args, "--max-confirms") && option(args, "--max-confirms") === undefined)) {
  console.error("--max-confirms requires one explicit integer value.");
  process.exit(2);
}
const maxConfirms = requestedConfirmLimit(option(args, "--max-confirms"));
if (!live && (allowConfirm || flag(args, "--max-confirms"))) {
  console.error("Fixture confirmations need no live authority or count flags.");
  process.exit(2);
}
if (allowConfirm && role !== "operator") { console.error("Live confirmation requires the operator role."); process.exit(2); }
if (active && (active.role !== role || active.live !== live || active.allowConfirm !== allowConfirm || active.maxConfirms !== maxConfirms || active.handleHash !== handleHash())) {
  console.error("The verify role, authority, confirm limit, or payout handle changed during the session.");
  process.exit(2);
}
const baseUrl = new URL(baseValue ?? "http://localhost:3200");
const stateDirectory = resolve(homedir(), ".home-verify", baseUrl.host.replaceAll(/[^a-zA-Z0-9._-]/g, "_"), "state");
const statePath = resolve(stateDirectory, "browser-state.json");
async function verifyProvenance(): Promise<void> {
  if (!live) return;
  const path = resolve(stateDirectory, "provenance.json");
  try {
    const source = JSON.parse(await readFile(path, "utf8")) as { version?: number; emailHash?: string; createdAt?: string; role?: string };
    if (source.version !== 1 || source.emailHash !== emailHash(accountEmail()) || source.role !== role ||
      !source.createdAt || !Number.isFinite(Date.parse(source.createdAt)) || Date.parse(source.createdAt) > Date.now()) throw new Error("provenance mismatch");
    const [stateInfo, provenanceInfo] = await Promise.all([stat(statePath), stat(path)]);
    if ((stateInfo.mode & 0o077) !== 0 || (provenanceInfo.mode & 0o077) !== 0) throw new Error("private state mode mismatch");
  } catch {
    throw new Error(`No matching live-login provenance exists for ${baseUrl.host}; run verify live-login --base-url ${baseUrl.origin}.`);
  }
}
try { await verifyProvenance(); }
catch (error) { console.error(error instanceof Error ? error.message : "Live provenance is unavailable."); process.exit(2); }
const outputRoot = resolve(option(args, "--out") ?? ".verify");
if (live && outputInsideRepository(outputRoot, repositoryRoot)) { console.error("Live evidence --out must be outside the repository root."); process.exit(2); }
const allowedDomains = composeAllowedDomains(baseUrl, live ? [...liveHosts, ...options(args, "--allow-domain")] : options(args, "--allow-domain"), !live);
if (!live) fixtureAllowedDomains = allowedDomains.join(",");
const browserSession = active?.browserSession ?? `home-verify-${surfaceId}-${crypto.randomUUID().slice(0, 8)}`;
const destination = active?.destination ?? (live ? resolve(outputRoot, surfaceId, new Date().toISOString()) : resolve(outputRoot, surfaceId));
const steps = active?.steps ?? [];
const actionIds = active?.actionIds ?? [];
let confirmed = active?.confirmPerformed ?? 0;
let clickAttempted = active?.confirmClickAttempted ?? false;
let unexpectedHosts: string[] = [];
let finalEvidencePassed = false;
const run = (...arguments_: string[]) => browserCommand(browserSession, live, undefined, ...arguments_);
const tempDirectory = await mkdtemp(resolve(tmpdir(), "home-verify-"));
const initPath = resolve(tempDirectory, `init-${browserSession}.js`);
const summaryPath = resolve(destination, "summary.md");
const livePath = resolve(destination, "live.json");

async function saveActive(): Promise<void> {
  await mkdir(resolve(homedir(), ".home-verify"), { recursive: true, mode: 0o700 });
  await chmod(resolve(homedir(), ".home-verify"), 0o700);
  const record: ActiveSession = { options: args, browserSession, role, live, allowConfirm, maxConfirms,
    handleHash: handleHash(), steps, actionIds, confirmPerformed: confirmed, confirmClickAttempted: clickAttempted, destination };
  await writeFile(activePath, JSON.stringify(record), { mode: 0o600 });
  await chmod(activePath, 0o600);
}

async function evidenceFile(path: string, text: string): Promise<void> {
  await writeFile(path, text, { mode: live ? 0o600 : 0o644 });
  if (live) await chmod(path, 0o600);
}

async function writeLiveEvidence(): Promise<void> {
  if (!live) return;
  await evidenceFile(livePath, `${JSON.stringify({ baseHost: baseUrl.host, surface: surfaceId, role,
    steps, actionIds, confirmed, maxConfirms, unexpectedHosts }, null, 2)}\n`);
}

function networkUrls(): string[] {
  const items = Object.values(data(run("network", "requests"))).find(Array.isArray) ?? [];
  return items.flatMap((item) => typeof item === "object" && item !== null && typeof item.url === "string" ? [item.url] : []);
}

function observeHosts(): string[] {
  const observed = browserField(run("eval", "[...new Set(window.__homeVerifyHosts||[])]"), "result");
  const scripted = Array.isArray(observed) ? observed.flatMap((host) => typeof host === "string" ? [`https://${host}`] : []) : [];
  return unexpectedNetworkHosts([...networkUrls(), ...scripted], allowedDomains);
}

function enforceHosts(): void {
  if (!live) return;
  unexpectedHosts = observeHosts();
  const refusal = hostObservationRefusal(unexpectedHosts);
  if (refusal) throw new Error(refusal);
}

function snapshot(): string { return run("snapshot", "-i"); }

async function recover(error: unknown, step: string): Promise<number> {
  steps.push({ step, status: "failed" });
  const fresh = snapshot();
  steps.push({ step: "snapshot", status: "done" });
  await saveActive();
  console.error(error instanceof Error ? error.message : "The browser step failed.");
  console.log(fresh);
  return 1;
}

async function reserveConfirm(id: string): Promise<void> {
  const refusal = await withLedgerLock(ledgerPath, async () => {
    const entries = await readLedger(ledgerPath);
    const day = new Date().toISOString().slice(0, 10);
    const problem = confirmCountRefusal(confirmsForRun(entries, browserSession), confirmsForDay(entries, day), maxConfirms);
    if (problem) return problem;
    const entry: LedgerEntry = { type: "run", timestamp: new Date().toISOString(), runId: browserSession,
      host: baseUrl.host, surface: surfaceId, role: ledgerRole, mainRevision: revision(), rungReached: 3,
      confirmCount: 1, actionIds: [id], incidents: [], clean: false };
    await appendLedger(ledgerPath, entry);
    return null;
  });
  if (refusal) throw new Error(refusal);
}

async function recordLedger(): Promise<void> {
  if (!live) return;
  const incidents = [...(unexpectedHosts.length ? ["unexpected-host"] : []),
    ...(clickAttempted && confirmed < actionIds.length ? ["ambiguous-result"] : []),
    ...(confirmed > 0 && !finalEvidencePassed ? ["post-confirm-failure"] : [])];
  await appendLedger(ledgerPath, { type: "run", timestamp: new Date().toISOString(), runId: browserSession,
    host: baseUrl.host, surface: surfaceId, role, mainRevision: revision(), rungReached: confirmed ? 3 : 1,
    confirmCount: 0, actionIds: [], incidents, clean: finalEvidencePassed && incidents.length === 0 });
}

async function finish(): Promise<void> {
  enforceHosts();
  const screenshotPath = resolve(destination, "screenshot.png");
  run("screenshot", "--full", screenshotPath);
  if (live) await chmod(screenshotPath, 0o600);
  await evidenceFile(resolve(destination, "snapshot.txt"), snapshot());
  const evidence = finalizeEvidence({ surfaceId, baseUrl: baseUrl.origin, capturedAt: new Date().toISOString(),
    steps, artifacts: { screenshot: "screenshot.png", snapshot: "snapshot.txt" }, actionIds,
    consoleErrors: messages(run("console"), "error"), pageErrors: messages(run("errors")), unexpectedHosts }, flag(args, "--allow-console"));
  finalEvidencePassed = evidence.passed;
  await evidenceFile(resolve(destination, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await evidenceFile(summaryPath, summarizeEvidence(evidence, live ? "live" : "fixture"));
  await writeLiveEvidence();
  console.log(summaryPath);
  if (!evidence.passed) throw new Error("The verification evidence did not pass.");
}

let exitCode = 1;
let keepOpen = false;
let browserOpened = active !== null;
try {
  if (verb === "start") {
    await mkdir(destination, { recursive: true, mode: live ? 0o700 : 0o755 });
    if (live) await chmod(destination, 0o700);
    if (live) await writeFile(initPath, hostObserver(), { mode: 0o600 });
    run("open", ...(live ? ["--init-script", initPath] : []));
    browserOpened = true;
    run("set", "viewport", "390", "844");
    if (live) run("state", "load", statePath);
    else {
      run("navigate", baseUrl.origin);
      for (const [pattern, body] of fixtureRoutes()) run("network", "route", pattern, "--body", JSON.stringify(body));
      if (requiresSignedInFixture(surfaceId)) {
        run("storage", "session", "set", "home:playwright-smoke:signed-in", "1");
        run("storage", "local", "set", "home.country.v1", "US");
      }
      run("navigate", baseUrl.origin);
    }
    run("console", "--clear");
    run("errors", "--clear");
    await saveActive();
    console.log(`Session started: ${surfaceId}. Run verify snapshot to navigate.`);
    exitCode = 0;
    keepOpen = true;
  } else if (verb === "finish") {
    await finish();
    exitCode = 0;
  } else if (verb === "snapshot") {
    enforceHosts();
    const captured = snapshot();
    steps.push({ step: "snapshot", status: "done" });
    await saveActive();
    console.log(captured);
    exitCode = 0;
    keepOpen = true;
  } else if (verb === "confirm") {
    if (!live && surfaceId !== "send") throw new Error(`no fixture prepared action for ${surfaceId}`);
    if (live && (!allowConfirm || role !== "operator")) throw new Error("Live confirmation requires operator --allow-confirm fixed at start.");
    enforceHosts();
    const selector = `[${MONEY_ACTION_ID_ATTRIBUTE}]`;
    const count = browserField(run("get", "count", selector), "count");
    if (count !== 1) throw new Error("Exactly one marked money control is required.");
    const id = browserField(run("get", "attr", selector, MONEY_ACTION_ID_ATTRIBUTE), "value");
    if (typeof id !== "string" || !id) throw new Error("The marked money control has no action id.");
    const enabled = browserField(run("is", "enabled", selector), "enabled");
    if (enabled === false) {
      exitCode = await recover(new Error("The marked money control is disabled; inspect the snapshot and retry when ready."), "confirm disabled");
      keepOpen = true;
    } else {
      if (enabled !== true) throw new Error("The marked money control readiness is unavailable.");
      if (live) await reserveConfirm(id);
      actionIds.push(id);
      clickAttempted = true;
      await saveActive();
      await writeLiveEvidence();
      run("click", selector);
      confirmed += 1;
      clickAttempted = false;
      steps.push({ step: "confirm", status: "done" });
      await saveActive();
      await writeLiveEvidence();
      console.log(`Confirmed marked action ${id}.`);
      exitCode = 0;
      keepOpen = true;
    }
  } else if (verb === "goto" || verb === "click" || verb === "fill" || verb === "press") {
    if (verb === "press" && live) throw new Error("Live verification refuses press steps.");
    if (verb === "goto") {
      if (commandArgs.length !== 1) { exitCode = await recover(new Error("Usage: verify goto </path>"), "goto usage"); keepOpen = true; }
      else {
        const target = commandArgs[0];
        if (!target.startsWith("/") || target.startsWith("//")) throw new Error("Goto must be an app path on the pinned origin.");
        const url = new URL(target, baseUrl);
        if (url.origin !== baseUrl.origin || /^\/api(?:\/|$)/.test(url.pathname)) throw new Error("Goto must be an app path on the pinned origin.");
        try { run("navigate", url.toString()); enforceHosts(); steps.push({ step: `goto ${target}`, status: "done" }); await saveActive(); exitCode = 0; keepOpen = true; }
        catch (error) { if (error instanceof Error && error.message.startsWith("Unexpected network hosts")) throw error; exitCode = await recover(error, `goto ${target}`); keepOpen = true; }
      }
    } else if (verb === "click") {
      if (commandArgs.length !== 1 || !commandArgs[0]) { exitCode = await recover(new Error("Usage: verify click <@ref|name>"), "click usage"); keepOpen = true; }
      else {
        const target = commandArgs[0];
        let ref: string;
        if (target.startsWith("@")) ref = target;
        else {
          const refs = data(snapshot()).refs;
          const matches = refs && typeof refs === "object" ? Object.entries(refs).filter(([, entry]) =>
            entry && typeof entry === "object" && (entry as { name?: unknown }).name === target).map(([key]) => `@${key}`) : [];
          if (matches.length !== 1) { exitCode = await recover(new Error(`Expected one “${target}” control; found ${matches.length}. Use an @ref from the snapshot.`), `click ${target}`); keepOpen = true; }
          ref = matches[0];
        }
        if (!keepOpen) {
          const marker = browserField(run("get", "attr", ref!, MONEY_ACTION_ID_ATTRIBUTE), "value");
          if (marker !== null) throw new Error("Plain click refuses a marked money control; use verify confirm.");
          try { run("click", ref!); enforceHosts(); steps.push({ step: `click ${target}`, status: "done" }); await saveActive(); exitCode = 0; keepOpen = true; }
          catch (error) { if (error instanceof Error && error.message.startsWith("Unexpected network hosts")) throw error; exitCode = await recover(error, `click ${target}`); keepOpen = true; }
        }
      }
    } else if (verb === "fill") {
      if (commandArgs.length !== 2) { exitCode = await recover(new Error("Usage: verify fill <label> <value>"), "fill usage"); keepOpen = true; }
      else {
        try {
          if (commandArgs[0].startsWith("@")) run("fill", commandArgs[0], commandArgs[1]);
          else run("find", "label", commandArgs[0], "fill", commandArgs[1], "--exact");
          enforceHosts(); steps.push({ step: `fill ${commandArgs[0]}`, status: "done" }); await saveActive(); exitCode = 0; keepOpen = true;
        }
        catch (error) { if (error instanceof Error && error.message.startsWith("Unexpected network hosts")) throw error; exitCode = await recover(error, `fill ${commandArgs[0]}`); keepOpen = true; }
      }
    } else {
      if (commandArgs.length !== 1) { exitCode = await recover(new Error("Usage: verify press <key>"), "press usage"); keepOpen = true; }
      else {
        try { run("press", commandArgs[0]); steps.push({ step: `press ${commandArgs[0]}`, status: "done" }); await saveActive(); exitCode = 0; keepOpen = true; }
        catch (error) { exitCode = await recover(error, `press ${commandArgs[0]}`); keepOpen = true; }
      }
    }
    if (exitCode === 0) console.log(steps.at(-1)?.step ?? "done");
  }
} catch (error) {
  console.error(clickAttempted ? `${error instanceof Error ? error.message : "Verification failed."} A confirm click may have been dispatched; check Activity before retrying.` : error instanceof Error ? error.message : "Verification failed.");
  try { unexpectedHosts = live ? observeHosts() : []; await writeLiveEvidence(); }
  catch { /* capture failure does not grant authority */ }
} finally {
  if (!keepOpen && browserOpened) {
    try {
      if (live) { run("state", "save", statePath); await chmod(statePath, 0o600); }
      run("close");
    } catch (error) { console.error(error instanceof Error ? error.message : "Could not close browser or save state."); exitCode = 1; }
    try { await recordLedger(); }
    catch (error) { console.error(error instanceof Error ? error.message : "Could not write the verification ledger."); exitCode = 1; }
    if (verb !== "start") await rm(activePath, { force: true });
  }
  await rm(tempDirectory, { recursive: true, force: true });
}
process.exit(exitCode);
