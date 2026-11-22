import { createRequire } from "node:module";
import { MessageChannel, Worker, isMainThread, receiveMessageOnPort, workerData } from "node:worker_threads";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const picomatch = createRequire(requireWeb.resolve("knip"))("picomatch");
const knipMatchers = new Map();
const outputLimit = 32 * 1024 * 1024;

export const knipGlobBudgetMs = 5000;

// A pattern Picomatch cannot interpret either fails its debug compile or is
// emitted as the escaped literal spelling of the extglob text it refused.
function escapedLiteral(token) {
  return token.value.replace(/([-*+?.^${}(|)[\]])/g, "\\$1");
}

function compileKnipGlob(pattern) {
  const matcher = picomatch(pattern, { dot: true });
  let degradation = null;
  try {
    picomatch(pattern, { dot: true, debug: true });
  } catch (error) {
    degradation = `cannot be compiled: ${error.message}`;
  }
  const state = picomatch.parse(pattern, { dot: true });
  if (state.tokens.some((token) => token.type === "text" && /[@?*+!]\(/.test(token.value) && [escapedLiteral(token), `(?=.)${escapedLiteral(token)}`].includes(token.output ?? ""))) {
    degradation = "cannot be interpreted: Picomatch literalized an extglob";
  }
  for (const token of state.tokens) {
    if (token.type !== "brace" || !token.value.startsWith("}")) continue;
    const endpoints = [];
    let separators = 0;
    for (let previous = token.prev; previous && previous.type !== "brace"; previous = previous.prev) {
      if (previous.type === "dots") separators++;
      else endpoints.unshift(previous.value);
    }
    if (separators && (separators !== 1 || endpoints.length !== 2 || endpoints.some((endpoint) => endpoint.length !== 1))) {
      degradation = "cannot be interpreted: brace ranges require single-character endpoints and no step";
    }
  }
  return { matcher: degradation ? (file) => file === pattern : matcher, degradation };
}

export function knipGlob(file, pattern) {
  if (!knipMatchers.has(pattern)) {
    try {
      knipMatchers.set(pattern, compileKnipGlob(pattern));
    } catch (error) {
      throw new Error(`knip.json: pattern ${JSON.stringify(pattern)} cannot be compiled: ${error.message}`);
    }
  }
  const { matcher, degradation } = knipMatchers.get(pattern);
  const matched = matcher(file);
  if (!matched && degradation) throw new Error(`knip.json: pattern ${JSON.stringify(pattern)} ${degradation}`);
  return matched;
}

export function evaluateKnipGlobs(patterns, files, { budgetMs = knipGlobBudgetMs } = {}) {
  const matches = new Map();
  const failures = new Map();
  const requested = [...new Set(patterns)];
  const result = evaluateInWorker({ patterns: requested, files }, budgetMs);
  // A terminated worker may have written only part of its final result.
  const output = result.stdout ?? "";
  const lines = output.split("\n");
  const trailing = lines.pop() ?? "";
  const patternSet = new Set(requested);
  const candidateSet = new Set(files);
  const seen = new Set();
  let protocol = null;
  for (const line of lines) {
    if (line === "") continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      protocol = "the child wrote an unparsable result";
      break;
    }
    if (item === null || typeof item !== "object" || typeof item.pattern !== "string" || !patternSet.has(item.pattern) || seen.has(item.pattern)) {
      protocol = "the child wrote an unexpected result";
      break;
    }
    seen.add(item.pattern);
    if (typeof item.error === "string") failures.set(item.pattern, item.degradation ? `cannot be interpreted: ${item.error}` : `cannot be compiled: ${item.error}`);
    else if (Array.isArray(item.matches) && item.matches.every((file) => candidateSet.has(file))) matches.set(item.pattern, new Set(item.matches));
    else {
      protocol = "the child reported a path it was not given";
      break;
    }
  }
  const missing = requested.filter((pattern) => !matches.has(pattern) && !failures.has(pattern));
  const timedOut = result.error?.code === "ETIMEDOUT";
  const message = (result.stderr ?? "").split(/\r?\n/).find((line) => line.trim())?.trim()
    || result.error?.message || (result.signal ? `signal ${result.signal}` : `exit code ${result.status}`);
  for (const [index, pattern] of missing.entries()) {
    failures.set(pattern, timedOut
      ? index === 0 ? `exceeded the ${budgetMs} ms pattern evaluation budget` : "was not evaluated because the pattern evaluation budget was exhausted"
      : `could not be evaluated: ${message}`);
  }
  const error = protocol ?? (timedOut ? null
    : result.error || result.status !== 0 ? message
    : trailing !== "" ? "the child wrote an incomplete result" : null);
  return { matches, failures, error };
}

function evaluateInWorker(input, budgetMs) {
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL(import.meta.url), { workerData: { knipGlob: { input, port: port2, signal: signal.buffer } }, transferList: [port2], stdout: true, stderr: true });
  worker.on("error", () => {});
  worker.unref();
  const deadline = performance.now() + budgetMs;
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let error = null;
  let state = 0;
  for (;;) {
    const posted = Atomics.load(signal, 0);
    for (let message = receiveMessageOnPort(port1); message && !error; message = receiveMessageOnPort(port1)) {
      if (typeof message.message.stderr === "string") stderr += message.message.stderr;
      else {
        bytes += Buffer.byteLength(message.message.stdout);
        if (bytes > outputLimit) error = Object.assign(new Error("pattern evaluation output exceeded its buffer (ENOBUFS)"), { code: "ENOBUFS" });
        else stdout += message.message.stdout;
      }
    }
    state = Atomics.load(signal, 1);
    if (error || (state && posted === Atomics.load(signal, 0))) break;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      error = Object.assign(new Error("pattern evaluation timed out (ETIMEDOUT)"), { code: "ETIMEDOUT" });
      break;
    }
    Atomics.wait(signal, 0, posted, remaining);
  }
  if (error || state !== 1) void worker.terminate();
  port1.close();
  return { stdout, stderr, error, status: error ? null : state === 1 ? 0 : 1, signal: error ? "SIGKILL" : null };
}

if (!isMainThread && workerData?.knipGlob) {
  const { input: { patterns, files }, port, signal: buffer } = workerData.knipGlob;
  const signal = new Int32Array(buffer);
  const post = (message) => {
    port.postMessage(message);
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0);
  };
  let state = 1;
  try {
    for (const pattern of patterns) {
      let result;
      try {
        const { matcher, degradation } = compileKnipGlob(pattern);
        const matched = files.filter((file) => matcher(file));
        result = degradation && !matched.length
          ? { pattern, error: degradation.replace(/^cannot be (?:compiled|interpreted): /, ""), degradation: degradation.startsWith("cannot be interpreted:") }
          : { pattern, matches: matched };
      } catch (error) {
        result = { pattern, error: error.message };
      }
      post({ stdout: JSON.stringify(result) + "\n" });
    }
  } catch (error) {
    state = 2;
    post({ stderr: `${error?.stack ?? error}\n` });
  }
  Atomics.store(signal, 1, state);
  Atomics.add(signal, 0, 1);
  Atomics.notify(signal, 0);
}
