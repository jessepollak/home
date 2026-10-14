import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyStyleUtility, styleDriftOccurrences } from "../../apps/web/oxlint/policy/style-drift.mjs";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const root = fileURLToPath(new URL("../..", import.meta.url));
export const BASELINE_PATH = "apps/web/oxlint/policy/style-drift-baseline.json";
const baselinePath = path.join(root, BASELINE_PATH);
const parseCache = new Map();

export function isStyleDriftSource(file) {
  return typeof file === "string" && /^(?:app|client|components)\//u.test(file)
    && /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/u.test(file)
    && !file.startsWith("components/ui/") && !/(?:^|\/)tests\//u.test(file)
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
  function visit(node) {
    let value;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text;
    else if ([ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind)) value = node.rawText;
    if (typeof value === "string") {
      for (const { token } of styleDriftOccurrences(value)) counts.set(token, (counts.get(token) ?? 0) + 1);
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

function entries(files, budget) {
  const invalid = [];
  const scanned = new Map(files.map(({ path: file, content }) => [file, countStyleDrift(file, content)]));
  const base = budget?.files && typeof budget.files === "object" && !Array.isArray(budget.files) ? budget.files : {};
  if (base !== budget?.files) invalid.push("budget.files must be an object");
  for (const [file, counts] of Object.entries(base)) {
    if (!isStyleDriftSource(file) || !counts || typeof counts !== "object" || Array.isArray(counts) || !Object.keys(counts).length) {
      invalid.push(`${file}: invalid or empty baseline entry`);
      continue;
    }
    for (const [token, count] of Object.entries(counts)) {
      if (/\s/u.test(token) || classifyStyleUtility(token)?.token !== token || !Number.isSafeInteger(count) || count <= 0) invalid.push(`${file}: invalid ${token} baseline count ${count}`);
    }
  }
  return { scanned, base, invalid };
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
  if (!listing) return { base, files: null, notes: [`${baselinePath} is absent at ${base}; baseline raises were not checked.`] };
  const parsed = JSON.parse(gitRunner(["show", `${base}:${baselinePath}`]));
  const shape = entries([], parsed);
  if (shape.invalid.length) throw new Error(`${baselinePath} at ${base} is invalid: ${shape.invalid[0]}`);
  return { base, files: parsed.files, notes: [] };
}

export function evaluateStyleDriftBudget({ files, budget, reference = null }) {
  const { scanned, base, invalid } = entries(files, budget);
  const increases = [];
  const stale = [];
  const raises = [];
  if (reference && typeof reference === "object" && !Array.isArray(reference)) {
    for (const [file, counts] of Object.entries(base)) {
      for (const [token, count] of Object.entries(counts ?? {})) {
        const prior = ownCount(reference[file], token);
        if (count > prior) raises.push(`${file}: ${token} baseline ${count} > ${prior}; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise`);
      }
    }
  }
  for (const [file, counts] of scanned) {
    for (const token of new Set([...Object.keys(counts), ...Object.keys(base[file] ?? {})])) {
      const old = ownCount(base[file], token);
      const allowed = Number.isSafeInteger(old) && old > 0 ? old : 0;
      const count = ownCount(counts, token);
      if (count > allowed) increases.push(`${file}: ${token} ${count} > ${allowed}; remove the off-token utility or fix it through an owned variant`);
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
  return { files: result };
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
        : shrink ? { files: Object.fromEntries(files.map(({ path: file, content }) => [file, countStyleDrift(file, content)]).filter(([, counts]) => Object.keys(counts).length)) } : { files: {} };
      let reference = null;
      const baseFindings = [];
      try {
        const result = readBaseBudget(process.env.BASE_REF || "origin/main");
        reference = result.files;
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
