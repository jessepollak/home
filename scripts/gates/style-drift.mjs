import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyStatusMark, classifyStyleDriftToken, isStatusStyleOwner, isPrimitiveStyleFile, isStyleDriftExempt, primitiveStyleScope, styleDriftFamilies, styleDriftOccurrences } from "../../apps/web/oxlint/policy/style-drift.mjs";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const root = fileURLToPath(new URL("../..", import.meta.url));
export const BASELINE_PATH = "apps/web/oxlint/policy/style-drift-baseline.json";
const baselinePath = path.join(root, BASELINE_PATH);
const parseCache = new Map();

export function isStyleDriftSource(file) {
  return typeof file === "string" && /^(?:app|client|components)\//u.test(file)
    && /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/u.test(file)
    && !/(?:^|\/)tests\//u.test(file)
    && !/\.(?:test|stories)\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/u.test(file)
    && !file.split("/").some((segment) => segment === "." || segment === ".." || !segment || segment.includes("\\"));
}

export function repositoryFiles() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: root })
    .toString().split("\0").filter((file) => file.startsWith("apps/web/") && isStyleDriftSource(file.slice("apps/web/".length)) && existsSync(path.join(root, file)))
    .sort().map((file) => ({ path: file.slice("apps/web/".length), content: readFileSync(path.join(root, file), "utf8") }));
}

function scriptKindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".mts")) return ts.ScriptKind.MTS;
  if (file.endsWith(".cts")) return ts.ScriptKind.CTS;
  if (/\.(?:js|mjs|cjs)$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function countStyleDrift(file, content) {
  const cached = parseCache.get(file);
  if (cached?.content === content) return cached.counts;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const counts = new Map();
  function record({ token, family }) {
    if (isStyleDriftExempt(file, family)) return;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  function visit(node) {
    if (ts.isImportSpecifier(node) && ts.isImportDeclaration(node.parent.parent.parent)
      && node.parent.parent.parent.moduleSpecifier.text === "lucide-react") {
      const mark = classifyStatusMark((node.propertyName ?? node.name).text);
      if (mark) record(mark);
    }
    let value;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text;
    else if ([ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind)) value = node.rawText;
    if (typeof value === "string") {
      for (const finding of styleDriftOccurrences(value)) record(finding);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const result = Object.fromEntries(counts);
  parseCache.set(file, { content, counts: result });
  return result;
}

function ownCount(counts, token) {
  return Object.hasOwn(counts ?? {}, token) ? counts[token] : 0;
}

function entries(files, budget, allowLegacyFamilies = false) {
  const invalid = [];
  const families = allowLegacyFamilies && budget?.families === undefined ? styleDriftFamilies.slice(0, 4) : budget?.families;
  const validFamilies = Array.isArray(families) && families.length > 0 && new Set(families).size === families.length
    && families.every((family) => styleDriftFamilies.includes(family))
    && (allowLegacyFamilies || styleDriftFamilies.every((family) => families.includes(family)));
  if (!validFamilies) invalid.push("budget.families must list the ratcheted style-drift families exactly once");
  const scopesValid = Array.isArray(budget?.scopes) && budget.scopes.length === 1 && budget.scopes[0] === primitiveStyleScope;
  if (budget?.scopes !== undefined ? !scopesValid : !allowLegacyFamilies) {
    invalid.push(`budget.scopes must list ${primitiveStyleScope} exactly once so primitive status styling stays ratcheted`);
  }
  const scanned = new Map(files.map(({ path: file, content }) => [file, countStyleDrift(file, content)]));
  const base = budget?.files && typeof budget.files === "object" && !Array.isArray(budget.files) ? budget.files : {};
  if (base !== budget?.files) invalid.push("budget.files must be an object");
  for (const [file, counts] of Object.entries(base)) {
    if (!isStyleDriftSource(file) || !counts || typeof counts !== "object" || Array.isArray(counts) || !Object.keys(counts).length) {
      invalid.push(`${file}: invalid or empty baseline entry`);
      continue;
    }
    for (const [token, count] of Object.entries(counts)) {
      const finding = classifyStyleDriftToken(token);
      if (/\s/u.test(token) || finding?.token !== token || !Number.isSafeInteger(count) || count <= 0) invalid.push(`${file}: invalid ${token} baseline count ${count}`);
      else if (validFamilies && !families.includes(finding.family)) invalid.push(`${file}: ${token} family ${finding.family} is not listed in budget.families`);
      else if (isStyleDriftExempt(file, finding.family)) invalid.push(`${file}: ${isStatusStyleOwner(file) ? "owned status renderer" : "primitive"} cannot have a ${finding.family} baseline`);
    }
  }
  return { scanned, base, invalid, families };
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function readBaseBudget(baseRef = "origin/main", baselinePath = BASELINE_PATH, gitRunner = git) {
  if (baseRef.startsWith("-")) throw new Error(`Invalid base ref: ${baseRef}`);
  const base = /^[0-9a-f]{40}$/iu.test(baseRef) || baseRef.startsWith("origin/") ? baseRef : `origin/${baseRef}`;
  let listing;
  try {
    listing = gitRunner(["ls-tree", "--name-only", base, "--", baselinePath]);
  } catch (error) {
    throw new Error(`Could not inspect ${base}: ${error.message}`);
  }
  if (!listing) return { base, families: [], scopes: [], files: null, notes: [`${baselinePath} is absent at ${base}; baseline raises were not checked.`] };
  const parsed = JSON.parse(gitRunner(["show", `${base}:${baselinePath}`]));
  const shape = entries([], parsed, true);
  if (shape.invalid.length) throw new Error(`${baselinePath} at ${base} is invalid: ${shape.invalid[0]}`);
  return { base, families: shape.families, scopes: parsed.scopes ?? [], files: parsed.files, notes: [] };
}

export function evaluateStyleDriftBudget({ files, budget, reference = null }) {
  const { scanned, base, invalid } = entries(files, budget);
  const increases = [];
  const stale = [];
  const raises = [];
  if (reference && typeof reference === "object" && !Array.isArray(reference)) {
    for (const [file, counts] of Object.entries(base)) {
      for (const [token, count] of Object.entries(counts ?? {})) {
        const family = classifyStyleDriftToken(token)?.family;
        if (!(reference.families ?? styleDriftFamilies.slice(0, 4)).includes(family)) continue;
        const prior = ownCount(reference.files?.[file], token);
        if (isPrimitiveStyleFile(file) && !(reference.scopes ?? []).includes(primitiveStyleScope)) continue;
        if (count > prior) raises.push(`${file}: ${token} baseline ${count} > ${prior}; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise`);
      }
    }
  }
  for (const [file, counts] of scanned) {
    for (const token of new Set([...Object.keys(counts), ...Object.keys(base[file] ?? {})])) {
      const old = ownCount(base[file], token);
      const allowed = Number.isSafeInteger(old) && old > 0 ? old : 0;
      const count = ownCount(counts, token);
      if (count > allowed) {
        const fix = classifyStyleDriftToken(token)?.family.startsWith("status-")
          ? "use a status texture from components/ui/status-texture; presenters return a texture name and owned components render it"
          : "remove the off-token utility or fix it through an owned variant";
        increases.push(`${file}: ${token} ${count} > ${allowed}; ${fix}`);
      }
      if (count < allowed) stale.push(`${file}: ${token} ${count} < ${allowed}; run bun run style-drift:shrink`);
    }
  }
  for (const file of Object.keys(base)) if (!scanned.has(file)) stale.push(`${file}: baseline file missing; run bun run style-drift:shrink`);
  return { increases: increases.sort(), stale: stale.sort(), invalid: invalid.sort(), raises: raises.sort() };
}

export function shrinkBudget({ files, budget }) {
  const { scanned, base } = entries(files, budget);
  const result = {};
  for (const file of [...scanned.keys()].sort()) {
    const counts = new Map();
    for (const token of Object.keys(scanned.get(file)).sort()) {
      const next = Math.min(ownCount(base[file], token), scanned.get(file)[token]);
      if (next > 0) counts.set(token, next);
    }
    if (counts.size) result[file] = Object.fromEntries(counts);
  }
  return { families: budget.families, ...(budget.scopes ? { scopes: budget.scopes } : {}), files: result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const shrink = process.argv.length === 3 && process.argv[2] === "--shrink";
  if (process.argv.length > (shrink ? 3 : 2)) {
    console.error("usage: node scripts/gates/style-drift.mjs [--shrink]");
    process.exitCode = 1;
  } else {
    try {
      const files = repositoryFiles();
      const budget = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8"))
        : shrink ? { families: styleDriftFamilies, files: Object.fromEntries(files.map(({ path: file, content }) => [file, countStyleDrift(file, content)]).filter(([, counts]) => Object.keys(counts).length)) } : { families: styleDriftFamilies, files: {} };
      let reference = null;
      const baseFindings = [];
      try {
        const result = readBaseBudget(process.env.BASE_REF || "origin/main");
        reference = result.files === null ? null : result;
        for (const note of result.notes) console.error(note);
      } catch (error) {
        baseFindings.push(`Base baseline unavailable or invalid: ${error.message}`);
      }
      let findings = evaluateStyleDriftBudget({ files, budget, reference });
      if (shrink && !baseFindings.length && !findings.invalid.length && !findings.raises.length) {
        const smaller = shrinkBudget({ files, budget });
        writeFileSync(baselinePath, `${JSON.stringify(smaller, null, 2)}\n`);
        findings = evaluateStyleDriftBudget({ files, budget: smaller, reference });
      }
      const messages = [...baseFindings, ...findings.increases, ...findings.stale, ...findings.invalid, ...findings.raises];
      for (const message of messages) console.error(message);
      if (messages.length) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
