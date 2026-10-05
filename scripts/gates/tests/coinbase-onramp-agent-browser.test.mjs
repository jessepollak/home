import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";

import {
  CdpClient,
  HarnessError,
  assertAgentBrowserVersion,
  assertLocalOrigin,
  assertLoopbackCdpUrl,
  assertNodeVersion,
  assertPaymentGuards,
  assertSessionName,
  buildAgentBrowserArgv,
  createAgentBrowserEnvironment,
  createStepOrder,
  formatSummary,
  inspectCoinbaseTarget,
  isSandboxCoinbaseFrameUrl,
  parseAgentBrowserVersion,
  pollForCoinbaseTarget,
  redactSensitive,
  resolvePinnedAgentBrowser,
  selectCoinbaseTarget,
  validateAgentBrowserArgv,
} from "../../onramp/agent-browser-lib.mjs";
import { killProcessTree, runAgentBrowserHarness } from "../../onramp/agent-browser.mjs";
import { nativeBrowserBinary } from "../../verify/pinned-agent-browser.mjs";

const SESSION = "home-coinbase-onramp-sandbox";
const BADGE = "Sandbox — not a real deposit";
const TERMINAL = "Sandbox complete — no real funds moved";
const VALID_TARGET = {
  type: "iframe",
  url: "https://pay.coinbase.com/v3/api-onramp/embedded-order?useApplePaySandbox=true",
  webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/synthetic",
};
const errorCode = (code) => (error) => error instanceof HarnessError && error.code === code;

function processStateIsRunning(stat) {
  const commEnd = stat.lastIndexOf(")");
  if (commEnd === -1) return true;
  const state = stat.slice(commEnd + 1).trimStart()[0];
  return state !== "Z" && state !== "X";
}

function processRunning(pid, {
  kill = process.kill,
  readStat = (target) => readFileSync(`/proc/${target}/stat`, "utf8"),
  platform = process.platform,
} = {}) {
  try {
    kill(pid, 0);
  } catch (error) {
    assert.equal(error.code, "ESRCH");
    return false;
  }
  if (platform !== "linux") return true;
  try {
    return processStateIsRunning(readStat(pid));
  } catch {
    return false;
  }
}

for (const origin of [
  "https://localhost:3000", "http://127.0.0.1:3000", "http://localhost",
  "http://localhost:3000/path", "http://localhost:3000?next=pay",
  "http://localhost:3000#hash", "http://user@localhost:3000",
  "http://localhost.evil.test:3000", "http://localhost:0", "http://localhost:65536",
]) {
  test(`rejects non-exact local origin: ${origin}`, () => {
    assert.throws(() => assertLocalOrigin(origin), errorCode("origin"));
  });
}

