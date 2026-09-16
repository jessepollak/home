import assert from "node:assert/strict";
import test from "node:test";

import {
  CdpClient,
  HarnessError,
  assertAgentBrowserVersion,
  assertLocalOrigin,
  assertPaymentGuards,
  assertLoopbackCdpUrl,
  assertNodeVersion,
  buildAgentBrowserArgv,
  createAgentBrowserEnvironment,
  createStepOrder,
  formatSummary,
  inspectCoinbaseTarget,
  pollForCoinbaseTarget,
  redactSensitive,
  selectCoinbaseTarget,
  validateAgentBrowserArgv,
} from "../../onramp/agent-browser-lib.mjs";
import { runAgentBrowserHarness } from "../../onramp/agent-browser.mjs";

const VALID_TARGET = {
  type: "iframe",
  url: "https://pay.coinbase.com/v3/api-onramp/embedded-order?useApplePaySandbox=true",
  webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/synthetic",
};

for (const origin of [
  "https://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost",
  "http://localhost:3000/path",
  "http://localhost:3000?next=pay",
  "http://localhost.evil.test:3000",
  "http://user@localhost:3000",
]) {
  test(`rejects non-exact local origin: ${origin}`, () => {
    assert.throws(() => assertLocalOrigin(origin), (error) => error.code === "origin");
  });
}

test("accepts only an exact localhost origin with an explicit port", () => {
  assert.equal(assertLocalOrigin("http://localhost:3000"), "http://localhost:3000");
});

test("requires Node 22 or newer", () => {
  assert.throws(() => assertNodeVersion("21.7.0"), (error) => error.code === "node-version");
  assert.equal(assertNodeVersion("22.0.0"), 22);
});

for (const [version, accepted] of [
  ["agent-browser 0.20.9", false],
  ["agent-browser 0.21.0", true],
  ["0.21.4", true],
  ["agent-browser 1.0.0", true],
  ["unknown", false],
]) {
  test(`agent-browser version guard: ${version}`, () => {
    if (accepted) assert.doesNotThrow(() => assertAgentBrowserVersion(version));
    else assert.throws(() => assertAgentBrowserVersion(version));
  });
}

test("drops every ambient AGENT_BROWSER variable without changing unrelated environment", () => {
  assert.deepEqual(createAgentBrowserEnvironment({
    PATH: "/safe/bin",
    HOME_AGENT_BROWSER_BIN: "/safe/agent-browser",
    AGENT_BROWSER_PROFILE: "/secret/profile",
    AGENT_BROWSER_SESSION: "ambient",
    AGENT_BROWSER_SESSION_NAME: "persistent",
    AGENT_BROWSER_STATE: "/secret/state.json",
    AGENT_BROWSER_AUTO_CONNECT: "1",
  }), {
    PATH: "/safe/bin",
    HOME_AGENT_BROWSER_BIN: "/safe/agent-browser",
  });
});

for (const argv of [
  ["--profile", "/tmp/profile", "open", "http://localhost:3000"],
  ["--state=/tmp/state.json", "open", "http://localhost:3000"],
  ["--session-name", "persist", "open", "http://localhost:3000"],
  ["--auto-connect", "open", "http://localhost:3000"],
  ["snapshot"],
  ["screenshot", "/tmp/proof.png"],
]) {
  test(`rejects unsafe agent-browser argv: ${argv.join(" ")}`, () => {
    assert.throws(() => validateAgentBrowserArgv(argv), (error) => error.code === "argv");
  });
}

test("maps only loopback CDP WebSocket endpoints to bounded HTTP discovery origins", () => {
  assert.equal(assertLoopbackCdpUrl("ws://127.0.0.1:9222/devtools/browser/synthetic"), "http://127.0.0.1:9222");
  assert.equal(assertLoopbackCdpUrl("http://localhost:9222"), "http://localhost:9222");
  assert.throws(() => assertLoopbackCdpUrl("ws://example.com:9222/devtools/browser/synthetic"));
});

test("constructs headed commands with only isolated config and named session controls", () => {
  assert.deepEqual(buildAgentBrowserArgv({
    session: "home-coinbase-onramp-sandbox",
    configPath: "/tmp/isolated.json",
    command: ["open", "http://localhost:3000"],
    headed: true,
  }), [
    "--config", "/tmp/isolated.json",
    "--session", "home-coinbase-onramp-sandbox",
    "--headed", "open", "http://localhost:3000",
  ]);
});

