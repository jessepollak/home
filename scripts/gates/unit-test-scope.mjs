import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { matchesGlob, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { trackedFiles } from "./unit-test-shards.mjs";

export const MANIFEST_PATH = "scripts/gates/unit-test-scope.json";
export const CATEGORY_IDS = ["money-math", "transaction-construction", "auth", "action-lifecycle", "route-contract-parser", "money-path-provider-failure", "money-record-integrity", "repository-gate", "review-board-runtime"];
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const oneLine = (value) => typeof value === "string" && value.trim().length > 0 && !/[\r\n]/.test(value);
const literal = (value) => /^[A-Za-z0-9_-]+$/.test(value);
const relativePath = (value) => typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");

export function validScope(pattern, category) {
  if (!relativePath(pattern)) return false;
  const parts = pattern.split("/");
  if (category === "route-contract-parser" && /^shared\/\*\*\/contract[^/]*\.test\.ts$/.test(pattern)) return true;
  if (parts.length === 1) return !/[*!?{}[\]()]/.test(pattern);
  if (!parts.slice(0, -1).every(literal)) {
    return !["client", "components"].includes(parts[0]) && parts.length >= 3
      && parts.slice(0, -1).filter((part) => part !== "**").every(literal)
      && parts.slice(0, 2).every(literal);
  }
  if (parts.length === 2 && /[*!?{}[\]()]/.test(parts.at(-1))) return false;
  return !["client", "components"].includes(parts[0]) || !parts.at(-1).includes("**");
}

export function evaluateUnitTestScope({ files, manifest, reference = null }) {
  const findings = [];
  const categories = manifest?.categories;
  if (!categories || typeof categories !== "object" || Array.isArray(categories)) findings.push("categories must be an object");
  else {
    for (const id of Object.keys(categories)) if (!CATEGORY_IDS.includes(id)) findings.push(`Unknown category id: ${id}`);
    for (const id of CATEGORY_IDS) if (!Object.hasOwn(categories, id) || !oneLine(categories[id])) findings.push(`Category ${id} needs a one-line policy description`);
  }
  if (!Array.isArray(manifest?.scopes)) findings.push("scopes must be an array");
  if (!Array.isArray(manifest?.grandfathered)) findings.push("grandfathered must be an array");
  const classified = new Map();
  const patterns = new Set();
  for (const entry of Array.isArray(manifest?.scopes) ? manifest.scopes : []) {
    const { pattern, category } = entry ?? {};
    if (!CATEGORY_IDS.includes(category)) findings.push(`Unknown category id: ${category} for scope ${pattern}`);
    if (!validScope(pattern, category)) {
      findings.push(`Invalid scope ${pattern}: name one feature directory; client/components scopes need an individual file or filename glob in one directory`);
      continue;
    }
    if (patterns.has(pattern)) findings.push(`Duplicate scope pattern: ${pattern}`);
    patterns.add(pattern);
    const matched = files.filter((file) => matchesGlob(file, pattern));
    if (!matched.length) findings.push(`Scope ${pattern} matches zero unit test files`);
    for (const file of matched) {
      if (classified.has(file)) findings.push(`Duplicate scope classification: ${file}`);
      classified.set(file, category);
    }
  }
  const grandfathered = new Set();
  for (const entry of Array.isArray(manifest?.grandfathered) ? manifest.grandfathered : []) {
    const { path, reason } = entry ?? {};
    if (!relativePath(path) || /[*!?{}[\]()]/.test(path) || !oneLine(reason)) {
      findings.push(`Invalid grandfathered entry: ${path}; a literal path and short reason are required`);
      continue;
    }
    if (grandfathered.has(path)) findings.push(`Duplicate grandfathered path: ${path}`);
    grandfathered.add(path);
    if (!files.includes(path)) findings.push(`Stale grandfathered path: ${path}; remove it because the unit test no longer exists`);
    if (classified.has(path)) findings.push(`Stale grandfathered path: ${path}; remove it because it now matches a scope`);
    if (reference && !reference.includes(path)) findings.push(`New grandfathered path: ${path}; the list may only shrink`);
  }
  for (const file of files) {
    if (!file.split("/").at(-1).includes(".test.")) findings.push(`${file}: name unit tests *.test.* so the test-only lint rules apply`);
    if (!classified.has(file) && !grandfathered.has(file)) findings.push(`${file}: outside the protected categories in docs/architecture.md#test-policy; adding a scope requires a policy category`);
  }
  return { findings: findings.sort(), scoped: classified.size, grandfathered: grandfathered.size, total: files.length };
}

export function readBaseGrandfathered(root, baseRef) {
  if (!/^(?:[A-Za-z0-9][A-Za-z0-9_./-]*)$/.test(baseRef)) throw new Error("Invalid base ref");
  const base = /^[a-f0-9]{40}$/i.test(baseRef) ? baseRef : `origin/${baseRef}`;
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!git(["ls-tree", "--name-only", base, "--", MANIFEST_PATH]).trim()) return null;
  const manifest = JSON.parse(git(["show", `${base}:${MANIFEST_PATH}`]));
  if (!Array.isArray(manifest?.grandfathered) || manifest.grandfathered.some((entry) => !relativePath(entry?.path) || !oneLine(entry?.reason))) throw new Error("Invalid base grandfathered list");
  return manifest.grandfathered.map((entry) => entry.path);
}

export function checkUnitTestScope({ root = repositoryRoot, baseRef = process.env.BASE_REF || "main" } = {}) {
  const web = join(root, "apps/web");
  const files = trackedFiles(web).filter((file) => existsSync(join(web, file)));
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  const reference = readBaseGrandfathered(root, baseRef);
  return evaluateUnitTestScope({ files, manifest, reference });
}

export function run(options = {}) {
  try {
    const result = checkUnitTestScope(options);
    for (const finding of result.findings) console.error(finding);
    if (result.findings.length) return 1;
    console.log(`Unit test scope: ${result.scoped} scoped, ${result.grandfathered} grandfathered, ${result.total} total`);
    return 0;
  } catch (error) {
    console.error(`Unit test scope unavailable: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = run();