test("accepts an exact localhost origin and validates Node and session names", () => {
  assert.equal(assertLocalOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(assertNodeVersion("22.0.0"), 22);
  assert.throws(() => assertNodeVersion("21.7.0"), errorCode("node-version"));
  assert.equal(assertSessionName(SESSION), SESSION);
  assert.throws(() => assertSessionName("../ambient"), errorCode("session"));
});

for (const [version, accepted] of [
  ["agent-browser 0.38.1", true], ["agent-browser 0.21.4", false],
  ["agent-browser 0.38.0", false], ["agent-browser 0.39.0", false], ["unknown", false],
]) {
  test(`exact agent-browser pin: ${version}`, () => {
    if (accepted) assert.equal(assertAgentBrowserVersion(version, "0.38.1"), "0.38.1");
    else assert.throws(() => assertAgentBrowserVersion(version, "0.38.1"), errorCode("version"));
  });
}

test("parses version components and drops all ambient browser configuration", () => {
  assert.deepEqual(parseAgentBrowserVersion("agent-browser 0.38.1"), [0, 38, 1]);
  assert.deepEqual(createAgentBrowserEnvironment({
    PATH: "/safe/bin", UNRELATED: "keep", HOME_AGENT_BROWSER_BIN: "/ignored/binary",
    AGENT_BROWSER_PROFILE: "private", AGENT_BROWSER_SESSION: "ambient",
    AGENT_BROWSER_SESSION_NAME: "persistent", AGENT_BROWSER_STATE: "private",
    AGENT_BROWSER_AUTO_CONNECT: "1", AGENT_BROWSER_ANY_FUTURE_FLAG: "1",
    HTTP_PROXY: "http://proxy.test", HTTPS_PROXY: "http://proxy.test", ALL_PROXY: "http://proxy.test",
    http_proxy: "http://proxy.test", https_proxy: "http://proxy.test", all_proxy: "http://proxy.test",
    BROWSER: "/ambient/browser", NO_PROXY: "localhost", no_proxy: "localhost",
    NODE_OPTIONS: "--require /ambient/hook.cjs", PLAYWRIGHT_BROWSERS_PATH: "/ambient/browsers",
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/ambient/chromium",
  }), { NO_PROXY: "localhost", no_proxy: "localhost", PATH: "/safe/bin", UNRELATED: "keep", HOME_AGENT_BROWSER_BIN: "/ignored/binary" });
});

const FORBIDDEN_FLAGS = [
  "--profile", "--state", "--restore", "--restore-save", "--restore-check-url",
  "--restore-check-text", "--restore-check-fn", "--session-name", "--auto-connect",
  "--all", "--cdp", "--provider", "--device", "--headers", "--executable-path",
  "--init-script", "--args", "--proxy", "--user-agent",
  "-p", "-pfoo", "--extension", "--namespace", "--allowed-domains", "--allowed-domains=x",
];
const FORBIDDEN_COMMANDS = [
  "screenshot", "snapshot", "pdf", "read", "eval", "html", "console", "download",
  "har", "inspect", "highlight", "clipboard",
];
for (const token of [...FORBIDDEN_FLAGS, ...FORBIDDEN_COMMANDS]) {
  test(`rejects unsafe argv token: ${token}`, () => {
    assert.throws(() => validateAgentBrowserArgv([token]), errorCode("argv"));
    if (token.startsWith("--")) {
      assert.throws(() => validateAgentBrowserArgv([`${token}=value`]), errorCode("argv"));
    }
  });
}

test("rejects mixed-case forbidden flags while commands remain exact tokens", () => {
  for (const flag of ["--Profile", "--State=private", "--Auto-Connect"]) {
    assert.throws(() => validateAgentBrowserArgv([flag]), errorCode("argv"));
  }
  assert.doesNotThrow(() => validateAgentBrowserArgv(["Snapshot", "--profile-extra", "--provider-extra", "prefix-pfoo"]));
});

test("constructs isolated global controls before commands, headed only when requested", () => {
  const base = { session: SESSION, configPath: "/isolated/config.json", command: ["open", "http://localhost:3000"] };
  assert.deepEqual(buildAgentBrowserArgv({ ...base, headed: true }), [
    "--config", base.configPath, "--session", SESSION, "--headed", ...base.command,
  ]);
  assert.deepEqual(buildAgentBrowserArgv(base), ["--config", base.configPath, "--session", SESSION, ...base.command]);
  assert.throws(() => validateAgentBrowserArgv([1]), errorCode("argv"));
  assert.doesNotThrow(() => validateAgentBrowserArgv(["find", "text", "snapshot example", "text"]));
});

test("maps browser-level loopback CDP URLs to the HTTP discovery origin", () => {
  assert.equal(assertLoopbackCdpUrl("ws://127.0.0.1:9222/devtools/browser/synthetic"), "http://127.0.0.1:9222");
  assert.equal(assertLoopbackCdpUrl("http://localhost:9222"), "http://localhost:9222");
  assert.equal(assertLoopbackCdpUrl("wss://[::1]:9222/devtools/browser/synthetic"), "https://[::1]:9222");
  for (const url of ["ws://example.com:9222/browser", "ws://127.0.0.1.evil.test:9222/browser", "ws://user@localhost:9222/browser", "invalid"]) {
    assert.throws(() => assertLoopbackCdpUrl(url), errorCode("cdp"));
  }
});

for (const [name, target, accepted] of [
  ["valid", VALID_TARGET, true], ["wrong type", { ...VALID_TARGET, type: "page" }, false],
  ["origin spoof", { ...VALID_TARGET, url: "https://pay.coinbase.com.evil.test/v3/api-onramp/embedded-order?useApplePaySandbox=true" }, false],
  ["userinfo spoof", { ...VALID_TARGET, url: "https://pay.coinbase.com@evil.test/v3/api-onramp/embedded-order?useApplePaySandbox=true" }, false],
  ["wrong path", { ...VALID_TARGET, url: "https://pay.coinbase.com/v3/api-onramp/embedded-order/extra?useApplePaySandbox=true" }, false],
  ["query false", { ...VALID_TARGET, url: "https://pay.coinbase.com/v3/api-onramp/embedded-order?useApplePaySandbox=false" }, false],
  ["query key spoof", { ...VALID_TARGET, url: "https://pay.coinbase.com/v3/api-onramp/embedded-order?xuseApplePaySandbox=true" }, false],
  ["missing websocket", { ...VALID_TARGET, webSocketDebuggerUrl: undefined }, false],
]) {
  test(`validates Coinbase iframe target: ${name}`, () => assert.equal(inspectCoinbaseTarget(target), accepted));
}

for (const [name, value, accepted] of [
  ["sandbox discovery URL", VALID_TARGET.url, true],
  ["sandbox navigation", "https://pay.coinbase.com/confirmation?useApplePaySandbox=true", true],
  ["missing query", "https://pay.coinbase.com/confirmation", false],
  ["false query", "https://pay.coinbase.com/confirmation?useApplePaySandbox=false", false],
  ["wrong query key", "https://pay.coinbase.com/confirmation?xuseApplePaySandbox=true", false],
  ["wrong query value", "https://pay.coinbase.com/confirmation?useApplePaySandbox=True", false],
  ["wrong origin", "https://evil.test/?useApplePaySandbox=true", false],
  ["spoofed origin", "https://pay.coinbase.com.evil.test/?useApplePaySandbox=true", false],
  ["wrong protocol", "http://pay.coinbase.com/?useApplePaySandbox=true", false],
  ["wrong port", "https://pay.coinbase.com:8443/?useApplePaySandbox=true", false],
  ["garbage", "not a URL", false], ["null", null, false], ["number", 123, false],
  ["URL object", new URL(VALID_TARGET.url), false],
]) {
  test(`validates live Coinbase frame URL: ${name}`, () => {
    assert.equal(isSandboxCoinbaseFrameUrl(value), accepted);
  });
}

for (const [name, websocket, accepted] of [
  ["matching host", VALID_TARGET.webSocketDebuggerUrl, true],
  ["remote host", "ws://evil.test:9222/devtools/page/synthetic", false],
  ["wrong local port", "ws://127.0.0.1:9223/devtools/page/synthetic", false],
  ["malformed endpoint", "ws://", false],
]) {
  test(`binds Coinbase debugger to discovery host: ${name}`, async () => {
    const target = { ...VALID_TARGET, webSocketDebuggerUrl: websocket };
    const options = { cdpHost: "127.0.0.1:9222" };
    assert.equal(inspectCoinbaseTarget(target, options), accepted);
    if (accepted) {
      assert.equal(selectCoinbaseTarget([target], options), target);
      assert.equal(await pollForCoinbaseTarget(async () => [target], options), target);
    } else {
      assert.throws(() => selectCoinbaseTarget([target], options), errorCode("iframe-zero"));
      let clock = 0;
      await assert.rejects(pollForCoinbaseTarget(async () => [target], {
        ...options, timeoutMs: 10, now: () => clock, sleep: async () => { clock = 10; },
      }), errorCode("iframe-zero"));
    }
  });
}

test("requires exactly one matching iframe, including polling cardinality", async () => {
  assert.throws(() => selectCoinbaseTarget([]), errorCode("iframe-zero"));
  assert.throws(() => selectCoinbaseTarget([VALID_TARGET, VALID_TARGET]), errorCode("iframe-multiple"));
  assert.equal(selectCoinbaseTarget([{ type: "page" }, VALID_TARGET]), VALID_TARGET);
  let reads = 0;
  let sleeps = 0;
  assert.equal(await pollForCoinbaseTarget(async () => {
    reads += 1;
    return reads === 1 ? [{ ...VALID_TARGET, type: "page" }] : [VALID_TARGET];
  }, { sleep: async () => { sleeps += 1; }, now: () => 0 }), VALID_TARGET);
  assert.equal(reads, 2);
  assert.equal(sleeps, 1);
  await assert.rejects(pollForCoinbaseTarget(async () => [VALID_TARGET, VALID_TARGET]), errorCode("iframe-multiple"));
  let clock = 0;
  await assert.rejects(pollForCoinbaseTarget(async () => [], {
    timeoutMs: 10, now: () => clock, sleep: async () => { clock = 10; },
  }), errorCode("iframe-zero"));
});

const COMPLETE_GUARD = {
  localOrigin: true, homeSandboxBadge: true, iframeSandboxQuery: true,
  applePaySandboxText: true, noRealFundsText: true,
};
for (const key of Object.keys(COMPLETE_GUARD)) {
  test(`blocks payment with missing guard: ${key}`, () => {
    assert.equal(assertPaymentGuards(COMPLETE_GUARD), true);
    assert.throws(() => assertPaymentGuards({ ...COMPLETE_GUARD, [key]: false }), errorCode("payment-guard"));
    assert.throws(() => assertPaymentGuards({ ...COMPLETE_GUARD, [key]: undefined }), errorCode("payment-guard"));
  });
}

test("redacts every sensitive class with bounded, repeatable output", () => {
  const headerSecrets = [
    "Cookie: session=secret-cookie; other=secret-cookie-two",
    "Set-Cookie: session=secret-set-cookie; Path=/; HttpOnly; Secure",
    '"cookie": "session=secret-json-cookie; other=secret-json-cookie-two"',
    '"set-cookie": "session=secret-json-set-cookie; Path=/; HttpOnly"',
    "api-key: secret-api-key", "apikey=secret-apikey", '"x-api-key": "secret-x-api-key"',
  ];
  for (const header of headerSecrets) {
    const redactedHeader = redactSensitive(header);
    assert.ok(redactedHeader.includes("[redacted-token]"), header);
    assert.equal(redactedHeader.includes("secret-"), false, header);
    assert.equal(redactSensitive(redactedHeader), redactedHeader);
    assert.ok(redactSensitive(header, 30).length <= 30);
  }
  const secrets = [
    ...headerSecrets,
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature",
    "0x1234567890abcdef1234567890abcdef12345678", "person@sandbox.test", "+10005550199",
    "https://pay.coinbase.com/v3/api-onramp/embedded-order?paymentToken=secret-payment",
    "Bearer secret-bearer", "authorization: secret-auth", "x-wallet-auth=secret-wallet",
    "wallet-auth: secret-wallet-two", "sessionToken=secret-session", "userAuthToken: secret-user",
    "access_token=secret-access", "refresh_token: secret-refresh", "id_token=secret-id",
    "ws://127.0.0.1:9222/devtools/page/secret-websocket", "203.0.113.42", "[REDACTED]",
  ];
  const redacted = redactSensitive(secrets.join("\n"));
  for (const secret of secrets.slice(0, -1)) {
    assert.equal(redacted.includes(secret), false, secret);
  }
  assert.equal(redacted.includes("secret-"), false);
  assert.ok(redacted.includes("[redacted-jwt]"));
  assert.ok(redacted.includes("[REDACTED]"));
  assert.equal(redactSensitive(redacted), redacted);
  assert.ok(redactSensitive("person@sandbox.test ".repeat(200), 30).length <= 30);
});

test("redacts a complete JWT before truncating across its payload", () => {
  const prefix = `${"x".repeat(1170)} `;
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
  const redacted = redactSensitive(`${prefix}${jwt}`);
  assert.equal(redacted, `${prefix}[redacted-jwt]`);
  assert.equal(redactSensitive(redacted), redacted);
  assert.ok(redacted.length <= 1200);
});

test("redacts the complete quoted or JSON-escaped cookie header remainder on its line", () => {
  for (const [header, expected] of [
    ['Cookie: session="quoted"; other=second', "Cookie=[redacted-token]"],
    [JSON.stringify({ "Set-Cookie": 'session="secret-quoted"; other=secret-second' }), '{"Set-Cookie=[redacted-token]'],
  ]) {
    const redacted = redactSensitive(header);
    assert.equal(redacted, expected);
    assert.equal(redactSensitive(redacted), redacted);
    assert.ok(redactSensitive(header, 12).length <= 12);
    assert.equal(redactSensitive(`${header}\r\nUnrelated: keep`), `${expected}\r\nUnrelated: keep`);
  }
  assert.equal(redactSensitive("x".repeat(1300)).length, 1200);
});

test("summary shape and step order cannot carry raw output or skip guards", () => {
  assert.equal(formatSummary("preflight", "passed"), '{"stage":"preflight","status":"passed"}');
  const order = createStepOrder();
  assert.equal(order.current(), null);
  order.advance("preflight");
  order.advance("launched");
  assert.throws(() => order.advance("home-input"), errorCode("step-order"));
  for (const step of ["authenticated", "home-input", "iframe", "coinbase-input"]) order.advance(step);
  assert.throws(() => order.advance("payment"), errorCode("step-order"));
  order.advance("payment-guard");
  order.advance("payment");
  assert.equal(order.current(), "payment");
});

test("resolves only executable pinned native or repository fallback binaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "onramp-pin-test-"));
  const platform = "linux";
  const arch = "x64";
  const native = nativeBrowserBinary(root, platform, arch);
  const fallback = join(root, "node_modules", ".bin", "agent-browser");
  const resolveBinary = () => resolvePinnedAgentBrowser(root, { platform, arch });
  try {
    assert.throws(resolveBinary, errorCode("binary"));
    await writeFile(join(root, "package.json"), '{"devDependencies":{"agent-browser":"^0.38.1"}}');
    assert.throws(resolveBinary, errorCode("binary"));
    await writeFile(join(root, "package.json"), '{"devDependencies":{"agent-browser":"0.38.1"}}');
    assert.throws(resolveBinary, errorCode("binary"));
    for (const binary of [native, fallback]) {
      await mkdir(dirname(binary), { recursive: true });
      await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    assert.deepEqual(resolveBinary(), { binary: native, expectedVersion: "0.38.1", native });
    await chmod(native, 0o600);
    assert.deepEqual(resolveBinary(), { binary: fallback, expectedVersion: "0.38.1", native });
    await rm(native);
    assert.equal(resolveBinary().binary, fallback);
    await rm(fallback);
    assert.throws(resolveBinary, errorCode("binary"));
    await writeFile(join(root, "package.json"), "invalid");
    assert.throws(resolveBinary, errorCode("binary"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [exitCode, signalCode] of [[0, null], [null, "SIGKILL"]]) {
  test(`signals the owned process group after leader exit: ${exitCode ?? signalCode}`, { skip: process.platform === "win32" }, (t) => {
    const groupKill = t.mock.method(process, "kill", (pid, signal) => {
      assert.equal(pid, -12345);
      assert.equal(signal, "SIGKILL");
    });
    const signals = [];
    killProcessTree({ pid: 12345, exitCode, signalCode, kill: (signal) => { signals.push(signal); } });
    assert.deepEqual(signals, []);
    assert.equal(groupKill.mock.callCount(), 1);
  });
}

test("distinguishes running processes from zombies and missing proc entries", () => {
  assert.equal(processStateIsRunning("123 (node) Z 1 2 3 ..."), false);
  assert.equal(processStateIsRunning("123 (node) X 1 2 3 ..."), false);
  assert.equal(processStateIsRunning("123 (node) R 1 2 3 ..."), true);
  assert.equal(processStateIsRunning("123 (node) S 1 2 3 ..."), true);
  assert.equal(processStateIsRunning("123 (a) b) S 1 2 3"), true);
  assert.equal(processStateIsRunning("unparsable"), true);
  assert.equal(processStateIsRunning("123 (node)"), true);
  const kill = (pid, signal) => {
    assert.equal(pid, 123);
    assert.equal(signal, 0);
  };
  const options = { kill, platform: "linux" };
  assert.equal(processRunning(123, { ...options, readStat: () => "123 (node) R 1 2 3" }), true);
  assert.equal(processRunning(123, { ...options, readStat: () => "123 (node) Z 1 2 3" }), false);
  const readStat = () => { throw new Error("stat entry is gone"); };
  assert.equal(processRunning(123, { ...options, readStat }), false);
  assert.equal(processRunning(123, { ...options, readStat, platform: "darwin" }), true);
  assert.equal(processRunning(123, {
    ...options,
    kill: () => { throw Object.assign(new Error("process is gone"), { code: "ESRCH" }); },
    readStat,
  }), false);
});

test("kills a detached command and its long-lived descendant", { skip: process.platform === "win32", timeout: 4_500 }, async () => {
  const parent = spawn(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    child.once('spawn', () => process.stdout.write(child.pid + '\\n'));
    setInterval(() => {}, 1000);
  `], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  let grandchildPid;
  try {
    const [output] = await once(parent.stdout, "data", { signal: AbortSignal.timeout(1_500) });
    grandchildPid = Number(output.toString().trim());
    assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0);
    assert.ok(processRunning(parent.pid));
    assert.ok(processRunning(grandchildPid));
    killProcessTree(parent);
    const deadline = Date.now() + 2_000;
    while ((processRunning(parent.pid) || processRunning(grandchildPid)) && Date.now() < deadline) await delay(25);
    assert.equal(processRunning(parent.pid), false, "parent process survived cancellation");
    assert.equal(processRunning(grandchildPid), false, "descendant process survived cancellation");
  } finally {
    killProcessTree(parent);
    if (grandchildPid && processRunning(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  }
});

test("kills an inherited-stdio descendant after its detached leader exits", { skip: process.platform === "win32", timeout: 4_500 }, async () => {
  const parent = spawn(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    child.once('spawn', () => process.stdout.write(child.pid + '\\n', () => process.exit(0)));
  `], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const exited = once(parent, "exit", { signal: AbortSignal.timeout(2_000) });
  let grandchildPid;
  try {
    const [output] = await once(parent.stdout, "data", { signal: AbortSignal.timeout(1_500) });
    grandchildPid = Number(output.toString().trim());
    assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0);
    assert.deepEqual(await exited, [0, null]);
    assert.equal(parent.exitCode, 0);
    assert.equal(parent.stdout.readableEnded, false, "descendant must keep inherited stdio open");
    assert.ok(processRunning(grandchildPid));
    killProcessTree(parent);
    const deadline = Date.now() + 2_000;
    while (processRunning(grandchildPid) && Date.now() < deadline) await delay(25);
    assert.equal(processRunning(grandchildPid), false, "descendant survived after its leader exited");
  } finally {
    killProcessTree(parent);
    if (grandchildPid && processRunning(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  }
});

function fixture(settings = {}) {
  const calls = [];
  const clickStates = [];
  const fills = [];
  const atomicClicks = [];
  const homeMutations = [];
  const origin = settings.origin ?? "http://localhost:3000";
  const fetchCalls = [];
  const evaluations = [];
  const socketUrls = [];
  const cdpCommands = [];
  let output = "";
  let clock = 0;
  let closeCalls = 0;
  let badgeChecks = 0;
  let homeUrlReads = 0;
  let homeBatches = 0;
  let frameUrlReads = 0;
  let state = "phone";
  let confirmationReads = 0;
  const text = {
    phone: "Enter your phone number", email: "Enter your email",
    otp: "Enter 6-digit verification code",
    identity: "Verify identity Date of birth Social security last four",
    review: "Review order Apple Pay Sandbox No real funds will be used",
    confirm: settings.confirmText ?? "Confirm sandbox purchase Apple Pay Sandbox No real funds will be used",
    completed: "Sandbox confirmation complete",
  };
  const next = { phone: "email", email: "otp", otp: "identity", identity: "review", confirm: "completed" };
  class HappySocket extends EventTarget {
    constructor(url) {
      super();
      socketUrls.push(url);
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(payload) {
      const command = JSON.parse(payload);
      cdpCommands.push(command);
      let result = {};
      if (command.method === "Runtime.evaluate") {
        const expression = command.params.expression;
        evaluations.push(expression);
        let value;
        if (expression === "location.href") {
          frameUrlReads += 1;
          value = typeof settings.frameUrl === "function" ? settings.frameUrl(frameUrlReads) : settings.frameUrl ?? VALID_TARGET.url;
        } else if (expression.includes("const labels =")) {
          const clicked = () => {
            clickStates.push(state);
            if (state === "review") confirmationReads = 3;
            else state = next[state];
          };
          if (expression.includes("return 'frame-not-sandbox'")) {
            assert.ok(badgeChecks >= (state === "review" ? 3 : 4));
            assert.ok(calls.filter(({ command: args }) => args.join(" ") === "get url").length >= (state === "review" ? 2 : 3));
            const clickState = state;
            const attributes = { role: settings.atomicRole, "aria-label": settings.atomicAriaLabel };
            const element = (innerText, elementAttributes = {}) => ({
              innerText, getAttribute: (name) => elementAttributes[name] ?? null,
              getBoundingClientRect: () => ({ width: 100, height: 20 }),
            });
            class Button {
              constructor() { Object.assign(this, element(settings.atomicButtonText ?? (state === "review" ? "Apple Pay Sandbox" : "Confirm"), attributes)); }
              click() { clicked(); }
            }
            const button = settings.atomicMissingAction ? element("Other action") : new Button();
            if (settings.atomicRole) {
              Object.setPrototypeOf(button, Object.prototype);
              button.click = clicked;
            }
            const href = typeof settings.atomicFrameUrl === "function" ? settings.atomicFrameUrl(state) : settings.atomicFrameUrl ?? VALID_TARGET.url;
            value = runInNewContext(expression, {
              URL, location: { href }, HTMLButtonElement: Button,
              document: { querySelectorAll: () => [element(settings.atomicText ?? text[state]), button] },
              getComputedStyle: (node) => ({ visibility: node === button && settings.atomicHiddenAction ? "hidden" : "visible", display: "block" }),
            });
            atomicClicks.push({ state: clickState, expression, result: value });
          } else {
            assert.ok(state !== "review" && state !== "confirm", "payment clicks must be atomic");
            class Button {
              innerText = state === "otp" ? "Verify" : "Continue";
              getAttribute() { return null; }
              getBoundingClientRect() { return { width: 100, height: 20 }; }
              click() { clicked(); }
            }
            const href = typeof settings.inputFrameUrl === "function" ? settings.inputFrameUrl(state, "click") : settings.inputFrameUrl ?? VALID_TARGET.url;
            value = runInNewContext(expression, {
              URL, location: { href }, HTMLButtonElement: Button,
              document: { querySelectorAll: () => [new Button()] },
              getComputedStyle: () => ({ visibility: "visible", display: "block" }),
            });
          }
        } else if (expression.includes("const value =")) {
          class Input {
            constructor(name) { this.name = name; }
            labels = [];
            maxLength = 6;
            set value(value) { fills.push({ state, name: this.name, value }); }
            getAttribute() { return null; }
            getBoundingClientRect() { return { width: 100, height: 20 }; }
            dispatchEvent() {}
          }
          const names = state === "identity" ? ["date of birth", "social security"] : [state === "otp" ? "code" : state];
          const href = typeof settings.inputFrameUrl === "function" ? settings.inputFrameUrl(state, "fill") : settings.inputFrameUrl ?? VALID_TARGET.url;
          value = runInNewContext(expression, {
            URL, location: { href }, HTMLInputElement: Input, Event,
            document: { querySelectorAll: () => names.map((name) => new Input(name)) },
            getComputedStyle: () => ({ visibility: "visible", display: "block" }),
          });
        } else {
          value = text[state];
          if (state === "review" && confirmationReads > 0 && --confirmationReads === 0) state = "confirm";
        }
        result = { result: { value } };
        if (expression === "location.href" && settings.frameUrlFailure) result.exceptionDetails = {};
      }
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ id: command.id, result }),
      })));
    }
    close() { this.dispatchEvent(new Event("close")); }
  }
  const processRunner = async (binary, args, options) => {
    const offset = args.includes("--headed") ? 5 : 4;
    let command = args[0] === "--version" ? args : args.slice(offset);
    calls.push({ binary, args, options, command });
    const success = { code: 0, stdout: "", stderr: "" };
    if (command[0] === "batch") {
      assert.deepEqual(command, ["batch", "--bail"]);
      const entries = JSON.parse(options.stdin);
      assert.equal(entries.length, 2);
      assert.deepEqual(entries[0], ["wait", "--fn", `location.origin === ${JSON.stringify(origin)}`]);
      validateAgentBrowserArgv(entries[1]);
      homeBatches += 1;
      if (settings.homeGuardFailure === true || settings.homeGuardFailure === homeBatches) return { ...success, code: 1 };
      command = entries[1];
      homeMutations.push(command);
    }
    if (command[0] === "--version") return { ...success, stdout: settings.version ?? "agent-browser 0.38.1" };
    if (command[0] === "close") {
      closeCalls += 1;
      if (closeCalls === 1 && settings.preCloseFailure) return { ...success, code: 1 };
      if (closeCalls === 2 && settings.cleanupFailure) {
        if (settings.cleanupFailure === "throw") throw new Error("person@sandbox.test at 203.0.113.42");
        return { code: 1, stdout: "", stderr: "person@sandbox.test at 203.0.113.42" };
      }
    }
    if (command[0] === "open" && settings.launchFailure) throw new HarnessError("home-flow", "person@sandbox.test at 203.0.113.42");
    if (command.join(" ") === "get cdp-url") return { ...success, stdout: "ws://127.0.0.1:9222/devtools/browser/synthetic" };
    if (command.join(" ") === "get url") {
      homeUrlReads += 1;
      const stdout = typeof settings.homeUrl === "function" ? settings.homeUrl(homeUrlReads) : `${origin}/home`;
      return { ...success, stdout };
    }
    if (command[0] === "find" && command[1] === "text" && command[2] === BADGE) {
      badgeChecks += 1;
      if (settings.missingBadge === badgeChecks) return { ...success, code: 1 };
    }
    if (command[0] === "wait" && command[2] === BADGE && settings.badgeWaitFailure) return { ...success, code: 1 };
    return success;
  };
  const options = {
    argv: ["--origin", origin],
    environment: { COINBASE_ONRAMP_AGENT_BROWSER_LIVE: "1", AGENT_BROWSER_PROFILE: "private", AGENT_BROWSER_STATE: "private", HOME_AGENT_BROWSER_BIN: "/ignored" },
    output: { write(chunk) { output += chunk; } },
    resolveBinary: () => ({ binary: "/repository-pinned/browser", expectedVersion: "0.38.1" }),
    processRunner,
    fetchImpl: async (url, init) => {
      fetchCalls.push(url);
      assert.ok(init.signal instanceof AbortSignal);
      if (settings.fetchFailure) throw new Error("Discovery fetch failed");
      return { ok: true, async json() {
        if (settings.malformedJson) throw new SyntaxError("Malformed discovery JSON");
        return settings.targets ?? [VALID_TARGET];
      } };
    },
    WebSocketImpl: HappySocket,
    sleep: async (ms) => { clock += ms; }, now: () => clock,
    registerSignals: false,
  };
  return { calls, clickStates, fills, atomicClicks, homeMutations, fetchCalls, evaluations, socketUrls, cdpCommands, options, output: () => output,
    summaries: () => output.trim().split("\n").map((line) => JSON.parse(line)), state: () => state };
}

for (const environment of [{}, { CI: "1", COINBASE_ONRAMP_AGENT_BROWSER_LIVE: "1" }]) {
  test(`opt-in refusal without browser calls: ${JSON.stringify(environment)}`, async () => {
    const f = fixture();
    let resolved = false;
    assert.equal(await runAgentBrowserHarness({ ...f.options, environment,
      resolveBinary: () => { resolved = true; throw new Error("must not resolve"); },
    }), 1);
    assert.equal(resolved, false);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.summaries().slice(0, 2), [
      { stage: "optin", status: "failed" },
      { stage: "recovery: set COINBASE_ONRAMP_AGENT_BROWSER_LIVE=1 outside CI and rerun", status: "required" },
    ]);
    assert.equal(f.summaries().filter(({ stage }) => stage.startsWith("recovery:")).length, 1);
  });
}

