import { spawnSync } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const picomatch = createRequire(requireWeb.resolve("knip"))("picomatch");
const knipMatchers = new Map();
const modulePath = fileURLToPath(import.meta.url);

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
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ patterns: requested, files }), timeout: budgetMs, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  // A killed child may have written only part of its final result.
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

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const { patterns, files } = JSON.parse(readFileSync(0, "utf8"));
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
    writeSync(1, JSON.stringify(result) + "\n");
  }
}
