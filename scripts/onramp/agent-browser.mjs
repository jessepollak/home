#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { BROWSER_REINSTALL_COMMAND } from "../verify/pinned-agent-browser.mjs";
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
  isSandboxCoinbaseFrameUrl,
  pollForCoinbaseTarget,
  redactSensitive,
  resolvePinnedAgentBrowser,
  validateAgentBrowserArgv,
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
  binary: "recovery: run bun run worktree:bootstrap and rerun",
  version: `recovery: run ${BROWSER_REINSTALL_COMMAND} and rerun`,
  "node-version": "recovery: run the harness with Node 22 or newer",
  argv: "recovery: remove unsupported browser profile or state configuration and rerun",
  session: "recovery: close the named harness session and rerun",
  auth: "recovery: rerun and complete Home sign-in in the headed window before the checkpoint expires",
  "home-flow": "recovery: verify the local sandbox server environment and restart the command",
  cdp: "recovery: close the named session and rerun with the pinned browser",
  "iframe-zero": "recovery: verify Coinbase sandbox server setup and start a new order",
  "iframe-multiple": "recovery: close the named session and rerun with only one Add money flow open",
  "coinbase-screen": "recovery: close the failed order and start a new Coinbase sandbox order",
  "payment-guard": "recovery: stop and rerun only after every Home and Coinbase sandbox label is visible",
  terminal: "recovery: inspect local server logs, then rerun with a new sandbox order",
  cleanup: `recovery: run bun run ab -- --session ${SESSION} close and verify it succeeds before rerunning`,
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

const activeChildren = new Set();

