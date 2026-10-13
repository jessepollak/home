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
    return { base, files: null, exceptions: [], notes };
  }
  const parsed = JSON.parse(gitRunner(["show", `${base}:${baselinePath}`]));
  const shape = entries([], { files: parsed?.files, exceptions: parsed?.exceptions });
  if (shape.invalid.length) throw new Error(`${baselinePath} at ${base} is invalid: ${shape.invalid[0]}`);
  return { base, files: parsed.files, exceptions: parsed.exceptions, notes };
}

export function readBaseCounts(base, files, gitRunner = git) {
  const counts = new Map();
  for (const file of files) {
    let content;
    try {
      content = gitRunner(["show", `${base}:${file}`]);
    } catch {
      counts.set(file, {});
      continue;
    }
    counts.set(file, countDisables(file, content));
  }
  return counts;
}

export function baseBudgetCandidates(files, budget, reference) {
  const candidates = new Set((files ?? []).filter(({ path: file, content }) => Object.keys(countDisables(file, content)).length).map(({ path: file }) => file));
  for (const value of [reference, budget?.files]) {
    if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      for (const file of Object.keys(value)) candidates.add(file);
    }
  }
  return [...candidates].sort();
}

export function readBaseInput(baseRef = "main", { files, budget, gitRunner = git, baselinePath = BASELINE_PATH } = {}) {
  const { base, files: reference, exceptions: baseExceptions, notes } = readBaseBudget(baseRef, baselinePath, gitRunner);
  const baseCounts = reference === null ? null : readBaseCounts(base, baseBudgetCandidates(files, budget, reference), gitRunner);
  return { base, reference, baseCounts, baseExceptions, notes, changeTime: !/^[0-9a-f]{40}$/iu.test(baseRef) };
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
  return { scanned, base, exceptions, extra, invalid };
}

export function evaluateDisableBudget({ files, budget, reference = null, baseCounts = null, baseExceptions = [], enforceFloor = false }) {
  const { scanned, base, exceptions, extra, invalid } = entries(files, budget);
  const increases = [];
  const notes = [];
  const raises = [];
  for (const [key, count] of extra) {
    const index = key.lastIndexOf(":");
    const file = key.slice(0, index);
    const rule = key.slice(index + 1);
    if (scanned.has(file) && ownCount(scanned.get(file).counts, rule) < count) notes.push(`${file}: ${rule} exception exceeds current count; edit the exception by hand`);
  }
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
      const baseline = Number.isSafeInteger(old) && old > 0 ? old : 0;
      const extraCount = extra.get(`${file}:${rule}`) ?? 0;
      const baselineAllowed = baseline + extraCount;
      const inherited = baseExceptions.filter((entry) => entry?.path === file && entry.rule === rule && Number.isSafeInteger(entry.count) && entry.count > 0)
        .reduce((sum, entry) => sum + entry.count, 0);
      const baseCount = ownCount(baseCounts?.get(file), rule);
      const allowed = baseCounts === null ? baseline + extraCount : Math.min(baseCount + Math.max(0, extraCount - inherited), baseline + extraCount);
      const count = ownCount(counts, rule);
      if (count > allowed) increases.push(`${file}: ${rule} ${count} > ${allowed}; remove the disable or add a reviewed exception with a linked issue`);
      if (count < baseline) notes.push(`${file}: ${rule} ${count} < ${baseline}; lower the baseline with bun run disables:shrink`);
      if (enforceFloor && reference && typeof reference === "object" && !Array.isArray(reference)) {
        const floor = Math.min(ownCount(reference[file], rule), count);
        if (baseline < floor) invalid.push(`${file}: ${rule} baseline ${baseline} is below the shrink floor ${floor}; a baseline may only be lowered by bun run disables:shrink`);
      }
    }
  }
  for (const file of Object.keys(base)) if (!scanned.has(file)) notes.push(`${file}: baseline file missing; drop it with bun run disables:shrink`);
  for (const entry of exceptions) if (typeof entry?.path === "string" && isLintedSource(entry.path) && !scanned.has(entry.path)) notes.push(`${entry.path}: ${entry.rule} exception file missing; remove the exception by hand`);
  return { increases: increases.sort(), notes: notes.sort(), invalid: invalid.sort(), raises: raises.sort() };
}

export function hasFatalFindings({ increases = [], invalid = [], raises = [] }) {
  return increases.length > 0 || invalid.length > 0 || raises.length > 0;
}

export function shrinkBudget({ files, budget }) {
  const { scanned, base, exceptions } = entries(files, budget);
  const result = {};
  for (const file of [...scanned.keys()].sort()) {
    const current = scanned.get(file).counts;
    const counts = new Map();
    for (const rule of [...new Set([...Object.keys(base[file] ?? {}), ...Object.keys(current)])].sort()) {
      const old = ownCount(base[file], rule);
      const next = Math.max(0, Math.min(old, ownCount(current, rule)));
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
    let baseCounts = null;
    let baseExceptions = [];
    let enforceFloor = false;
    const baseFindings = [];
    try {
      const result = readBaseInput(process.env.BASE_REF || "main", { files, budget });
      reference = result.reference;
      baseCounts = result.baseCounts;
      baseExceptions = result.baseExceptions;
      enforceFloor = result.changeTime;
      for (const note of result.notes) console.log(note);
    } catch (error) {
      baseFindings.push(`Base baseline unavailable or invalid: ${error.message}`);
    }
    const before = evaluateDisableBudget({ files, budget, reference, baseCounts, baseExceptions, enforceFloor });
    if (shrink && !baseFindings.length && !before.invalid.length && !before.raises.length) {
      const smaller = shrinkBudget({ files, budget });
      writeFileSync(baselinePath, `${JSON.stringify(smaller, null, 2)}\n`);
      const after = evaluateDisableBudget({ files, budget: smaller, reference, baseCounts, baseExceptions, enforceFloor });
      for (const note of after.notes) console.log(note);
      for (const message of [...baseFindings, ...after.increases, ...after.invalid, ...after.raises]) console.error(message);
      if (baseFindings.length || hasFatalFindings(after)) process.exitCode = 1;
    } else {
      for (const note of before.notes) console.log(note);
      for (const message of [...baseFindings, ...before.increases, ...before.invalid, ...before.raises]) console.error(message);
      if (baseFindings.length || hasFatalFindings(before)) process.exitCode = 1;
    }
  }
}
