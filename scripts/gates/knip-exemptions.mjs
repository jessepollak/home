import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { explorationOnlyPaths, importGraph, knipGlob, readWebSources, ts, webRoot } from "./knip-source.mjs";

const allowedKeys = new Set(["$schema", "ignoreExportsUsedInFile", "vitest", "entry", "ignore"]);
const configNames = /^(?:knip(?:\.config)?\.[cm]?[jt]sx?|knip\.jsonc?|\.knip\.jsonc?)$/;

export function evaluateKnipExemptions({ config, baseline, files, packageJson = {}, configPaths = [] }) {
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
  const { importers } = importGraph(files);
  const explorationOnly = explorationOnlyPaths(files, importers);
  const flagged = new Map();
  function collectMatches(pattern, negations) {
    const glob = pattern.replace(/!$/, "");
    const matches = [];
    for (const file of files) {
      if (!explorationOnly.has(file.path) || !knipGlob(file.path, glob)) continue;
      if (negations.some((negative) => knipGlob(file.path, negative))) continue;
      const users = [...(importers.get(file.path) ?? [])].sort();
      matches.push({ path: file.path, importers: users });
    }
    matches.sort((a, b) => a.path.localeCompare(b.path));
    return matches;
  }
  for (const pattern of entryExemptions) {
    if (typeof pattern !== "string") continue;
    const matches = collectMatches(pattern, entryNegations);
    if (matches.length) flagged.set(pattern, matches);
  }
  for (const pattern of ignorePatterns) {
    if (typeof pattern !== "string" || pattern.startsWith("!")) continue;
    const matches = collectMatches(pattern, ignoreNegations);
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
