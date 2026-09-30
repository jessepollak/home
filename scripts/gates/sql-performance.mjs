import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleMarkdownLines } from "./failure-cases.mjs";
import { resolveBaseRef } from "./playwright-rung.mjs";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");

export function containsSql(path, content) {
  if (!/^apps\/web\/server\//.test(path) || /(?:^|\/)(?:tests|__tests__|fixtures|explorations)(?:\/|$)|\.(?:test|spec|stories)\./.test(path)) return false;
  if (path.endsWith(".sql")) return true;
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) return false;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  let found = false;
  function visit(node) {
    const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text : ts.isTemplateExpression(node) ? node.head.text : "";
    if (/^\s*(?:(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)\s*)*(?:SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+\S/i.test(text)) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

export function sqlPerformanceReport(changes, body) {
  const files = changes.filter(({ path, content, basePath = path, baseContent = "" }) =>
    content !== baseContent && (containsSql(path, content) || containsSql(basePath, baseContent)),
  ).map(({ path }) => path);
  if (files.length === 0) return { files, findings: [] };
  const entries = visibleMarkdownLines(body).filter((line) => /^SQL-performance:/.test(line));
  const valid = entries.length === 1 && /^SQL-performance: (?:verified|not-verified|not-applicable) — \S.*$/.test(entries[0]);
  return {
    files,
    findings: valid ? [] : ["SQL-bearing production modules or SQL files changed. Add exactly one visible SQL-performance: <verified|not-verified|not-applicable> — <specific plan/index evidence, blocker, or reason>; see docs/sql-performance.md."],
  };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

export function changedSqlCandidates(base) {
  const revision = git(["merge-base", base, "HEAD"]).trim();
  const paths = git(["diff", "--no-renames", "--name-only", "-z", revision, "HEAD", "--", "apps/web/server"]).split("\0").filter(Boolean);
  const read = (ref, path) => {
    const exists = git(["ls-tree", "--name-only", ref, "--", path]).trim();
    return exists ? git(["show", `${ref}:${path}`]) : "";
  };
  return paths.map((path) => ({ path, content: read("HEAD", path), baseContent: read(revision, path) }));
}

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/sql-performance.mjs");
  const report = sqlPerformanceReport(changedSqlCandidates(resolveBaseRef()), process.env.PR_BODY || "");
  console.log(`SQL performance: ${report.files.length} changed SQL-bearing modules/files.`);
  for (const path of report.files) console.log(`- ${path}`);
  for (const finding of report.findings) console.error(finding);
  if (report.findings.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
