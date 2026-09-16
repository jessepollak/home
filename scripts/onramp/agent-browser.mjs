#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CdpClient,
  HarnessError,
  assertAgentBrowserVersion,
  assertLocalOrigin,
  assertLoopbackCdpUrl,
  assertNodeVersion,
  assertPaymentGuards,
  buildAgentBrowserArgv,
  createAgentBrowserEnvironment,
  createStepOrder,
  formatSummary,
  pollForCoinbaseTarget,
  redactSensitive,
} from "./agent-browser-lib.mjs";

const SESSION = "home-coinbase-onramp-sandbox";
const DEFAULT_ORIGIN = "http://localhost:3000";
const PHONE = "+10005550199";
const EMAIL = "home-563@sandbox.test";
const SANDBOX_OTP = "000000";
const SYNTHETIC_SSN4 = "0000";
const SYNTHETIC_DOB = "01/01/1990";
const COMMAND_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 5 * 60_000;
const TARGET_TIMEOUT_MS = 45_000;
const TERMINAL_TIMEOUT_MS = 2 * 60_000;

const RECOVERY = Object.freeze({
  optin: "recovery: set COINBASE_ONRAMP_AGENT_BROWSER_LIVE=1 outside CI and rerun",
  origin: "recovery: rerun with --origin http://localhost:<port>",
  binary: "recovery: install agent-browser and set HOME_AGENT_BROWSER_BIN to its absolute path",
  version: "recovery: upgrade agent-browser to version 0.21.0 or newer",
  "node-version": "recovery: run the harness with Node 22 or newer",
  argv: "recovery: remove unsupported browser profile or state configuration and rerun",
  session: "recovery: close the named harness session and rerun",
  auth: "recovery: rerun and complete Home sign-in in the headed window before the checkpoint expires",
  "home-flow": "recovery: verify the local sandbox server environment and restart the command",
  cdp: "recovery: upgrade agent-browser, close the named session, and rerun",
  "iframe-zero": "recovery: merge #562, verify Coinbase sandbox server setup, and start a new order",
  "iframe-multiple": "recovery: close the named session and rerun with only one Add money flow open",
  "coinbase-screen": "recovery: close the failed order and start a new Coinbase sandbox order",
  "payment-guard": "recovery: stop and rerun only after every Home and Coinbase sandbox label is visible",
  terminal: "recovery: inspect local server logs, then rerun with a new sandbox order",
  cleanup: `recovery: run agent-browser --session ${SESSION} close, verify it succeeds, then rerun`,
  signal: "recovery: rerun the command after the named session is closed",
  "step-order": "recovery: report the harness ordering failure before retrying",
  unknown: "recovery: verify local setup and rerun the sandbox harness",
});

function parseArguments(argv) {
  if (argv.length === 0) return { origin: DEFAULT_ORIGIN };
  if (argv.length === 2 && argv[0] === "--origin") return { origin: argv[1] };
  throw new HarnessError("origin", "Only --origin http://localhost:<port> is supported");
}

function emit(output, stage, status) {
  output.write(`${formatSummary(stage, status)}\n`);
}

function runProcess(file, args, { environment, timeoutMs = COMMAND_TIMEOUT_MS, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(file, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const append = (current, chunk) => `${current}${chunk}`.slice(-32_768);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new HarnessError("home-flow", "Browser command timed out"));
      }
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new HarnessError("binary", "agent-browser could not be executed"));
      }
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const result = { code, stdout, stderr: redactSensitive(stderr) };
      if (code !== 0 && !allowFailure) {
        reject(new HarnessError("home-flow", result.stderr || "agent-browser command failed"));
      } else resolve(result);
    });
  });
}

function deepDomPrelude() {
  return `
    const elements = [];
    const roots = [document];
    for (let r = 0; r < roots.length; r += 1) {
      for (const element of roots[r].querySelectorAll('*')) {
        elements.push(element);
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
    };
  `;
}

function visibleTextExpression() {
  return `(() => { ${deepDomPrelude()} return elements.filter(visible).map((element) => element.innerText || '').join(' '); })()`;
}

