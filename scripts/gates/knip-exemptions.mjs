import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { evaluateKnipGlobs, knipGlobBudgetMs } from "./knip-glob.mjs";
import { explorationOnlyPaths, importGraph, readWebSources, ts, webRoot } from "./knip-source.mjs";

const allowedKeys = new Set(["$schema", "ignoreExportsUsedInFile", "vitest", "entry", "ignore"]);
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
    if (!entry || typeof entry.pattern !== "string" || !entry.pattern.trim() || typeof entry.reason !== "string" || !entry.reason.trim() || seen.has(entry.pattern)) {
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
  const { importers } = importGraph(files);
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
  return {
    unlisted: [...flagged].filter(([pattern]) => !seen.has(pattern)).map(([pattern, matches]) => ({ pattern, matches })).sort((a, b) => a.pattern.localeCompare(b.pattern)),
    stale: entries.filter((entry) => !flagged.has(entry?.pattern)).map((entry) => entry?.pattern ?? "baseline: invalid entry").sort(),
    invalid: invalid.sort(), unknownKeys, extraConfigs: extraConfigs.sort(),
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
