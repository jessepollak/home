import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const root = fileURLToPath(new URL("../..", import.meta.url));
const baselinePath = fileURLToPath(new URL("./type-assertions-baseline.json", import.meta.url));
const kinds = ["assertion", "nonNull", "suppression", "genericParse"];
const directive = /@ts-(?:ignore|expect-error|nocheck)\b|\b(?:eslint|oxlint)-disable(?:-[\w-]+)?\b/u;
const parseCache = new Map();

export function isProductionTypeScript(file) {
  if (!/^apps\/web\//u.test(file) || !/\.(?:ts|tsx|mts|cts)$/u.test(file)) return false;
  const local = file.slice("apps/web/".length);
  if (/(?:^|\/)(?:tests|testing|explorations)\//u.test(local) || /\.(?:test|stories)\.[^/]+$/u.test(local)
    || /(?:^|\/)[^/]*(?:test-harness|smoke-fixture[^/]*)\.(?:ts|tsx)$/u.test(local)) return false;
  return /^(?:app|client|components|config|lib|server|shared|types)\//u.test(local)
    || /^(?:instrumentation[^/]*\.ts|proxy\.ts|next\.config\.ts)$/u.test(local);
}

export function repositoryFiles() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: root })
    .toString().split("\0").filter((file) => isProductionTypeScript(file) && existsSync(path.join(root, file)))
    .sort().map((file) => ({ path: file, content: readFileSync(path.join(root, file), "utf8") }));
}

export function countAssertions(file, content) {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".mts") ? ts.ScriptKind.MTS
    : file.endsWith(".cts") ? ts.ScriptKind.CTS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const counts = { assertion: 0, nonNull: 0, suppression: 0, genericParse: 0 };
  const comments = new Set();
  const jsxText = [];
  const parseAliases = new Set();
  function calleeName(expression) {
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : "";
  }
  const isParseName = (name) => /parse|json/iu.test(name) || parseAliases.has(name);
  function collectAliases(node) {
    if (ts.isImportSpecifier(node) && isParseName((node.propertyName ?? node.name).text)) parseAliases.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) === ts.NodeFlags.Const && isParseName(calleeName(node.initializer))) parseAliases.add(node.name.text);
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && isParseName(node.propertyName && ts.isIdentifier(node.propertyName) ? node.propertyName.text : node.name.text)) parseAliases.add(node.name.text);
    if (ts.isImportDeclaration(node) && node.importClause?.name && ts.isStringLiteralLike(node.moduleSpecifier) && isParseName(node.moduleSpecifier.text)) parseAliases.add(node.importClause.name.text);
    ts.forEachChild(node, collectAliases);
  }
  for (let size = -1; size !== parseAliases.size;) {
    size = parseAliases.size;
    collectAliases(source);
  }
  function visit(node) {
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) jsxText.push([node.pos, node.end]);
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && node.type.kind !== ts.SyntaxKind.ConstKeyword
      && !(ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === "const")) counts.assertion++;
    if (ts.isNonNullExpression(node) || ((ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) && node.exclamationToken)) counts.nonNull++;
    if (ts.isCallExpression(node) && node.typeArguments?.length) {
      if (isParseName(calleeName(node.expression))) counts.genericParse++;
    }
    if (node.getChildCount(source)) {
      for (const child of node.getChildren(source)) visit(child);
    } else if (node.kind !== ts.SyntaxKind.JsxText && node.kind !== ts.SyntaxKind.JsxTextAllWhiteSpaces) {
      for (const range of [
        ...(ts.getLeadingCommentRanges(content, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(content, node.end) ?? []),
      ]) {
        if (!comments.has(range.pos) && directive.test(content.slice(range.pos, range.end))) comments.add(range.pos);
      }
    }
  }
  visit(source);
  counts.suppression = [...comments].filter((position) => !jsxText.some(([start, end]) => start <= position && position < end)).length;
  return counts;
}

function cachedCounts(file, content) {
  const cached = parseCache.get(file);
  if (cached?.content === content) return cached.counts;
  const counts = countAssertions(file, content);
  parseCache.set(file, { content, counts });
  return counts;
}

