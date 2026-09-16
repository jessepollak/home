const MINIMUM_AGENT_BROWSER_VERSION = "0.21.0";
const COINBASE_ORIGIN = "https://pay.coinbase.com";
const COINBASE_PATH = "/v3/api-onramp/embedded-order";
const FORBIDDEN_AGENT_BROWSER_FLAGS = new Set([
  "--profile",
  "--state",
  "--session-name",
  "--auto-connect",
]);
const FORBIDDEN_AGENT_BROWSER_COMMANDS = new Set(["screenshot", "snapshot"]);

export class HarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
  }
}

export function assertLocalOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HarnessError("origin", "Home origin is invalid");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "localhost" ||
    !url.port ||
    Number(url.port) < 1 ||
    Number(url.port) > 65535 ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new HarnessError("origin", "Home origin must be an exact http://localhost:<port> origin");
  }
  return url.origin;
}

export function assertSessionName(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(value)) {
    throw new HarnessError("session", "Harness session name is invalid");
  }
  return value;
}

export function assertNodeVersion(version) {
  const major = Number.parseInt(String(version).split(".", 1)[0], 10);
  if (!Number.isInteger(major) || major < 22) {
    throw new HarnessError("node-version", "Node 22 or newer is required");
  }
  return major;
}

export function parseAgentBrowserVersion(output) {
  const match = String(output).match(/(?:agent-browser\s+)?v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) throw new HarnessError("binary", "agent-browser returned an unrecognized version");
  return match.slice(1).map(Number);
}

export function assertAgentBrowserVersion(output, minimum = MINIMUM_AGENT_BROWSER_VERSION) {
  const actual = parseAgentBrowserVersion(output);
  const required = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > required[index]) return actual.join(".");
    if (actual[index] < required[index]) {
      throw new HarnessError("version", `agent-browser ${minimum} or newer is required`);
    }
  }
  return actual.join(".");
}

export function createAgentBrowserEnvironment(environment = {}) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.startsWith("AGENT_BROWSER_")),
  );
}

export function validateAgentBrowserArgv(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw new HarnessError("argv", "agent-browser arguments must be strings");
  }
  for (const argument of argv) {
    const flag = argument.split("=", 1)[0];
    if (FORBIDDEN_AGENT_BROWSER_FLAGS.has(flag)) {
      throw new HarnessError("argv", `agent-browser flag ${flag} is forbidden`);
    }
  }
  const forbiddenCommand = argv.find((argument) => FORBIDDEN_AGENT_BROWSER_COMMANDS.has(argument));
  if (forbiddenCommand) {
    throw new HarnessError("argv", `agent-browser command ${forbiddenCommand} is forbidden`);
  }
  return argv;
}

export function buildAgentBrowserArgv({ session, configPath, command, headed = false }) {
  assertSessionName(session);
  if (!configPath || typeof configPath !== "string") {
    throw new HarnessError("argv", "An isolated agent-browser config is required");
  }
  validateAgentBrowserArgv(command);
  const argv = ["--config", configPath, "--session", session];
  if (headed) argv.push("--headed");
  argv.push(...command);
  return validateAgentBrowserArgv(argv);
}

