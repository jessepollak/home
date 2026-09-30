import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { evaluateKnipGlobs, knipGlobBudgetMs } from "./knip-glob.mjs";
import { explorationOnlyPaths, importGraph, nonProduction, readWebSources, ts, webRoot } from "./knip-source.mjs";

const allowedKeys = new Set(["$schema", "ignoreExportsUsedInFile", "vitest", "entry", "ignore"]);
const baselineKinds = new Set(["exploration-only", "test-support", "cli-entry", "structural-contract"]);
const configNames = /^(?:knip(?:\.config)?\.[cm]?[jt]sx?|knip\.jsonc?|\.knip\.jsonc?)$/;

export function evaluateKnipExemptions({ config, baseline, files, packageJson = {}, configPaths = [], budgetMs = knipGlobBudgetMs }) {
  const parsed = typeof config === "string" ? ts.parseConfigFileTextToJson("knip.json", config) : { config };
  const invalid = [];
  if (parsed.error || !parsed.config || typeof parsed.config !== "object" || Array.isArray(parsed.config)) invalid.push("knip.json: invalid JSONC");
  const settings = parsed.config ?? {};
  const unknownKeys = Object.keys(settings).filter((key) => !allowedKeys.has(key)).sort();
  const extraConfigs = configPaths.filter((file) => configNames.test(path.posix.basename(file)) && file !== "knip.json").sort();
  if (Object.hasOwn(packageJson, "knip")) extraConfigs.push("package.json#knip");
  const entryPatterns = Array.isArray(settings.entry) ? settings.entry.filter((entry) => typeof entry === "string" && entry.endsWith("!")) : [];
  const entryNegations = entryPatterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1, -1));
  const entryExemptions = entryPatterns.filter((pattern) => !pattern.startsWith("!"));
  const ignorePatterns = Array.isArray(settings.ignore) ? settings.ignore : [];
  const ignoreNegations = ignorePatterns.filter((pattern) => typeof pattern === "string" && pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  if (ignorePatterns.length && ignoreNegations.length === ignorePatterns.length) invalid.push("knip.json: ignore with only negated patterns is unsupported");
  if (![settings.entry, settings.ignore].every((items) => Array.isArray(items) && items.every((item) => typeof item === "string" && item.trim()))) invalid.push("knip.json: entry/ignore must be string arrays");
  if (!Array.isArray(baseline)) invalid.push("baseline: expected array");
  const entries = Array.isArray(baseline) ? baseline : [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.pattern !== "string" || !entry.pattern.trim() || typeof entry.reason !== "string" || !entry.reason.trim() || !baselineKinds.has(entry.kind) || seen.has(entry.pattern)) {
      invalid.push(entry?.pattern ?? "baseline: invalid entry");
    }
    if (typeof entry?.pattern === "string") seen.add(entry.pattern);
  }
  const effectiveGlobs = new Set([
    ...entryExemptions.map((pattern) => pattern.slice(0, -1)),
    ...entryNegations,
    ...ignorePatterns.filter((pattern) => typeof pattern === "string" && !pattern.startsWith("!")).map((pattern) => pattern.replace(/!$/, "")),
    ...ignoreNegations,
  ]);
  const refused = new Set();
  const { imports, importers } = importGraph(files);
  const explorationOnly = explorationOnlyPaths(files, importers);
  const candidatePaths = files.filter((file) => explorationOnly.has(file.path)).map((file) => file.path);
  const { matches, failures, error } = evaluateKnipGlobs([...effectiveGlobs], candidatePaths, { budgetMs });
  if (error) invalid.push(`knip.json: pattern evaluation failed: ${error}`);
  for (const [glob, reason] of failures) {
    refused.add(glob);
    invalid.push(`knip.json: pattern ${JSON.stringify(glob)} ${reason}`);
  }
  const safeEntryNegations = entryNegations.filter((pattern) => !refused.has(pattern));
  const safeIgnoreNegations = ignoreNegations.filter((pattern) => !refused.has(pattern));
  const flagged = new Map();
  function collectMatches(pattern, negations) {
    const glob = pattern.replace(/!$/, "");
    const collected = [];
    for (const file of matches.get(glob) ?? []) {
      if (negations.some((negative) => matches.get(negative)?.has(file))) continue;
      const users = [...(importers.get(file) ?? [])].sort();
      collected.push({ path: file, importers: users });
    }
    collected.sort((a, b) => a.path.localeCompare(b.path));
    return collected;
  }
  for (const pattern of entryExemptions) {
    if (refused.has(pattern.slice(0, -1))) continue;
    const matches = collectMatches(pattern, safeEntryNegations);
    if (matches.length) flagged.set(pattern, matches);
  }
  for (const pattern of ignorePatterns) {
    if (typeof pattern !== "string" || pattern.startsWith("!") || refused.has(pattern.replace(/!$/, ""))) continue;
    const matches = collectMatches(pattern, safeIgnoreNegations);
    if (matches.length) flagged.set(pattern, matches);
  }
  // A non-exploration baseline entry is stale once its pattern leaves knip.json or
  // matches no source file, and that question covers production files the
  // exploration-only candidates above never see. Evaluate just those patterns
  // against every source path, in a second budgeted child run of its own.
  const stalenessGlobs = new Set();
  for (const entry of entries) {
    if (typeof entry?.pattern !== "string" || entry.kind === "exploration-only") continue;
    if (entryExemptions.includes(entry.pattern)) {
      stalenessGlobs.add(entry.pattern.replace(/!$/, ""));
      for (const negation of safeEntryNegations) stalenessGlobs.add(negation);
    }
    if (ignorePatterns.includes(entry.pattern) && !entry.pattern.startsWith("!")) {
      stalenessGlobs.add(entry.pattern.replace(/!$/, ""));
      for (const negation of safeIgnoreNegations) stalenessGlobs.add(negation);
    }
  }
  const sourceMatches = stalenessGlobs.size
    ? evaluateKnipGlobs([...stalenessGlobs], files.map((file) => file.path), { budgetMs })
    : { matches: new Map(), failures: new Map(), error: null };
  if (sourceMatches.error) invalid.push(`knip.json: pattern evaluation failed: ${sourceMatches.error}`);
  for (const [glob, reason] of sourceMatches.failures) {
    if (refused.has(glob)) continue;
    refused.add(glob);
    invalid.push(`knip.json: pattern ${JSON.stringify(glob)} ${reason}`);
  }
  function baselineMatches(entry) {
    if (entry?.kind === "exploration-only") return flagged.has(entry?.pattern);
    if (typeof entry?.pattern !== "string") return false;
    const glob = entry.pattern.replace(/!$/, "");
    const negations = [];
    if (entryExemptions.includes(entry.pattern)) negations.push(safeEntryNegations);
    if (ignorePatterns.includes(entry.pattern) && !entry.pattern.startsWith("!")) negations.push(safeIgnoreNegations);
    return negations.some((list) => [...(sourceMatches.matches.get(glob) ?? [])].some((file) => !list.some((negative) => sourceMatches.matches.get(negative)?.has(file))));
  }
  const production = new Set(files.map((file) => file.path).filter((file) => !nonProduction(file)));
  const exempt = new Set([...flagged.values()].flatMap((matches) => matches.map((match) => match.path)));
  const hidden = [];
  const reported = new Set();
  const rootsToWalk = entries.filter((entry) => entry?.kind === "exploration-only" && typeof entry.pattern === "string").sort((a, b) => a.pattern.localeCompare(b.pattern));
  for (const entry of rootsToWalk) {
    const queue = (flagged.get(entry.pattern) ?? []).map((match) => match.path);
    const parents = new Map(queue.map((root) => [root, null]));
    for (let index = 0; index < queue.length; index += 1) {
      const file = queue[index];
      if (parents.get(file) !== null && explorationOnly.has(file) && !exempt.has(file) && !reported.has(file)) {
        const chain = [];
        for (let current = file; current !== null; current = parents.get(current)) chain.push(current);
        hidden.push({ pattern: entry.pattern, path: file, chain: chain.reverse() });
        reported.add(file);
      }
      for (const target of [...(imports.get(file) ?? [])].sort()) {
        if (!production.has(target) || parents.has(target)) continue;
        parents.set(target, file);
        queue.push(target);
      }
    }
  }
  hidden.sort((a, b) => a.pattern.localeCompare(b.pattern) || a.path.localeCompare(b.path));
  return {
    unlisted: [...flagged].filter(([pattern]) => !seen.has(pattern)).map(([pattern, matches]) => ({ pattern, matches })).sort((a, b) => a.pattern.localeCompare(b.pattern)),
    stale: entries.filter((entry) => !baselineMatches(entry)).map((entry) => entry?.pattern ?? "baseline: invalid entry").sort(),
    invalid: invalid.sort(), unknownKeys, extraConfigs: extraConfigs.sort(), hidden,
  };
}

export function readKnipExemptionInput() {
  const configPaths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: path.join(webRoot, "../..") })
    .toString().split("\0").filter(Boolean).map((file) => file.slice("apps/web/".length)).filter((file) => existsSync(path.join(webRoot, file)));
  return {
    config: readFileSync(path.join(webRoot, "knip.json"), "utf8"),
    baseline: JSON.parse(readFileSync(new URL("./knip-exemptions-baseline.json", import.meta.url), "utf8")),
    packageJson: JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")),
    configPaths,
    files: readWebSources(),
  };
}