function entries(files, budget) {
  const invalid = [];
  const scanned = new Map(files.map(({ path: file, content }) => [file, cachedCounts(file, content)]));
  const base = budget?.files && typeof budget.files === "object" && !Array.isArray(budget.files) ? budget.files : {};
  const exceptions = Array.isArray(budget?.exceptions) ? budget.exceptions : [];
  if (base !== budget?.files) invalid.push("budget.files must be an object");
  if (exceptions !== budget?.exceptions) invalid.push("budget.exceptions must be an array");
  const extra = new Map();
  const seen = new Set();
  for (const [file, counts] of Object.entries(base)) {
    if (!isProductionTypeScript(file) || !counts || typeof counts !== "object" || Array.isArray(counts) || !Object.keys(counts).length) {
      invalid.push(`${file}: invalid or empty baseline entry`);
      continue;
    }
    for (const [kind, count] of Object.entries(counts)) {
      if (!kinds.includes(kind) || !Number.isSafeInteger(count) || count <= 0) invalid.push(`${file}: invalid ${kind} baseline count ${count}`);
    }
  }
  for (const entry of exceptions) {
    const { path: file, kind, count, reason } = entry ?? {};
    if (!isProductionTypeScript(file) || !kinds.includes(kind) || !Number.isSafeInteger(count) || count <= 0
      || typeof reason !== "string" || !reason.trim()) invalid.push(`${file ?? "(missing path)"}: invalid ${kind ?? "(missing kind)"} exception (positive count and reason required)`);
    const key = `${file}:${kind}`;
    if (seen.has(key)) invalid.push(`${key}: duplicate exception`);
    seen.add(key);
    if (isProductionTypeScript(file) && kinds.includes(kind) && Number.isSafeInteger(count) && count > 0) extra.set(key, (extra.get(key) ?? 0) + count);
  }
  for (const [key, count] of extra) {
    const index = key.lastIndexOf(":");
    const file = key.slice(0, index);
    const kind = key.slice(index + 1);
    if (scanned.has(file) && scanned.get(file)[kind] < count) invalid.push(`${file}: ${kind} exception exceeds current count; edit the exception by hand`);
  }
  return { scanned, base, exceptions, extra, invalid };
}

export function evaluateAssertionBudget({ files, budget }) {
  const { scanned, base, exceptions, extra, invalid } = entries(files, budget);
  const increases = [];
  const stale = [];
  for (const [file, counts] of scanned) {
    for (const kind of kinds) {
      const allowed = (Number.isSafeInteger(base[file]?.[kind]) && base[file][kind] > 0 ? base[file][kind] : 0) + (extra.get(`${file}:${kind}`) ?? 0);
      if (counts[kind] > allowed) increases.push(`${file}: ${kind} ${counts[kind]} > ${allowed}; narrow with a runtime guard or parser, or add a reviewed exception with a reason`);
      if (counts[kind] < allowed) stale.push(`${file}: ${kind} ${counts[kind]} < ${allowed}; run bun run assertions:shrink`);
    }
  }
  for (const file of Object.keys(base)) if (!scanned.has(file)) stale.push(`${file}: baseline file missing; run bun run assertions:shrink`);
  for (const entry of exceptions) if (typeof entry?.path === "string" && isProductionTypeScript(entry.path) && !scanned.has(entry.path)) stale.push(`${entry.path}: ${entry.kind} exception file missing; remove the exception by hand`);
  return { increases: increases.sort(), stale: stale.sort(), invalid: invalid.sort() };
}

export function shrinkBudget({ files, budget }) {
  const { scanned, base, exceptions, extra } = entries(files, budget);
  const result = {};
  for (const file of [...scanned.keys()].sort()) {
    const current = scanned.get(file);
    const counts = {};
    for (const kind of [...kinds].sort()) {
      const old = base[file]?.[kind] ?? 0;
      const remaining = current[kind] - (extra.get(`${file}:${kind}`) ?? 0);
      const next = Math.max(0, Math.min(old, remaining));
      if (next > 0) counts[kind] = next;
    }
    if (Object.keys(counts).length) result[file] = counts;
  }
  return { files: result, exceptions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const shrink = process.argv.length === 3 && process.argv[2] === "--shrink";
  if (process.argv.length > (shrink ? 3 : 2)) {
    console.error("usage: node scripts/gates/type-assertions.mjs [--shrink]");
    process.exitCode = 1;
  } else {
    const files = repositoryFiles();
    const budget = JSON.parse(readFileSync(baselinePath, "utf8"));
    const before = evaluateAssertionBudget({ files, budget });
    if (shrink && !before.invalid.length) {
      const smaller = shrinkBudget({ files, budget });
      writeFileSync(baselinePath, `${JSON.stringify(smaller, null, 2)}\n`);
      const after = evaluateAssertionBudget({ files, budget: smaller });
      for (const message of [...after.increases, ...after.stale, ...after.invalid]) console.error(message);
      if (after.increases.length || after.stale.length || after.invalid.length) process.exitCode = 1;
    } else {
      for (const message of [...before.increases, ...before.stale, ...before.invalid]) console.error(message);
      if (before.increases.length || before.stale.length || before.invalid.length) process.exitCode = 1;
    }
  }
}