for (const [name, target, accepted] of [
  ["valid", VALID_TARGET, true],
  ["wrong type", { ...VALID_TARGET, type: "page" }, false],
  ["origin prefix spoof", { ...VALID_TARGET, url: "https://pay.coinbase.com.evil.test/v3/api-onramp/embedded-order?useApplePaySandbox=true" }, false],
  ["userinfo spoof", { ...VALID_TARGET, url: "https://pay.coinbase.com@evil.test/v3/api-onramp/embedded-order?useApplePaySandbox=true" }, false],
  ["wrong path", { ...VALID_TARGET, url: "https://pay.coinbase.com/v3/api-onramp/embedded-order/extra?useApplePaySandbox=true" }, false],
  ["query false", { ...VALID_TARGET, url: "https://pay.coinbase.com/v3/api-onramp/embedded-order?useApplePaySandbox=false" }, false],
  ["query key spoof", { ...VALID_TARGET, url: "https://pay.coinbase.com/v3/api-onramp/embedded-order?xuseApplePaySandbox=true" }, false],
  ["missing websocket", { ...VALID_TARGET, webSocketDebuggerUrl: undefined }, false],
]) {
  test(`validates Coinbase iframe target: ${name}`, () => {
    assert.equal(inspectCoinbaseTarget(target), accepted);
  });
}

test("distinguishes zero and multiple valid Coinbase iframe targets", () => {
  assert.throws(() => selectCoinbaseTarget([]), (error) => error.code === "iframe-zero");
  assert.throws(
    () => selectCoinbaseTarget([VALID_TARGET, { ...VALID_TARGET }]),
    (error) => error.code === "iframe-multiple",
  );
  assert.equal(selectCoinbaseTarget([{ type: "page", url: "about:blank" }, VALID_TARGET]), VALID_TARGET);
});

test("target polling ignores spoofed targets and returns the first sole exact iframe", async () => {
  let reads = 0;
  let sleeps = 0;
  const target = await pollForCoinbaseTarget(async () => {
    reads += 1;
    if (reads === 1) {
      return [{ ...VALID_TARGET, url: "https://pay.coinbase.com.evil.test/v3/api-onramp/embedded-order?useApplePaySandbox=true" }];
    }
    return [VALID_TARGET];
  }, {
    timeoutMs: 100,
    intervalMs: 1,
    sleep: async () => { sleeps += 1; },
  });
  assert.equal(target, VALID_TARGET);
  assert.equal(reads, 2);
  assert.equal(sleeps, 1);
});

const COMPLETE_GUARD = {
  localOrigin: true,
  homeSandboxBadge: true,
  iframeSandboxQuery: true,
  applePaySandboxText: true,
  noRealFundsText: true,
};

test("requires every independent payment guard signal", () => {
  assert.equal(assertPaymentGuards(COMPLETE_GUARD), true);
  for (const key of Object.keys(COMPLETE_GUARD)) {
    assert.throws(
      () => assertPaymentGuards({ ...COMPLETE_GUARD, [key]: false }),
      (error) => error.code === "payment-guard",
    );
  }
});

test("redacts every bounded sensitive-output class", () => {
  const sensitive = [
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature",
    "0x1234567890abcdef1234567890abcdef12345678",
    "person@sandbox.test",
    "+10005550199",
    "https://pay.coinbase.com/v3/api-onramp/embedded-order?paymentToken=secret-value",
    `${"session"}Token=another-secret`,
    "ws://127.0.0.1:9222/devtools/page/secret",
    "203.0.113.42",
  ].join(" ");
  const redacted = redactSensitive(sensitive);
  for (const secret of ["signature", "1234567890abcdef", "person@sandbox.test", "+10005550199", "another-secret", "203.0.113.42"]) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.ok(redacted.includes("[redacted-jwt]"));
  assert.ok(redacted.length <= 1200);
});

test("summary output has no field capable of carrying raw browser output", () => {
  const summary = JSON.parse(formatSummary("preflight", "passed"));
  assert.deepEqual(Object.keys(summary), ["stage", "status"]);
  assert.deepEqual(summary, { stage: "preflight", status: "passed" });
});