for (const [name, settings, overrides, recovery] of [
  ["origin", {}, { argv: ["--origin", "https://localhost:3000"] }, "--origin http://localhost:<port>"],
  ["binary", {}, { resolveBinary: () => { throw new HarnessError("binary", "missing"); } }, "bun run worktree:bootstrap"],
  ["version", { version: "agent-browser 0.21.4" }, {}, "rm -rf node_modules/agent-browser && bun install --frozen-lockfile"],
  ["iframe-zero", { targets: [] }, {}, "sandbox server setup"],
  ["iframe-multiple", { targets: [VALID_TARGET, VALID_TARGET] }, {}, "one Add money flow"],
  ["home-flow", { launchFailure: true }, {}, "local sandbox server environment"],
  ["payment-guard", { badgeWaitFailure: true }, {}, "sandbox label"],
]) {
  test(`orchestrator classifies ${name} and cleans up`, async () => {
    const f = fixture(settings);
    assert.equal(await runAgentBrowserHarness({ ...f.options, ...overrides }), 1);
    assert.ok(f.summaries().some(({ stage, status }) => stage === name && status === "failed"));
    assert.ok(f.summaries().some(({ stage }) => stage.startsWith("recovery:") && stage.includes(recovery)));
    assert.equal(f.summaries().at(-1).stage, "cleanup-named-session");
    const closes = f.calls.filter(({ command }) => command[0] === "close");
    if (["origin", "binary", "version"].includes(name)) {
      assert.equal(closes.length, 0);
      assert.deepEqual(f.summaries().at(-1), { stage: "cleanup-named-session", status: "passed" });
    } else assert.ok(closes.length > 0);
    assert.ok(!f.clickStates.includes("review"));
    assert.equal(f.output().includes("person@sandbox.test"), false);
    assert.equal(f.output().includes("203.0.113.42"), false);
  });
}