export function killProcessTree(child) {
  if (process.platform === "win32") {
    child.kill("SIGKILL");
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function cancelActiveCommands() {
  for (const child of activeChildren) killProcessTree(child);
}

function runProcess(file, args, { environment, timeoutMs = COMMAND_TIMEOUT_MS, allowFailure = false, stdin } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(file, args, {
      env: environment,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    activeChildren.add(child);
    if (stdin !== undefined) child.stdin.end(stdin);
    const append = (current, chunk) => `${current}${chunk}`.slice(-32_768);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      killProcessTree(child);
      if (!settled) {
        settled = true;
        reject(new HarnessError("home-flow", "Browser command timed out"));
      }
    }, timeoutMs);
    child.once("error", () => {
      activeChildren.delete(child);
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new HarnessError("binary", "agent-browser could not be executed"));
      }
    });
    child.once("close", (code) => {
      activeChildren.delete(child);
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
    let url;
    try { url = new URL(location.href); } catch { return false; }
    if (url.origin !== 'https://pay.coinbase.com' || url.searchParams.get('useApplePaySandbox') !== 'true') return false;
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
    let url;
    try { url = new URL(location.href); } catch { return false; }
    if (url.origin !== 'https://pay.coinbase.com' || url.searchParams.get('useApplePaySandbox') !== 'true') return false;
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

function sandboxClickExpression(labels) {
  return `(() => {
    let url;
    try { url = new URL(location.href); } catch { return 'frame-unreadable'; }
    if (url.origin !== 'https://pay.coinbase.com' || url.searchParams.get('useApplePaySandbox') !== 'true') return 'frame-not-sandbox';
    ${deepDomPrelude()}
    const text = elements.filter(visible).map((element) => element.innerText || '').join(' ');
    if (!/Apple Pay Sandbox/i.test(text)) return 'missing-apple-pay-sandbox';
    if (!/No real funds will be used/i.test(text)) return 'missing-no-real-funds';
    const labels = ${JSON.stringify(labels)}.map((label) => label.toLowerCase());
    const candidates = elements.filter((element) => visible(element) && (element instanceof HTMLButtonElement || element.getAttribute('role') === 'button'));
    let button = null;
    for (const label of labels) {
      button = candidates.find((element) => [element.innerText, element.getAttribute('aria-label')].some((text) => (text || '').toLowerCase().includes(label)));
      if (button) break;
    }
    if (!button) return 'missing-action';
    button.click(); return 'clicked';
  })()`;
}

async function waitForCdpText(cdp, pattern, { sleep, now, fence }, timeoutMs = COMMAND_TIMEOUT_MS) {
  fence();
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    fence();
    const text = String(await cdp.evaluate(visibleTextExpression()) ?? "");
    if (pattern.test(text)) return text;
    await sleep(400);
  }
  throw new HarnessError("coinbase-screen", "Expected Coinbase sandbox screen timed out");
}

async function waitForNewCdpText(cdp, pattern, previousText, { sleep, now, fence }, timeoutMs = COMMAND_TIMEOUT_MS) {
  fence();
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    fence();
    const text = String(await cdp.evaluate(visibleTextExpression()) ?? "");
    if (text !== previousText && pattern.test(text)) return text;
    await sleep(400);
  }
  throw new HarnessError("coinbase-screen", "Expected new Coinbase sandbox screen timed out");
}

async function fillRequired(cdp, value, keywords, { fence }, options) {
  fence();
  if (await cdp.evaluate(fillExpression(value, keywords, options)) !== true) {
    throw new HarnessError("coinbase-screen", "Expected Coinbase sandbox field was not found");
  }
}

async function clickRequired(cdp, labels, { fence }) {
  fence();
  if (await cdp.evaluate(clickExpression(labels)) !== true) {
    throw new HarnessError("coinbase-screen", "Expected Coinbase sandbox action was not found");
  }
}

async function driveCoinbase(cdp, timing) {
  timing.fence();
  await cdp.command("Runtime.enable");
  timing.fence();
  const liveUrl = await cdp.evaluate("location.href").catch(() => null);
  if (!isSandboxCoinbaseFrameUrl(liveUrl)) {
    throw new HarnessError("payment-guard", "Connected Coinbase frame is not sandbox");
  }

  await waitForCdpText(cdp, /phone|mobile/i, timing);
  await fillRequired(cdp, PHONE, ["phone", "mobile", "tel"], timing);
  await clickRequired(cdp, ["continue", "next"], timing);

  await waitForCdpText(cdp, /email/i, timing);
  await fillRequired(cdp, EMAIL, ["email"], timing);
  await clickRequired(cdp, ["continue", "next"], timing);

  await waitForCdpText(cdp, /verification code|verify.*code|6.?digit|one.?time/i, timing);
  await fillRequired(cdp, SANDBOX_OTP, ["otp", "code", "one-time"], timing, { otp: true });
  await clickRequired(cdp, ["verify", "continue", "next"], timing);

  for (let screen = 0; screen < 5; screen += 1) {
    const text = await waitForCdpText(cdp, /identity|limit|date of birth|social security|ssn|review|preview|apple pay/i, timing);
    if (/review|preview|apple pay/i.test(text)) break;
    if (/date of birth|birth date|dob/i.test(text)) {
      await fillRequired(cdp, SYNTHETIC_DOB, ["date of birth", "birth", "dob"], timing);
    }
    if (/social security|ssn|last four/i.test(text)) {
      await fillRequired(cdp, SYNTHETIC_SSN4, ["social security", "ssn", "last four", "last 4"], timing);
    }
    await clickRequired(cdp, ["continue", "verify", "next"], timing);
  }

  await waitForCdpText(cdp, /review|preview|apple pay/i, timing);
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHomeSandboxBadge(execAgent, expectedScreen) {
  try {
    if (expectedScreen) {
      const screen = await execAgent(["wait", "--text", expectedScreen], {
        allowFailure: true,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      if (screen.code !== 0) return false;
    }
    const waited = await execAgent(["wait", "--text", "Sandbox — not a real deposit"], {
      allowFailure: true,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (waited.code !== 0) return false;
    const visible = await execAgent(["find", "text", "Sandbox — not a real deposit", "text"], {
      allowFailure: true,
    });
    return visible.code === 0;
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
  cancelActiveCommands: cancelActiveCommandsImpl = cancelActiveCommands,
  registerSignals = true,
  exitProcess = (code) => process.exit(code),
  repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  resolveBinary = resolvePinnedAgentBrowser,
  mkdtempSync: mkdtempSyncImpl = mkdtempSync,
  sleep: sleepImpl = sleep,
  now = Date.now,
} = {}) {
  let configDirectory;
  let execAgent;
  let pendingCommand;
  let cleanupPromise;
  let cdp;
  let signalled = false;
  let cleanupReported = false;
  let resultStatus = 1;
  const order = createStepOrder();
  const timing = {
    sleep: sleepImpl,
    now,
    fence() {
      if (signalled) throw new HarnessError("signal", "Harness commands are stopped after a signal");
    },
  };
  const childEnvironment = createAgentBrowserEnvironment(environment);

  const cleanup = async () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      try { cdp?.close(); } catch { /* The named agent-browser close below is authoritative. */ }
      const pending = pendingCommand;
      cancelActiveCommandsImpl();
      if (pending) {
        await Promise.race([pending.then(() => undefined, () => undefined), sleepImpl(5_000)]);
      }
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

    if (registerSignals) {
      process.on("SIGINT", signalHandler);
      process.on("SIGTERM", signalHandler);
    }

    const { binary, expectedVersion } = await resolveBinary(repositoryRoot);
    timing.fence();
    configDirectory = mkdtempSyncImpl(join(tmpdir(), "home-agent-browser-"));
    timing.fence();
    const configPath = join(configDirectory, "config.json");
    await writeFile(configPath, "{}\n", { mode: 0o600 });
    timing.fence();
    const version = await processRunner(binary, ["--version"], { environment: childEnvironment, timeoutMs: 10_000 });
    assertAgentBrowserVersion(version.stdout, expectedVersion);
    timing.fence();
    execAgent = (command, options = {}) => {
      if (signalled && command[0] !== "close") {
        throw new HarnessError("signal", "Harness commands are stopped after a signal");
      }
      const pending = processRunner(
        binary,
        buildAgentBrowserArgv({ session: SESSION, configPath, command, headed: options.headed }),
        { environment: childEnvironment, timeoutMs: options.timeoutMs, allowFailure: options.allowFailure, stdin: options.stdin },
      );
      pendingCommand = pending;
      const clearPending = () => {
        if (pendingCommand === pending) pendingCommand = undefined;
      };
      void pending.then(clearPending, clearPending);
      return pending;
    };
    const homeCommand = async (command, options) => {
      if (!await topLevelOriginMatches(execAgent, origin)) {
        throw new HarnessError("home-flow", "Home is not on the exact local origin");
      }
      validateAgentBrowserArgv(command);
      try {
        const result = await execAgent(["batch", "--bail"], {
          ...options,
          stdin: JSON.stringify([["wait", "--fn", `location.origin === ${JSON.stringify(origin)}`], command]),
        });
        if (result.code !== 0) throw new HarnessError("home-flow", "Home command failed");
        return result;
      } catch {
        throw new HarnessError("home-flow", "Home command failed");
      }
    };
    const preClose = await execAgent(["close"], { allowFailure: true });
    if (preClose.code !== 0) {
      throw new HarnessError("session", "The named harness session could not be closed before launch");
    }
    order.advance("preflight");
    emit(output, "preflight", "passed");

    await execAgent(["open", origin], { headed: true });
    timing.fence();
    order.advance("launched");
    emit(output, "home-auth-checkpoint", "waiting-for-human");

    const authDeadline = now() + AUTH_TIMEOUT_MS;
    let authenticated = false;
    while (now() < authDeadline) {
      const current = await execAgent(["get", "url"], { allowFailure: true });
      if (current.code === 0) {
        try {
          const currentUrl = new URL(current.stdout.trim());
          if (currentUrl.origin === origin && currentUrl.pathname === "/home") {
            const addMoney = await execAgent(["find", "role", "link", "text", "--name", "Add money", "--exact"], { allowFailure: true });
            if (addMoney.code === 0) {
              authenticated = true;
              break;
            }
          }
        } catch {
          // The bounded checkpoint ignores transient navigation output.
        }
      }
      await sleepImpl(1_000);
    }
    if (!authenticated) throw new HarnessError("auth", "Home authentication checkpoint timed out");
    order.advance("authenticated");
    emit(output, "home-auth-checkpoint", "passed");

    await homeCommand(["storage", "local", "set", "home.country.v2", "US"]);
    await homeCommand(["reload"]);
    await homeCommand(["find", "role", "link", "click", "--name", "Add money", "--exact"]);
    await homeCommand(["find", "role", "button", "click", "--name", "Deposit USD"]);
    await homeCommand(["find", "role", "textbox", "fill", "--name", "Amount", "5"]);
    await homeCommand(["find", "role", "button", "click", "--name", "Review quote", "--exact"]);
    if (!await waitForHomeSandboxBadge(execAgent)) {
      throw new HarnessError("payment-guard", "Home quote is not sandbox-labelled");
    }
    await homeCommand(["find", "role", "button", "click", "--name", "Confirm deposit", "--exact"]);
    if (!await waitForHomeSandboxBadge(execAgent, "Review payment details")) {
      throw new HarnessError("payment-guard", "Home order is not sandbox-labelled");
    }
    await homeCommand(["find", "role", "button", "click", "--name", "View payment instructions", "--exact"]);
    order.advance("home-input");
    emit(output, "home-sandbox-order", "passed");

    const cdpResult = await execAgent(["get", "cdp-url"]);
    const cdpOrigin = assertLoopbackCdpUrl(cdpResult.stdout);
    const target = await pollForCoinbaseTarget(async () => {
      try {
        const response = await fetchImpl(`${cdpOrigin}/json/list`, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new HarnessError("cdp", "CDP target discovery failed");
        return await response.json();
      } catch (error) {
        if (error instanceof HarnessError) throw error;
        throw new HarnessError("cdp", "CDP target discovery failed");
      }
    }, { cdpHost: new URL(cdpOrigin).host, timeoutMs: TARGET_TIMEOUT_MS, ...timing });
    timing.fence();
    order.advance("iframe");
    emit(output, "coinbase-sandbox-iframe", "passed");

    cdp = new CdpClient(target.webSocketDebuggerUrl, { WebSocketImpl });
    await driveCoinbase(cdp, timing);
    order.advance("coinbase-input");
    emit(output, "coinbase-sandbox-details", "passed");

    await waitForCdpText(cdp, /Apple Pay Sandbox/i, timing);
    const frameText = await waitForCdpText(cdp, /No real funds will be used/i, timing);
    const latestHomeBadge = await execAgent(["find", "text", "Sandbox — not a real deposit", "text"], { allowFailure: true });
    timing.fence();
    const liveUrl = await cdp.evaluate("location.href").catch(() => null);
    assertPaymentGuards({
      localOrigin: await topLevelOriginMatches(execAgent, origin),
      homeSandboxBadge: latestHomeBadge.code === 0,
      iframeSandboxQuery: isSandboxCoinbaseFrameUrl(liveUrl),
      applePaySandboxText: /Apple Pay Sandbox/i.test(frameText),
      noRealFundsText: /No real funds will be used/i.test(frameText),
    });
    order.advance("payment-guard");
    emit(output, "sandbox-payment-guard", "passed");

    timing.fence();
    if (await cdp.evaluate(sandboxClickExpression(["apple pay sandbox"])) !== "clicked") {
      throw new HarnessError("payment-guard", "Atomic Coinbase sandbox payment guard failed");
    }
    const confirmationText = await waitForNewCdpText(cdp, /confirm|complete/i, frameText, timing);
    const confirmationHomeBadge = await execAgent(["find", "text", "Sandbox — not a real deposit", "text"], { allowFailure: true });
    timing.fence();
    const confirmationLiveUrl = await cdp.evaluate("location.href").catch(() => null);
    assertPaymentGuards({
      localOrigin: await topLevelOriginMatches(execAgent, origin),
      homeSandboxBadge: confirmationHomeBadge.code === 0,
      iframeSandboxQuery: isSandboxCoinbaseFrameUrl(confirmationLiveUrl),
      applePaySandboxText: /Apple Pay Sandbox/i.test(confirmationText),
      noRealFundsText: /No real funds will be used/i.test(confirmationText),
    });
    timing.fence();
    if (await cdp.evaluate(sandboxClickExpression(["confirm", "complete"])) !== "clicked") {
      throw new HarnessError("payment-guard", "Atomic Coinbase sandbox payment guard failed");
    }
    order.advance("payment");
    emit(output, "sandbox-payment", "confirmed-fake-only");

    const terminalDeadline = now() + TERMINAL_TIMEOUT_MS;
    let terminal = false;
    while (now() < terminalDeadline) {
      const result = await execAgent(["find", "text", "Sandbox complete — no real funds moved", "text"], { allowFailure: true });
      if (result.code === 0) {
        terminal = true;
        break;
      }
      await sleepImpl(1_000);
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
    const sessionClosed = await cleanup();
    reportCleanup(sessionClosed);
    if (registerSignals) {
      process.removeListener("SIGINT", signalHandler);
      process.removeListener("SIGTERM", signalHandler);
    }
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