test("step order prevents Home input before auth and payment before all guards", () => {
  const beforeAuth = createStepOrder();
  beforeAuth.advance("preflight");
  beforeAuth.advance("launched");
  assert.throws(() => beforeAuth.advance("home-input"), (error) => error.code === "step-order");

  const beforeGuard = createStepOrder();
  for (const step of ["preflight", "launched", "authenticated", "home-input", "iframe", "coinbase-input"]) {
    beforeGuard.advance(step);
  }
  assert.throws(() => beforeGuard.advance("payment"), (error) => error.code === "step-order");
  beforeGuard.advance("payment-guard");
  beforeGuard.advance("payment");
});

test("orchestrator pre-closes and cleans up only the named session when launch fails", async () => {
  const calls = [];
  const processRunner = async (_binary, args, options) => {
    calls.push({ args, environment: options.environment });
    if (args[0] === "--version") return { code: 0, stdout: "agent-browser 0.21.4", stderr: "" };
    if (args.includes("open")) throw new HarnessError("home-flow", "person@sandbox.test at 203.0.113.42");
    return { code: 0, stdout: "", stderr: "" };
  };
  let output = "";
  const status = await runAgentBrowserHarness({
    environment: {
      COINBASE_ONRAMP_AGENT_BROWSER_LIVE: "1",
      PATH: process.env.PATH,
      AGENT_BROWSER_PROFILE: "/must/not/pass",
    },
    output: { write(chunk) { output += chunk; } },
    processRunner,
    registerSignals: false,
  });

  assert.equal(status, 1);
  const sessionCalls = calls.filter((call) => call.args.includes("--session"));
  assert.equal(sessionCalls.filter((call) => call.args.includes("close")).length, 2);
  assert.equal(sessionCalls.filter((call) => call.args.includes("open")).length, 1);
  assert.ok(sessionCalls.every((call) => call.args.includes("home-coinbase-onramp-sandbox")));
  assert.ok(calls.every((call) => !("AGENT_BROWSER_PROFILE" in call.environment)));
  assert.equal(output.includes("person@sandbox.test"), false);
  assert.equal(output.includes("203.0.113.42"), false);
  for (const line of output.trim().split("\n")) assert.deepEqual(Object.keys(JSON.parse(line)), ["stage", "status"]);
});