test("refuses launch when the named session cannot be pre-closed", async () => {
  const f = fixture({ preCloseFailure: true });
  assert.equal(await runAgentBrowserHarness(f.options), 1);
  assert.deepEqual(f.calls.map(({ command }) => command), [["--version"], ["close"], ["close"]]);
  assert.deepEqual(f.summaries(), [
    { stage: "session", status: "failed" },
    { stage: "recovery: close the named harness session and rerun", status: "required" },
    { stage: "cleanup-named-session", status: "passed" },
  ]);
});

test("revalidates the local Home origin before every Home mutation", async () => {
  const happy = fixture();
  assert.equal(await runAgentBrowserHarness(happy.options), 0);
  const happyCommands = happy.calls.map(({ command }) => command);
  const homeReads = happyCommands.flatMap((command, index) => command.join(" ") === "get url" ? [index] : []);
  for (const read of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const f = fixture({ homeUrl: (count) => count === read ? "https://remote.test/home" : "http://localhost:3000/home" });
    assert.equal(await runAgentBrowserHarness(f.options), 1);
    assert.deepEqual(f.calls.map(({ command }) => command), [
      ...happyCommands.slice(0, homeReads[read - 1] + 1), ["close"],
    ]);
    assert.ok(f.summaries().some(({ stage, status }) => stage === "home-flow" && status === "failed"));
    assert.ok(f.summaries().some(({ stage }) => stage.includes("local sandbox server environment")));
    assert.equal(f.homeMutations.some((command) => command.includes("View payment instructions")), false);
    if (read <= 8) assert.equal(f.homeMutations.some((command) => command.includes("Confirm deposit")), false);
  }
});