export function assertLoopbackCdpUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new HarnessError("cdp", "agent-browser did not return a valid CDP URL");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (!loopback || !["http:", "https:", "ws:", "wss:"].includes(url.protocol) || !url.port || url.username || url.password) {
    throw new HarnessError("cdp", "agent-browser CDP endpoint is not loopback");
  }
  const protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${url.host}`;
}

export function inspectCoinbaseTarget(target) {
  if (!target || target.type !== "iframe" || typeof target.url !== "string") return false;
  let url;
  try {
    url = new URL(target.url);
  } catch {
    return false;
  }
  return (
    url.origin === COINBASE_ORIGIN &&
    url.pathname === COINBASE_PATH &&
    url.searchParams.get("useApplePaySandbox") === "true" &&
    typeof target.webSocketDebuggerUrl === "string" &&
    /^wss?:\/\//.test(target.webSocketDebuggerUrl)
  );
}

export function selectCoinbaseTarget(targets) {
  if (!Array.isArray(targets)) throw new HarnessError("iframe-zero", "CDP target list is invalid");
  const matching = targets.filter(inspectCoinbaseTarget);
  if (matching.length === 0) throw new HarnessError("iframe-zero", "Coinbase sandbox iframe target was not found");
  if (matching.length > 1) throw new HarnessError("iframe-multiple", "Multiple Coinbase sandbox iframe targets were found");
  return matching[0];
}

export function assertPaymentGuards(guards) {
  const required = [
    "localOrigin",
    "homeSandboxBadge",
    "iframeSandboxQuery",
    "applePaySandboxText",
    "noRealFundsText",
  ];
  const missing = required.filter((guard) => guards?.[guard] !== true);
  if (missing.length > 0) throw new HarnessError("payment-guard", "Sandbox payment guard is incomplete");
  return true;
}

export function redactSensitive(value, maximumLength = 1200) {
  let output = String(value ?? "").slice(0, maximumLength);
  output = output
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, "[redacted-address]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/(?:\+?\d[\s().-]*){10,}/g, "[redacted-phone]")
    .replace(/https:\/\/pay\.coinbase\.com\/[^\s"')>]*/gi, "[redacted-payment-url]")
    .replace(/\b(session(?:Token)|userAuth(?:Token))=?[^\s&"']*/gi, "$1=[redacted-token]")
    .replace(/wss?:\/\/[^\s"')>]+/gi, "[redacted-websocket-url]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]");
  return output;
}

export function formatSummary(stage, status) {
  return JSON.stringify({ stage, status });
}

export function createStepOrder() {
  const steps = [
    "preflight",
    "launched",
    "authenticated",
    "home-input",
    "iframe",
    "coinbase-input",
    "payment-guard",
    "payment",
    "complete",
  ];
  let index = -1;
  return {
    advance(step) {
      const next = steps.indexOf(step);
      if (next !== index + 1) throw new HarnessError("step-order", "Harness step order was violated");
      index = next;
    },
    current() {
      return steps[index] ?? null;
    },
  };
}

export async function pollForCoinbaseTarget(fetchTargets, { timeoutMs = 30_000, intervalMs = 500, sleep = defaultSleep } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastCardinality = 0;
  while (Date.now() < deadline) {
    const targets = await fetchTargets();
    const matching = Array.isArray(targets) ? targets.filter(inspectCoinbaseTarget) : [];
    lastCardinality = matching.length;
    if (matching.length === 1) return matching[0];
    if (matching.length > 1) throw new HarnessError("iframe-multiple", "Multiple Coinbase sandbox iframe targets were found");
    await sleep(intervalMs);
  }
  throw new HarnessError(lastCardinality > 1 ? "iframe-multiple" : "iframe-zero", "Coinbase sandbox iframe target timed out");
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class CdpClient {
  constructor(webSocketUrl, { WebSocketImpl = globalThis.WebSocket, commandTimeoutMs = 10_000 } = {}) {
    if (typeof WebSocketImpl !== "function") throw new HarnessError("cdp", "Node WebSocket support is unavailable");
    this.socket = new WebSocketImpl(webSocketUrl);
    this.commandTimeoutMs = commandTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HarnessError("cdp", "CDP connection timed out")), commandTimeoutMs);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new HarnessError("cdp", "CDP connection failed"));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.#onMessage(event.data));
    this.socket.addEventListener("close", () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new HarnessError("cdp", "CDP connection closed"));
      }
      this.pending.clear();
    });
  }

  #onMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!Number.isInteger(message.id)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new HarnessError("coinbase-screen", "CDP command failed"));
    else pending.resolve(message.result);
  }

  async command(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    if (id > 10_000) throw new HarnessError("cdp", "CDP command limit exceeded");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HarnessError("cdp", "CDP command timed out"));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result?.exceptionDetails) throw new HarnessError("coinbase-screen", "Coinbase page evaluation failed");
    return result?.result?.value;
  }

  close() {
    this.socket.close();
  }
}

export const constants = Object.freeze({
  minimumAgentBrowserVersion: MINIMUM_AGENT_BROWSER_VERSION,
  coinbaseOrigin: COINBASE_ORIGIN,
  coinbasePath: COINBASE_PATH,
});