function fillExpression(value, keywords, { otp = false } = {}) {
  return `(() => {
    ${deepDomPrelude()}
    const value = ${JSON.stringify(value)};
    const keywords = ${JSON.stringify(keywords)};
    const inputs = elements.filter((element) => element instanceof HTMLInputElement && visible(element));
    const metadata = (input) => [input.name, input.id, input.type, input.placeholder, input.autocomplete,
      input.getAttribute('aria-label'), ...Array.from(input.labels || []).map((label) => label.textContent)].join(' ').toLowerCase();
    let matches = inputs.filter((input) => keywords.some((keyword) => metadata(input).includes(keyword)));
    if (${otp ? "true" : "false"}) {
      const digits = inputs.filter((input) => input.maxLength === 1);
      if (digits.length >= value.length) matches = digits.slice(0, value.length);
    }
    if (matches.length === 0) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (${otp ? "true" : "false"} && matches.length >= value.length && matches.every((input) => input.maxLength === 1)) {
      matches.slice(0, value.length).forEach((input, index) => {
        setter.call(input, value[index]); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } else {
      setter.call(matches[0], value); matches[0].dispatchEvent(new Event('input', { bubbles: true })); matches[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`;
}

function clickExpression(labels) {
  return `(() => {
    ${deepDomPrelude()}
    const labels = ${JSON.stringify(labels)}.map((label) => label.toLowerCase());
    const candidates = elements.filter((element) => visible(element) && (element instanceof HTMLButtonElement || element.getAttribute('role') === 'button'));
    let button = null;
    for (const label of labels) {
      button = candidates.find((element) => (element.innerText || element.getAttribute('aria-label') || '').trim().toLowerCase().includes(label));
      if (button) break;
    }
    if (!button) return false;
    button.click(); return true;
  })()`;
}

async function waitForCdpText(cdp, pattern, timeoutMs = COMMAND_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = String(await cdp.evaluate(visibleTextExpression()) ?? "");
    if (pattern.test(text)) return text;
    await sleep(400);
  }
  throw new HarnessError("coinbase-screen", "Expected Coinbase sandbox screen timed out");
}

async function waitForNewCdpText(cdp, pattern, previousText, timeoutMs = COMMAND_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = String(await cdp.evaluate(visibleTextExpression()) ?? "");
    if (text !== previousText && pattern.test(text)) return text;
    await sleep(400);
  }
  throw new HarnessError("coinbase-screen", "Expected new Coinbase sandbox screen timed out");
}

async function fillRequired(cdp, value, keywords, options) {
  if (await cdp.evaluate(fillExpression(value, keywords, options)) !== true) {
    throw new HarnessError("coinbase-screen", "Expected Coinbase sandbox field was not found");
  }
}

async function clickRequired(cdp, labels) {
  if (await cdp.evaluate(clickExpression(labels)) !== true) {
    throw new HarnessError("coinbase-screen", "Expected Coinbase sandbox action was not found");
  }
}