test("batches every Home mutation behind the exact in-page local origin guard", async () => {
  const f = fixture({ origin: "http://localhost:3210" });
  assert.equal(await runAgentBrowserHarness(f.options), 0);
  const expected = [
    ["storage", "local", "set", "home.country.v2", "US"], ["reload"],
    ["find", "role", "link", "click", "--name", "Add money", "--exact"],
    ["find", "role", "button", "click", "--name", "Deposit USD"],
    ["find", "role", "textbox", "fill", "--name", "Amount", "5"],
    ["find", "role", "button", "click", "--name", "Review quote", "--exact"],
    ["find", "role", "button", "click", "--name", "Confirm deposit", "--exact"],
    ["find", "role", "button", "click", "--name", "View payment instructions", "--exact"],
  ];
  assert.deepEqual(f.homeMutations, expected);
  const batches = f.calls.filter(({ command }) => command[0] === "batch");
  assert.equal(batches.length, expected.length);
  for (const [index, call] of batches.entries()) {
    assert.deepEqual(call.command, ["batch", "--bail"]);
    assert.deepEqual(JSON.parse(call.options.stdin), [
      ["wait", "--fn", 'location.origin === "http://localhost:3210"'], expected[index],
    ]);
  }
  assert.equal(f.calls.some(({ command }) => ["storage", "reload"].includes(command[0]) || command.includes("click") || command.includes("fill")), false);
});

