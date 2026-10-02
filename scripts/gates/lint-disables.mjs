import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const root = fileURLToPath(new URL("../..", import.meta.url));
const baselinePath = fileURLToPath(new URL("./lint-disables-baseline.json", import.meta.url));
export const BASELINE_PATH = "scripts/gates/lint-disables-baseline.json";
const directive = /^(?:oxlint|eslint)-disable(?:-line|-next-line)?(?:\s+([\s\S]*))?$/u;
const ruleName = /^@?[A-Za-z0-9*][A-Za-z0-9*_./-]*$/u;
const linkedIssue = /^(?:#[1-9]\d*|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9]\d*)$/u;
const parseCache = new Map();

export function isLintedSource(file) {
  if (typeof file !== "string" || !file.startsWith("apps/web/") || !/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(file)) return false;
  const local = file.slice("apps/web/".length);
  return !/(?:^|\/)(?:node_modules|\.next|out|build|storybook-static)\//u.test(local)
    && local !== ".storybook/static/mockServiceWorker.js" && local !== "next-env.d.ts";
}

export function repositoryFiles() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: root })
    .toString().split("\0").filter((file) => isLintedSource(file) && existsSync(path.join(root, file)))
    .sort().map((file) => ({ path: file, content: readFileSync(path.join(root, file), "utf8") }));
}

function scriptKindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".mts")) return ts.ScriptKind.MTS;
  if (file.endsWith(".cts")) return ts.ScriptKind.CTS;
  if (/\.(?:js|mjs|cjs)$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseDisables(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const comments = new Map();
  const jsxText = [];
  function visit(node) {
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) jsxText.push([node.pos, node.end]);
    if (node.getChildCount(source)) {
      for (const child of node.getChildren(source)) visit(child);
    } else if (node.kind !== ts.SyntaxKind.JsxText && node.kind !== ts.SyntaxKind.JsxTextAllWhiteSpaces) {
      for (const range of [
        ...(ts.getLeadingCommentRanges(content, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(content, node.end) ?? []),
      ]) comments.set(range.pos, range);
    }
  }
  visit(source);
  const counts = new Map();
  const invalid = [];
  for (const [position, range] of comments) {
    if (jsxText.some(([start, end]) => start <= position && position < end)) continue;
    const text = content.slice(range.pos, range.end).replace(/^\/\/|^\/\*|\*\/$/gu, "").trim();
    const match = directive.exec(text);
    if (!match) continue;
    const body = match[1] ?? "";
    const separator = /(?:^|\s)--(?=\s|$)/u.exec(body);
    const reason = separator ? body.slice(separator.index + separator[0].length).trim() : "";
    if (!separator || !reason) invalid.push(`${file}: oxlint-disable directive needs " -- <reason>"`);
    const rawRules = (separator ? body.slice(0, separator.index) : body).trim();
    const rules = rawRules ? rawRules.split(",").map((rule) => rule.trim()) : ["*"];
    for (const rule of rules) {
      if (!rule) {
        invalid.push(`${file}: invalid rule name "" in an oxlint-disable directive`);
        continue;
      }
      if (!ruleName.test(rule)) invalid.push(`${file}: invalid rule name "${rule}" in an oxlint-disable directive`);
      counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
  }
  return { counts: Object.fromEntries(counts), invalid };
}

export function countDisables(file, content) {
  return parseDisables(file, content).counts;
}

function cachedDisables(file, content) {
  const cached = parseCache.get(file);
  if (cached?.content === content) return cached.result;
  const result = parseDisables(file, content);
  parseCache.set(file, { content, result });
  return result;
}
function ownCount(counts, rule) {
  return Object.hasOwn(counts ?? {}, rule) ? counts[rule] : 0;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function readBaseBudget(baseRef = "main", baselinePath = BASELINE_PATH, gitRunner = git) {
  const notes = [];
  if (baseRef.startsWith("-")) throw new Error(`Invalid base ref: ${baseRef}`);
  const base = /^[0-9a-f]{40}$/iu.test(baseRef) ? baseRef : `origin/${baseRef}`;
  let listing;
  try {
    listing = gitRunner(["ls-tree", "--name-only", base, "--", baselinePath]);
  } catch (error) {
    throw new Error(`Could not inspect ${base}: ${error.message}`);
  }
  if (!listing) {
    notes.push(`${baselinePath} is absent at ${base}; baseline raises were not checked.`);
    return { base, files: null, notes };
  }
  const parsed = JSON.parse(gitRunner(["show", `${base}:${baselinePath}`]));
  const shape = entries([], { files: parsed?.files, exceptions: parsed?.exceptions });
  if (shape.invalid.length) throw new Error(`${baselinePath} at ${base} is invalid: ${shape.invalid[0]}`);
  return { base, files: parsed.files, notes };
}

function entries(files, budget) {
  const invalid = [];
  const scanned = new Map(files.map(({ path: file, content }) => [file, cachedDisables(file, content)]));
  const base = budget?.files && typeof budget.files === "object" && !Array.isArray(budget.files) ? budget.files : {};
  const exceptions = Array.isArray(budget?.exceptions) ? budget.exceptions : [];
  if (base !== budget?.files) invalid.push("budget.files must be an object");
  if (exceptions !== budget?.exceptions) invalid.push("budget.exceptions must be an array");
  const extra = new Map();
  const seen = new Set();
  for (const [file, counts] of Object.entries(base)) {
    if (!isLintedSource(file) || !counts || typeof counts !== "object" || Array.isArray(counts) || !Object.keys(counts).length) {
      invalid.push(`${file}: invalid or empty baseline entry`);
      continue;
    }
    for (const [rule, count] of Object.entries(counts)) {
      if (!ruleName.test(rule) || !Number.isSafeInteger(count) || count <= 0) invalid.push(`${file}: invalid ${rule} baseline count ${count}`);
    }
  }
  for (const entry of exceptions) {
    const { path: file, rule, count, issue, reason } = entry ?? {};
    if (!isLintedSource(file) || typeof rule !== "string" || !ruleName.test(rule) || !Number.isSafeInteger(count) || count <= 0
      || typeof issue !== "string" || !linkedIssue.test(issue) || typeof reason !== "string" || !reason.trim()) invalid.push(`${file ?? "(missing path)"}: invalid ${rule ?? "(missing rule)"} exception (positive count, linked lint issue and reason required)`);
    const key = `${file}:${rule}`;
    if (seen.has(key)) invalid.push(`${key}: duplicate exception`);
    seen.add(key);
    if (isLintedSource(file) && typeof rule === "string" && ruleName.test(rule) && Number.isSafeInteger(count) && count > 0) extra.set(key, (extra.get(key) ?? 0) + count);
  }
  for (const [key, count] of extra) {
    const index = key.lastIndexOf(":");
    const file = key.slice(0, index);
    const rule = key.slice(index + 1);
    if (scanned.has(file) && ownCount(scanned.get(file).counts, rule) < count) invalid.push(`${file}: ${rule} exception exceeds current count; edit the exception by hand`);
  }
  return { scanned, base, exceptions, extra, invalid };
}

export function evaluateDisableBudget({ files, budget, reference = null }) {
  const { scanned, base, exceptions, extra, invalid } = entries(files, budget);
  const increases = [];
  const stale = [];
  const raises = [];
  if (reference && typeof reference === "object" && !Array.isArray(reference)) {
    for (const file of new Set([...Object.keys(reference), ...Object.keys(base)])) {
      for (const rule of new Set([...Object.keys(reference[file] ?? {}), ...Object.keys(base[file] ?? {})])) {
        const old = ownCount(reference[file], rule);
        const current = ownCount(base[file], rule);
        const prior = Number.isSafeInteger(old) && old > 0 ? old : 0;
        const now = Number.isSafeInteger(current) ? current : 0;
        if (now > prior) raises.push(`${file}: ${rule} baseline ${now} > ${prior}; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise and admit the disable through a reviewed exception with a linked issue`);
      }
    }
  }
  for (const [file, { counts, invalid: findings }] of scanned) {
    invalid.push(...findings);
    for (const rule of new Set([...Object.keys(counts), ...Object.keys(base[file] ?? {}), ...[...extra.keys()].filter((key) => key.startsWith(`${file}:`)).map((key) => key.slice(file.length + 1))])) {
      const old = ownCount(base[file], rule);
      const allowed = (Number.isSafeInteger(old) && old > 0 ? old : 0) + (extra.get(`${file}:${rule}`) ?? 0);
      const count = ownCount(counts, rule);
      if (count > allowed) increases.push(`${file}: ${rule} ${count} > ${allowed}; remove the disable or add a reviewed exception with a linked issue`);
      if (count < allowed) stale.push(`${file}: ${rule} ${count} < ${allowed}; run bun run disables:shrink`);
    }
  }
  for (const file of Object.keys(base)) if (!scanned.has(file)) stale.push(`${file}: baseline file missing; run bun run disables:shrink`);
  for (const entry of exceptions) if (typeof entry?.path === "string" && isLintedSource(entry.path) && !scanned.has(entry.path)) stale.push(`${entry.path}: ${entry.rule} exception file missing; remove the exception by hand`);
  return { increases: increases.sort(), stale: stale.sort(), invalid: invalid.sort(), raises: raises.sort() };
}

export function shrinkBudget({ files, budget }) {
  const { scanned, base, exceptions, extra } = entries(files, budget);
  const result = {};
  for (const file of [...scanned.keys()].sort()) {
    const current = scanned.get(file).counts;
    const counts = new Map();
    for (const rule of [...new Set([...Object.keys(base[file] ?? {}), ...Object.keys(current)])].sort()) {
      const old = ownCount(base[file], rule);
      const remaining = ownCount(current, rule) - (extra.get(`${file}:${rule}`) ?? 0);
      const next = Math.max(0, Math.min(old, remaining));
      if (next > 0) counts.set(rule, next);
    }
    if (counts.size) result[file] = Object.fromEntries(counts);
  }
  return { files: result, exceptions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const shrink = process.argv.length === 3 && process.argv[2] === "--shrink";
  if (process.argv.length > (shrink ? 3 : 2)) {
    console.error("usage: node scripts/gates/lint-disables.mjs [--shrink]");
    process.exitCode = 1;
  } else {
    const files = repositoryFiles();
    const budget = JSON.parse(readFileSync(baselinePath, "utf8"));
    let reference = null;
    const baseFindings = [];
    try {
      const result = readBaseBudget(process.env.BASE_REF || "main");
      reference = result.files;
      for (const note of result.notes) console.error(note);
    } catch (error) {
      baseFindings.push(`Base baseline unavailable or invalid: ${error.message}`);
    }
    const before = evaluateDisableBudget({ files, budget, reference });
    if (shrink && !baseFindings.length && !before.invalid.length && !before.raises.length) {
      const smaller = shrinkBudget({ files, budget });
      writeFileSync(baselinePath, `${JSON.stringify(smaller, null, 2)}\n`);
      const after = evaluateDisableBudget({ files, budget: smaller, reference });
      for (const message of [...after.increases, ...after.stale, ...after.invalid, ...after.raises]) console.error(message);
      if (after.increases.length || after.stale.length || after.invalid.length || after.raises.length) process.exitCode = 1;
    } else {
      for (const message of [...baseFindings, ...before.increases, ...before.stale, ...before.invalid, ...before.raises]) console.error(message);
      if (baseFindings.length || before.increases.length || before.stale.length || before.invalid.length || before.raises.length) process.exitCode = 1;
    }
  }
}