async function driveCoinbase(cdp) {
  await cdp.command("Runtime.enable");

  await waitForCdpText(cdp, /phone|mobile/i);
  await fillRequired(cdp, PHONE, ["phone", "mobile", "tel"]);
  await clickRequired(cdp, ["continue", "next"]);

  await waitForCdpText(cdp, /email/i);
  await fillRequired(cdp, EMAIL, ["email"]);
  await clickRequired(cdp, ["continue", "next"]);

  await waitForCdpText(cdp, /verification code|verify.*code|6.?digit|one.?time/i);
  await fillRequired(cdp, SANDBOX_OTP, ["otp", "code", "one-time"], { otp: true });
  await clickRequired(cdp, ["verify", "continue", "next"]);

  for (let screen = 0; screen < 5; screen += 1) {
    const text = await waitForCdpText(cdp, /identity|limit|date of birth|social security|ssn|review|preview|apple pay/i);
    if (/review|preview|apple pay/i.test(text)) break;
    if (/date of birth|birth date|dob/i.test(text)) {
      await fillRequired(cdp, SYNTHETIC_DOB, ["date of birth", "birth", "dob"]);
    }
    if (/social security|ssn|last four/i.test(text)) {
      await fillRequired(cdp, SYNTHETIC_SSN4, ["social security", "ssn", "last four", "last 4"]);
    }
    await clickRequired(cdp, ["continue", "verify", "next"]);
  }

  await waitForCdpText(cdp, /review|preview|apple pay/i);
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHomeSandboxBadge(execAgent, expectedScreen) {
  try {
    const screen = await execAgent(["wait", `text=${expectedScreen}`], {
      allowFailure: true,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (screen.code !== 0) return false;
    const waited = await execAgent(["wait", "text=Sandbox — not a real deposit"], {
      allowFailure: true,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (waited.code !== 0) return false;
    const visible = await execAgent(["is", "visible", "text=Sandbox — not a real deposit"], {
      allowFailure: true,
    });
    return visible.code === 0 && /true/i.test(visible.stdout);
  } catch {
    return false;
  }
}

async function topLevelOriginMatches(execAgent, origin) {
  try {
    const page = await execAgent(["get", "url"], { allowFailure: true });
    return page.code === 0 && new URL(page.stdout.trim()).origin === origin;
  } catch {
    return false;
  }
}

export async function runAgentBrowserHarness({
  argv = process.argv.slice(2),
  environment = process.env,
  output = process.stdout,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  processRunner = runProcess,
  registerSignals = true,
  exitProcess = (code) => process.exit(code),
} = {}) {
  let configDirectory;
  let execAgent;
  let cleanupPromise;
  let cdp;
  let signalled = false;
  let cleanupReported = false;
  let resultStatus = 1;
  const order = createStepOrder();
  const binary = environment.HOME_AGENT_BROWSER_BIN || "agent-browser";
  const childEnvironment = createAgentBrowserEnvironment(environment);

  const cleanup = async () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      try { cdp?.close(); } catch { /* The named agent-browser close below is authoritative. */ }
      let sessionClosed = true;
      if (execAgent) {
        try {
          const result = await execAgent(["close"], { allowFailure: true });
          sessionClosed = result.code === 0;
        } catch {
          sessionClosed = false;
        }
      }
      if (configDirectory) await rm(configDirectory, { recursive: true, force: true }).catch(() => undefined);
      return sessionClosed;
    })();
    return cleanupPromise;
  };

  const reportCleanup = (sessionClosed) => {
    if (cleanupReported) return;
    cleanupReported = true;
    if (sessionClosed) {
      emit(output, "cleanup-named-session", "passed");
    } else {
      emit(output, "cleanup-named-session", "failed");
      emit(output, RECOVERY.cleanup, "required");
    }
  };

  const signalHandler = () => {
    if (signalled) return;
    signalled = true;
    emit(output, "signal", "failed");
    emit(output, RECOVERY.signal, "required");
    void cleanup()
      .then(reportCleanup)
      .finally(() => { exitProcess(130); });
  };

  try {
    if (environment.CI || environment.COINBASE_ONRAMP_AGENT_BROWSER_LIVE !== "1") {
      throw new HarnessError("optin", "Live sandbox execution requires explicit opt-in outside CI");
    }
    assertNodeVersion(process.versions.node);
    const { origin: inputOrigin } = parseArguments(argv);
    const origin = assertLocalOrigin(inputOrigin);

    configDirectory = await mkdtemp(join(tmpdir(), "home-agent-browser-"));
    const configPath = join(configDirectory, "config.json");
    await writeFile(configPath, "{}\n", { mode: 0o600 });
    execAgent = (command, options = {}) => processRunner(
      binary,
      buildAgentBrowserArgv({ session: SESSION, configPath, command, headed: options.headed }),
      { environment: childEnvironment, timeoutMs: options.timeoutMs, allowFailure: options.allowFailure },
    );

    const version = await processRunner(binary, ["--version"], { environment: childEnvironment, timeoutMs: 10_000 });
    assertAgentBrowserVersion(version.stdout);
    await execAgent(["close"], { allowFailure: true });
    order.advance("preflight");
    emit(output, "preflight", "passed");

    if (registerSignals) {
      process.once("SIGINT", signalHandler);
      process.once("SIGTERM", signalHandler);
    }

    await execAgent(["open", origin], { headed: true });
    order.advance("launched");
    emit(output, "home-auth-checkpoint", "waiting-for-human");

    const authDeadline = Date.now() + AUTH_TIMEOUT_MS;
    let authenticated = false;
    while (Date.now() < authDeadline) {
      const current = await execAgent(["get", "url"], { allowFailure: true });
      if (current.code === 0) {
        try {
          const currentUrl = new URL(current.stdout.trim());
          if (currentUrl.origin === origin && currentUrl.pathname === "/home") {
            const addMoney = await execAgent(["is", "visible", 'role=button[name="Add money"]'], { allowFailure: true });
            if (addMoney.code === 0 && /true/i.test(addMoney.stdout)) {
              authenticated = true;
              break;
            }
          }
        } catch {
          // The bounded checkpoint ignores transient navigation output.
        }
      }
      await sleep(1_000);
    }
    if (!authenticated) throw new HarnessError("auth", "Home authentication checkpoint timed out");
    order.advance("authenticated");
    emit(output, "home-auth-checkpoint", "passed");

    await execAgent(["storage", "local", "set", "home.country.v1", "US"]);
    await execAgent(["reload"]);
    await execAgent(["find", "role", "button", "click", "--name", "Add money", "--exact"]);
    await execAgent(["find", "role", "button", "click", "--name", "Deposit USD"]);
    await execAgent(["find", "role", "button", "click", "--name", "5", "--exact"]);
    await execAgent(["find", "role", "button", "click", "--name", "Review quote", "--exact"]);
    if (!await waitForHomeSandboxBadge(execAgent, "Review quote")) {
      throw new HarnessError("payment-guard", "Home quote is not sandbox-labelled");
    }
    await execAgent(["find", "role", "button", "click", "--name", "Confirm deposit", "--exact"]);
    if (!await waitForHomeSandboxBadge(execAgent, "Review payment details")) {
      throw new HarnessError("payment-guard", "Home order is not sandbox-labelled");
    }
    await execAgent(["find", "role", "button", "click", "--name", "View payment instructions", "--exact"]);
    order.advance("home-input");
    emit(output, "home-sandbox-order", "passed");

    const cdpResult = await execAgent(["get", "cdp-url"]);
    const cdpOrigin = assertLoopbackCdpUrl(cdpResult.stdout);
    const target = await pollForCoinbaseTarget(async () => {
      const response = await fetchImpl(`${cdpOrigin}/json/list`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new HarnessError("cdp", "CDP target discovery failed");
      return response.json();
    }, { timeoutMs: TARGET_TIMEOUT_MS });
    order.advance("iframe");
    emit(output, "coinbase-sandbox-iframe", "passed");

    cdp = new CdpClient(target.webSocketDebuggerUrl, { WebSocketImpl });
    await driveCoinbase(cdp);
    order.advance("coinbase-input");
    emit(output, "coinbase-sandbox-details", "passed");

    await waitForCdpText(cdp, /Apple Pay Sandbox/i);
    const frameText = await waitForCdpText(cdp, /No real funds will be used/i);
    const latestHomeBadge = await execAgent(["is", "visible", "text=Sandbox — not a real deposit"], { allowFailure: true });
    assertPaymentGuards({
      localOrigin: await topLevelOriginMatches(execAgent, origin),
      homeSandboxBadge: latestHomeBadge.code === 0 && /true/i.test(latestHomeBadge.stdout),
      iframeSandboxQuery: new URL(target.url).searchParams.get("useApplePaySandbox") === "true",
      applePaySandboxText: /Apple Pay Sandbox/i.test(frameText),
      noRealFundsText: /No real funds will be used/i.test(frameText),
    });
    order.advance("payment-guard");
    emit(output, "sandbox-payment-guard", "passed");

    await clickRequired(cdp, ["apple pay sandbox", "apple pay"]);
    const confirmationText = await waitForNewCdpText(cdp, /confirm|complete/i, frameText);
    const confirmationHomeBadge = await execAgent(["is", "visible", "text=Sandbox — not a real deposit"], { allowFailure: true });
    assertPaymentGuards({
      localOrigin: await topLevelOriginMatches(execAgent, origin),
      homeSandboxBadge: confirmationHomeBadge.code === 0 && /true/i.test(confirmationHomeBadge.stdout),
      iframeSandboxQuery: new URL(target.url).searchParams.get("useApplePaySandbox") === "true",
      applePaySandboxText: /Apple Pay Sandbox/i.test(`${frameText} ${confirmationText}`),
      noRealFundsText: /No real funds will be used/i.test(`${frameText} ${confirmationText}`),
    });
    await clickRequired(cdp, ["confirm", "complete"]);
    order.advance("payment");
    emit(output, "sandbox-payment", "confirmed-fake-only");

    const terminalDeadline = Date.now() + TERMINAL_TIMEOUT_MS;
    let terminal = false;
    while (Date.now() < terminalDeadline) {
      const result = await execAgent(["is", "visible", "text=Sandbox complete — no real funds moved"], { allowFailure: true });
      if (result.code === 0 && /true/i.test(result.stdout)) {
        terminal = true;
        break;
      }
      await sleep(1_000);
    }
    if (!terminal) throw new HarnessError("terminal", "Home sandbox terminal screen timed out");
    order.advance("complete");
    emit(output, "home-sandbox-terminal", "passed");
    resultStatus = 0;
  } catch (error) {
    if (!signalled) {
      const code = error instanceof HarnessError ? error.code : "unknown";
      emit(output, code, "failed");
      emit(output, RECOVERY[code] ?? RECOVERY.unknown, "required");
    }
    resultStatus = 1;
  } finally {
    if (registerSignals) {
      process.removeListener("SIGINT", signalHandler);
      process.removeListener("SIGTERM", signalHandler);
    }
    const sessionClosed = await cleanup();
    reportCleanup(sessionClosed);
    if (!sessionClosed) resultStatus = 1;
  }
  return resultStatus;
}

let direct = false;
try {
  direct = (await realpath(fileURLToPath(import.meta.url))) === (await realpath(process.argv[1]));
} catch {
  direct = false;
}

if (direct) process.exitCode = await runAgentBrowserHarness();