for (let homeGuardFailure = 1; homeGuardFailure <= 8; homeGuardFailure += 1) {
  test(`failed in-page Home origin guard ${homeGuardFailure} issues no mutation`, async () => {
    const happy = fixture();
    assert.equal(await runAgentBrowserHarness(happy.options), 0);
    const f = fixture({ homeGuardFailure });
    assert.equal(await runAgentBrowserHarness(f.options), 1);
    assert.deepEqual(f.homeMutations, happy.homeMutations.slice(0, homeGuardFailure - 1));
    assert.equal(f.calls.filter(({ command }) => command[0] === "batch").length, homeGuardFailure);
    assert.deepEqual(f.calls.slice(-2).map(({ command }) => command), [["batch", "--bail"], ["close"]]);
    assert.ok(f.summaries().some(({ stage, status }) => stage === "home-flow" && status === "failed"));
    assert.deepEqual(f.clickStates, []);
  });
}

test("refuses Home mutations when the post-authentication origin is unreadable", async () => {
  const f = fixture({ homeUrl: (count) => count === 1 ? "http://localhost:3000/home" : "unreadable" });
  assert.equal(await runAgentBrowserHarness(f.options), 1);
  assert.deepEqual(f.calls.map(({ command }) => command), [
    ["--version"], ["close"], ["open", "http://localhost:3000"], ["get", "url"],
    ["find", "role", "link", "text", "--name", "Add money", "--exact"], ["get", "url"], ["close"],
  ]);
  assert.ok(f.summaries().some(({ stage }) => stage === "home-flow"));
});

for (const settings of [{ fetchFailure: true }, { malformedJson: true }]) {
  test(`classifies discovery fetch/JSON failures as cdp: ${JSON.stringify(settings)}`, async () => {
    const f = fixture(settings);
    assert.equal(await runAgentBrowserHarness(f.options), 1);
    assert.ok(f.summaries().some(({ stage, status }) => stage === "cdp" && status === "failed"));
    assert.ok(f.summaries().some(({ stage }) => stage.includes("rerun with the pinned browser")));
    assert.equal(f.evaluations.length, 0);
  });
}

for (const [name, settings] of [
  ["non-sandbox", { frameUrl: "https://pay.coinbase.com/confirmation" }],
  ["different origin", { frameUrl: "https://remote.test/?useApplePaySandbox=true" }],
  ["unreadable", { frameUrlFailure: true }],
]) {
  test(`refuses sandbox payment when the live frame URL is ${name}`, async () => {
    const f = fixture(settings);
    assert.equal(await runAgentBrowserHarness(f.options), 1);
    assert.ok(f.summaries().some(({ stage, status }) => stage === "payment-guard" && status === "failed"));
    assert.equal(f.clickStates.includes("review"), false);
    assert.equal(f.clickStates.includes("confirm"), false);
    assert.deepEqual(f.evaluations, ["location.href"]);
    assert.deepEqual(f.cdpCommands.map(({ method }) => method), ["Runtime.enable", "Runtime.evaluate"]);
  });
}

for (const [name, url] of [
  ["non-sandbox", "https://pay.coinbase.com/confirmation"],
  ["different origin", "https://remote.test/?useApplePaySandbox=true"],
  ["unreadable", "not a URL"],
]) {
  for (const action of ["fill", "click"]) {
    test(`refuses a mid-flow ${action} when the frame becomes ${name}`, async () => {
      const f = fixture({ inputFrameUrl: (state, kind) => state === "email" && kind === action ? url : VALID_TARGET.url });
      assert.equal(await runAgentBrowserHarness(f.options), 1);
      assert.ok(f.summaries().some(({ stage, status }) => stage === "coinbase-screen" && status === "failed"));
      assert.deepEqual(f.clickStates, ["phone"]);
      assert.deepEqual(f.fills, [
        { state: "phone", name: "phone", value: "+10005550199" },
        ...(action === "click" ? [{ state: "email", name: "email", value: "home-563@sandbox.test" }] : []),
      ]);
      assert.deepEqual(f.atomicClicks, []);
      assert.deepEqual(f.summaries().at(-1), { stage: "cleanup-named-session", status: "passed" });
    });
  }
}

test("rechecks the live frame URL before fake confirmation", async () => {
  const f = fixture({ frameUrl: (read) => read <= 2 ? VALID_TARGET.url : "https://pay.coinbase.com/confirmation" });
  assert.equal(await runAgentBrowserHarness(f.options), 1);
  assert.ok(f.clickStates.includes("review"));
  assert.equal(f.clickStates.includes("confirm"), false);
  assert.equal(f.evaluations.filter((expression) => expression === "location.href").length, 3);
  assert.ok(f.summaries().some(({ stage }) => stage === "payment-guard"));
});

test("rechecks the live frame URL before the first fake payment click", async () => {
  const f = fixture({ frameUrl: (read) => read === 1 ? VALID_TARGET.url : "https://pay.coinbase.com/confirmation" });
  assert.equal(await runAgentBrowserHarness(f.options), 1);
  assert.deepEqual(f.clickStates, ["phone", "email", "otp", "identity"]);
  assert.deepEqual(f.atomicClicks, []);
  assert.ok(f.summaries().some(({ stage }) => stage === "payment-guard"));
});

for (const [outcome, settings] of [
  ["frame-unreadable", { atomicFrameUrl: "unreadable" }],
  ["frame-not-sandbox", { atomicFrameUrl: "https://pay.coinbase.com/confirmation" }],
  ["missing-apple-pay-sandbox", { atomicText: "No real funds will be used", atomicButtonText: "Other action" }],
  ["missing-no-real-funds", { atomicText: "Apple Pay Sandbox" }],
  ["missing-action", { atomicMissingAction: true }],
  ["missing-action", { atomicHiddenAction: true }],
]) {
  test(`atomic payment guard ${outcome} prevents a payment click: ${JSON.stringify(settings)}`, async () => {
    const f = fixture(settings);
    assert.equal(await runAgentBrowserHarness(f.options), 1);
    assert.ok(f.summaries().some(({ stage, status }) => stage === "payment-guard" && status === "failed"));
    assert.deepEqual(f.clickStates, ["phone", "email", "otp", "identity"]);
    assert.deepEqual(f.atomicClicks.map(({ state, result }) => ({ state, result })), [{ state: "review", result: outcome }]);
  });
}

test("atomic confirmation guard blocks a frame navigation after the pre-check", async () => {
  const f = fixture({ atomicFrameUrl: (state) => state === "review" ? VALID_TARGET.url : "https://pay.coinbase.com/confirmation" });
  assert.equal(await runAgentBrowserHarness(f.options), 1);
  assert.ok(f.summaries().some(({ stage }) => stage === "payment-guard"));
  assert.deepEqual(f.clickStates, ["phone", "email", "otp", "identity", "review"]);
  assert.deepEqual(f.atomicClicks.map(({ state, result }) => ({ state, result })), [
    { state: "review", result: "clicked" }, { state: "confirm", result: "frame-not-sandbox" },
  ]);
});

test("atomic payment clicks allow sandbox route changes and role-button aria labels", async () => {
  const f = fixture({ atomicFrameUrl: "https://pay.coinbase.com/confirmation?useApplePaySandbox=true",
    atomicRole: "button", atomicButtonText: "Payment action", atomicAriaLabel: "Apple Pay Sandbox confirm",
  });
  assert.equal(await runAgentBrowserHarness(f.options), 0);
  assert.deepEqual(f.atomicClicks.map(({ result }) => result), ["clicked", "clicked"]);
});