test("orchestrator classifies a bounded quote badge wait failure as payment-guard", async () => {
  const calls = [];
  const processRunner = async (_binary, args, options) => {
    calls.push({ args, options });
    if (args[0] === "--version") return { code: 0, stdout: "agent-browser 0.21.4", stderr: "" };
    if (args.includes("url")) return { code: 0, stdout: "http://localhost:3000/home", stderr: "" };
    if (args.includes("visible")) return { code: 0, stdout: "true", stderr: "" };
    if (args.includes("wait") && args.includes("text=Sandbox — not a real deposit")) {
      return { code: 1, stdout: "", stderr: "synthetic timeout" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  let output = "";
  const status = await runAgentBrowserHarness({
    environment: { COINBASE_ONRAMP_AGENT_BROWSER_LIVE: "1", PATH: process.env.PATH },
    output: { write(chunk) { output += chunk; } },
    processRunner,
    registerSignals: false,
  });

  assert.equal(status, 1);
  const summaries = output.trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(summaries.some(({ stage, status: stageStatus }) => stage === "payment-guard" && stageStatus === "failed"));
  assert.ok(!summaries.some(({ stage }) => stage === "home-flow"));
  assert.ok(calls.some(({ args, options }) => args.includes("text=Review quote") && options.allowFailure === true));
  assert.ok(!calls.some(({ args }) => args.includes("Confirm deposit")));
});

test("orchestrator happy path reaches /home, applies every guard, and cleans up in stage order", async () => {
  const processCalls = [];
  const clickStates = [];
  let socketState = "phone";
  let confirmationReadsRemaining = 0;
  const screenText = {
    phone: "Enter your phone number",
    email: "Enter your email",
    otp: "Enter 6-digit verification code",
    identity: "Verify identity Date of birth Social security last four",
    review: "Review order Apple Pay Sandbox No real funds will be used",
    confirm: "Confirm sandbox purchase Apple Pay Sandbox No real funds will be used",
    completed: "Sandbox confirmation complete",
  };
  const nextState = {
    phone: "email",
    email: "otp",
    otp: "identity",
    identity: "review",
    review: "confirm",
    confirm: "completed",
  };

  class HappySocket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(payload) {
      const command = JSON.parse(payload);
      let result = {};
      if (command.method === "Runtime.evaluate") {
        const expression = command.params.expression;
        let value;
        if (expression.includes("const labels =")) {
          clickStates.push(socketState);
          if (socketState === "review") {
            confirmationReadsRemaining = 3;
          } else {
            socketState = nextState[socketState];
          }
          value = true;
        } else if (expression.includes("const value =")) {
          value = true;
        } else {
          value = screenText[socketState];
          if (socketState === "review" && confirmationReadsRemaining > 0) {
            confirmationReadsRemaining -= 1;
            if (confirmationReadsRemaining === 0) socketState = "confirm";
          }
        }
        result = { result: { value } };
      }
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ id: command.id, result }),
      })));
    }
    close() { this.dispatchEvent(new Event("close")); }
  }

  const processRunner = async (_binary, args, options) => {
    processCalls.push({ args, options });
    if (args[0] === "--version") return { code: 0, stdout: "agent-browser 0.21.4", stderr: "" };
    if (args.includes("cdp-url")) {
      return { code: 0, stdout: "ws://127.0.0.1:9222/devtools/browser/synthetic", stderr: "" };
    }
    if (args.includes("url")) return { code: 0, stdout: "http://localhost:3000/home", stderr: "" };
    if (args.includes("visible")) return { code: 0, stdout: "true", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return { ok: true, async json() { return [VALID_TARGET]; } };
  };
  let output = "";
  const status = await runAgentBrowserHarness({
    environment: {
      COINBASE_ONRAMP_AGENT_BROWSER_LIVE: "1",
      PATH: process.env.PATH,
    },
    output: { write(chunk) { output += chunk; } },
    processRunner,
    fetchImpl,
    WebSocketImpl: HappySocket,
    registerSignals: false,
  });

  assert.equal(status, 0);
  assert.equal(socketState, "completed");
  assert.deepEqual(clickStates, ["phone", "email", "otp", "identity", "review", "confirm"]);
  assert.deepEqual(fetchCalls, ["http://127.0.0.1:9222/json/list"]);

  const sessionCalls = processCalls.filter(({ args }) => args.includes("--session"));
  assert.equal(sessionCalls.filter(({ args }) => args.includes("close")).length, 2);
  assert.equal(sessionCalls.filter(({ args }) => args.includes("wait") && args.includes("text=Sandbox — not a real deposit")).length, 2);
  for (const name of ["Add money", "5"]) {
    const call = sessionCalls.find(({ args }) => args.includes("--name") && args.includes(name));
    assert.ok(call);
    assert.ok(call.args.includes("--exact"));
  }
  const depositCall = sessionCalls.find(({ args }) => args.includes("--name") && args.includes("Deposit USD"));
  assert.ok(depositCall);
  assert.ok(!depositCall.args.includes("--exact"));
  assert.ok(sessionCalls.filter(({ args }) => args.includes("url")).length >= 3);

  const summaries = output.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(summaries.map(({ stage }) => stage), [
    "preflight",
    "home-auth-checkpoint",
    "home-auth-checkpoint",
    "home-sandbox-order",
    "coinbase-sandbox-iframe",
    "coinbase-sandbox-details",
    "sandbox-payment-guard",
    "sandbox-payment",
    "home-sandbox-terminal",
    "cleanup-named-session",
  ]);
  assert.deepEqual(summaries.map(({ status: stageStatus }) => stageStatus), [
    "passed",
    "waiting-for-human",
    "passed",
    "passed",
    "passed",
    "passed",
    "passed",
    "confirmed-fake-only",
    "passed",
    "passed",
  ]);
});

test("CDP helper assigns bounded IDs and resolves commands in send order", async () => {
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

  const client = new CdpClient("ws://127.0.0.1:9222/devtools/page/synthetic", {
    WebSocketImpl: FakeSocket,
    commandTimeoutMs: 100,
  });
  const [evaluation, documentResult] = await Promise.all([
    client.evaluate("document.body.innerText"),
    client.command("DOM.getDocument"),
  ]);
  assert.equal(evaluation, "Runtime.evaluate");
  assert.deepEqual(documentResult, { result: { value: "DOM.getDocument" } });
  assert.deepEqual(FakeSocket.instance.sent.map(({ id, method }) => ({ id, method })), [
    { id: 1, method: "Runtime.evaluate" },
    { id: 2, method: "DOM.getDocument" },
  ]);
  client.close();
});