for (const missingBadge of [1, 2, 3, 4]) {
  test(`blocks sandbox payment when Home badge check ${missingBadge} fails`, async () => {
    const f = fixture({ missingBadge });
    assert.equal(await runAgentBrowserHarness(f.options), 1);
    assert.ok(f.summaries().some(({ stage, status }) => stage === "payment-guard" && status === "failed"));
    assert.equal(f.clickStates.includes("confirm"), false);
    if (missingBadge < 4) assert.equal(f.clickStates.includes("review"), false);
    assert.equal(f.calls.filter(({ command }) => command[0] === "close").length, 2);
  });
}

test("rechecks fresh Coinbase sandbox text before fake confirmation", async () => {
  const f = fixture({ confirmText: "Confirm purchase" });
  assert.equal(await runAgentBrowserHarness(f.options), 1);
  assert.ok(f.clickStates.includes("review"));
  assert.ok(!f.clickStates.includes("confirm"));
  assert.ok(f.summaries().some(({ stage }) => stage === "payment-guard"));
});

test("happy path uses pinned semantics, every guard, and full stage order", async () => {
  const f = fixture();
  assert.equal(await runAgentBrowserHarness(f.options), 0);
  assert.equal(f.state(), "completed");
  assert.deepEqual(f.clickStates, ["phone", "email", "otp", "identity", "review", "confirm"]);
  assert.deepEqual(f.fetchCalls, ["http://127.0.0.1:9222/json/list"]);
  assert.ok(f.calls.every(({ binary }) => binary === "/repository-pinned/browser"));
  assert.ok(f.calls.every(({ args }) => { validateAgentBrowserArgv(args); return !args.includes("--all"); }));
  assert.ok(f.calls.every(({ options }) => Object.keys(options.environment).every((key) => !key.startsWith("AGENT_BROWSER_"))));
  const sessionCalls = f.calls.filter(({ args }) => args.includes("--session"));
  assert.ok(sessionCalls.every(({ args }) => args[0] === "--config" && args[2] === "--session" && args[3] === SESSION));
  assert.equal(sessionCalls.filter(({ command }) => command[0] === "close").length, 2);
  assert.equal(sessionCalls.filter(({ args }) => args.includes("--headed")).length, 1);
  assert.ok(sessionCalls.find(({ args }) => args.includes("--headed")).command.includes("open"));
  for (const command of [
    ["storage", "local", "set", "home.country.v2", "US"],
    ["find", "role", "link", "text", "--name", "Add money", "--exact"],
    ["find", "role", "link", "click", "--name", "Add money", "--exact"],
    ["find", "role", "button", "click", "--name", "Deposit USD"],
    ["find", "role", "textbox", "fill", "--name", "Amount", "5"],
    ["wait", "--text", "Review payment details"], ["find", "text", TERMINAL, "text"],
  ]) assert.ok([...sessionCalls.map((call) => call.command), ...f.homeMutations].some((actual) => JSON.stringify(actual) === JSON.stringify(command)), command.join(" "));
  assert.equal(sessionCalls.filter(({ command }) => command[0] === "wait" && command[2] === BADGE).length, 2);
  for (const [index, call] of sessionCalls.entries()) {
    if (call.command[0] === "batch") {
      assert.deepEqual(sessionCalls[index - 1].command, ["get", "url"]);
      assert.deepEqual(call.command, ["batch", "--bail"]);
      assert.deepEqual(JSON.parse(call.options.stdin)[0], ["wait", "--fn", 'location.origin === "http://localhost:3000"']);
    } else {
      assert.equal(["storage", "reload"].includes(call.command[0]) || call.command.includes("click") || call.command.includes("fill"), false);
    }
  }
  assert.equal(f.evaluations.filter((expression) => expression === "location.href").length, 3);
  assert.deepEqual(f.atomicClicks.map(({ state, result }) => ({ state, result })), [
    { state: "review", result: "clicked" }, { state: "confirm", result: "clicked" },
  ]);
  assert.ok(f.evaluations.some((expression) => expression.includes('"+10005550199"')));
  for (const value of ["home-563@sandbox.test", "000000", "0000", "01/01/1990"]) {
    assert.ok(f.evaluations.some((expression) => expression.includes(JSON.stringify(value))));
  }
  assert.deepEqual(f.summaries(), [
    { stage: "preflight", status: "passed" },
    { stage: "home-auth-checkpoint", status: "waiting-for-human" },
    { stage: "home-auth-checkpoint", status: "passed" },
    { stage: "home-sandbox-order", status: "passed" },
    { stage: "coinbase-sandbox-iframe", status: "passed" },
    { stage: "coinbase-sandbox-details", status: "passed" },
    { stage: "sandbox-payment-guard", status: "passed" },
    { stage: "sandbox-payment", status: "confirmed-fake-only" },
    { stage: "home-sandbox-terminal", status: "passed" },
    { stage: "cleanup-named-session", status: "passed" },
  ]);
  assert.ok(f.summaries().every((summary) => Object.keys(summary).join(",") === "stage,status"));
});

for (const cleanupFailure of ["nonzero", "throw"]) {
  for (const launchFailure of [false, true]) {
    test(`cleanup ${cleanupFailure} after ${launchFailure ? "failure" : "success"} is sanitized and fails command`, async () => {
      const f = fixture({ cleanupFailure, launchFailure });
      assert.equal(await runAgentBrowserHarness(f.options), 1);
      assert.deepEqual(f.summaries().slice(-2), [
        { stage: "cleanup-named-session", status: "failed" },
        { stage: `recovery: run bun run ab -- --session ${SESSION} close and verify it succeeds before rerunning`, status: "required" },
      ]);
      assert.equal(f.summaries().filter(({ stage }) => stage === "cleanup-named-session").length, 1);
      assert.equal(f.output().includes("person@sandbox.test"), false);
      assert.equal(f.output().includes("203.0.113.42"), false);
    });
  }
}

test("a signal during binary resolution fences preflight before the version command", async () => {
  const f = fixture();
  const listenerCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const exits = [];
  let cancellations = 0;
  assert.equal(await runAgentBrowserHarness({ ...f.options, registerSignals: true,
    resolveBinary: () => {
      process.emit("SIGINT");
      return f.options.resolveBinary();
    },
    cancelActiveCommands: () => { cancellations += 1; },
    exitProcess: (code) => { exits.push(code); },
  }), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [130]);
  assert.deepEqual(f.calls, []);
  assert.equal(cancellations, 1);
  assert.deepEqual(f.summaries(), [
    { stage: "signal", status: "failed" },
    { stage: "recovery: rerun the command after the named session is closed", status: "required" },
    { stage: "cleanup-named-session", status: "passed" },
  ]);
  assert.equal(process.listenerCount("SIGINT"), listenerCounts[0]);
  assert.equal(process.listenerCount("SIGTERM"), listenerCounts[1]);
});

test("a signal immediately after config allocation removes the directory before exiting 130", { timeout: 2_000 }, async () => {
  const f = fixture();
  const listenerCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  let markStarted;
  let directory;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const exits = [];
  let cancellations = 0;
  const harness = runAgentBrowserHarness({ ...f.options, registerSignals: true,
    mkdtempSync: (prefix) => {
      directory = mkdtempSync(prefix);
      markStarted();
      return directory;
    },
    cancelActiveCommands: () => { cancellations += 1; },
    exitProcess: (code) => { exits.push(code); },
  });
  try {
    await started;
    process.emit("SIGINT");
    assert.equal(cancellations, 1);
    assert.equal(await harness, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(exits, [130]);
    await assert.rejects(access(directory), { code: "ENOENT" });
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.summaries().at(-1), { stage: "cleanup-named-session", status: "passed" });
    assert.equal(process.listenerCount("SIGINT"), listenerCounts[0]);
    assert.equal(process.listenerCount("SIGTERM"), listenerCounts[1]);
  } finally {
    await harness;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("a signal during the pending version check cancels preflight without session commands", async () => {
  const f = fixture();
  const listenerCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  let resolveVersion;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const exits = [];
  let cancellations = 0;
  const harness = runAgentBrowserHarness({ ...f.options, registerSignals: true,
    processRunner: async (binary, args, options) => {
      const result = await f.options.processRunner(binary, args, options);
      if (args[0] === "--version") {
        return new Promise((resolve) => {
          resolveVersion = () => resolve(result);
          markStarted();
        });
      }
      return result;
    },
    cancelActiveCommands: () => { cancellations += 1; },
    exitProcess: (code) => { exits.push(code); },
  });
  await started;
  process.emit("SIGINT");
  assert.equal(cancellations, 1);
  resolveVersion();
  assert.equal(await harness, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [130]);
  assert.deepEqual(f.calls.map(({ command }) => command), [["--version"]]);
  assert.equal(cancellations, 1);
  assert.deepEqual(f.summaries(), [
    { stage: "signal", status: "failed" },
    { stage: "recovery: rerun the command after the named session is closed", status: "required" },
    { stage: "cleanup-named-session", status: "passed" },
  ]);
  assert.equal(process.listenerCount("SIGINT"), listenerCounts[0]);
  assert.equal(process.listenerCount("SIGTERM"), listenerCounts[1]);
});

test("signals fence commands and retain handlers until cleanup settles", async () => {
  const f = fixture();
  const listenerCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  let resolveOpen;
  let resolveClose;
  let markStarted;
  let markCleanupStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const cleanupStarted = new Promise((resolve) => { markCleanupStarted = resolve; });
  const exits = [];
  const events = [];
  let closes = 0;
  let cancellations = 0;
  const processRunner = async (binary, args, options) => {
    const result = await f.options.processRunner(binary, args, options);
    if (args.at(-2) === "open") {
      markStarted();
      return new Promise((resolve) => { resolveOpen = () => { events.push("open-settled"); resolve(result); }; });
    }
    if (args.at(-1) === "close" && ++closes === 2) {
      events.push("close-started");
      markCleanupStarted();
      return new Promise((resolve) => { resolveClose = () => resolve(result); });
    }
    return result;
  };
  const harness = runAgentBrowserHarness({ ...f.options, registerSignals: true, processRunner,
    cancelActiveCommands: () => { cancellations += 1; events.push("cancel"); },
    sleep: (ms) => ms === 5_000 ? new Promise(() => {}) : f.options.sleep(ms),
    exitProcess: (code) => { exits.push(code); },
  });
  await started;
  process.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancellations, 1);
  assert.equal(closes, 1);
  assert.deepEqual(events, ["cancel"]);
  assert.deepEqual(f.calls.map(({ command }) => command), [["--version"], ["close"], ["open", "http://localhost:3000"]]);
  resolveOpen();
  await cleanupStarted;
  assert.deepEqual(events, ["cancel", "open-settled", "close-started"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(process.listenerCount("SIGINT"), listenerCounts[0] + 1);
  assert.equal(process.listenerCount("SIGTERM"), listenerCounts[1] + 1);
  process.emit("SIGINT");
  process.emit("SIGTERM");
  assert.deepEqual(exits, []);
  resolveClose();
  assert.equal(await harness, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [130]);
  assert.deepEqual(f.calls.map(({ command }) => command), [
    ["--version"], ["close"], ["open", "http://localhost:3000"], ["close"],
  ]);
  assert.equal(cancellations, 1);
  assert.equal(f.summaries().filter(({ stage }) => stage === "signal").length, 1);
  assert.equal(f.summaries().filter(({ stage }) => stage === "cleanup-named-session").length, 1);
  assert.equal(f.summaries().some(({ stage }) => stage === "home-auth-checkpoint"), false);
  assert.equal(process.listenerCount("SIGINT"), listenerCounts[0]);
  assert.equal(process.listenerCount("SIGTERM"), listenerCounts[1]);
  assert.deepEqual(f.summaries().slice(-3), [
    { stage: "signal", status: "failed" },
    { stage: "recovery: rerun the command after the named session is closed", status: "required" },
    { stage: "cleanup-named-session", status: "passed" },
  ]);
});

test("a signal during target discovery prevents a late CDP connection or command", async () => {
  const f = fixture();
  const listenerCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  let resolveDiscovery;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const exits = [];
  const harness = runAgentBrowserHarness({ ...f.options, registerSignals: true,
    fetchImpl: async (url, init) => {
      const response = await f.options.fetchImpl(url, init);
      markStarted();
      return new Promise((resolve) => { resolveDiscovery = () => resolve(response); });
    },
    exitProcess: (code) => { exits.push(code); },
  });
  await started;
  const callsBeforeSignal = f.calls.map(({ command }) => command);
  process.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  resolveDiscovery();
  assert.equal(await harness, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [130]);
  assert.deepEqual(f.calls.map(({ command }) => command), [...callsBeforeSignal, ["close"]]);
  assert.deepEqual(f.socketUrls, []);
  assert.deepEqual(f.cdpCommands, []);
  assert.deepEqual(f.evaluations, []);
  assert.deepEqual(f.clickStates, []);
  assert.deepEqual(f.summaries().slice(-3), [
    { stage: "signal", status: "failed" },
    { stage: "recovery: rerun the command after the named session is closed", status: "required" },
    { stage: "cleanup-named-session", status: "passed" },
  ]);
  assert.equal(process.listenerCount("SIGINT"), listenerCounts[0]);
  assert.equal(process.listenerCount("SIGTERM"), listenerCounts[1]);
});

test("CDP helper uses bounded IDs and by-value awaited evaluation", async () => {
  class FakeSocket extends EventTarget {
    static instance;
    sent = [];
    constructor() {
      super();
      FakeSocket.instance = this;
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(payload) {
      const command = JSON.parse(payload);
      this.sent.push(command);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ id: command.id, result: { result: { value: command.method } } }),
      })));
    }
    close() { this.dispatchEvent(new Event("close")); }
  }
  const client = new CdpClient(VALID_TARGET.webSocketDebuggerUrl, { WebSocketImpl: FakeSocket, commandTimeoutMs: 100 });
  const [evaluation, document] = await Promise.all([client.evaluate("document.body.innerText"), client.command("DOM.getDocument")]);
  assert.equal(evaluation, "Runtime.evaluate");
  assert.deepEqual(document, { result: { value: "DOM.getDocument" } });
  assert.deepEqual(FakeSocket.instance.sent.map(({ id, method }) => ({ id, method })), [
    { id: 1, method: "Runtime.evaluate" }, { id: 2, method: "DOM.getDocument" },
  ]);
  assert.equal(FakeSocket.instance.sent[0].params.awaitPromise, true);
  assert.equal(FakeSocket.instance.sent[0].params.returnByValue, true);
  client.nextId = 10_001;
  await assert.rejects(client.command("Runtime.enable"), errorCode("cdp"));
  client.close();
});
