import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const root = fileURLToPath(new URL("../..", import.meta.url));
const exceptionsPath = "scripts/gates/type-assertions-exceptions.json";
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

function runGit(args, { cwd = root } = {}) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function canResolve(args, cwd, gitRunner) {
  try {
    gitRunner(args, { cwd });
    return true;
  } catch {
    return false;
  }
}

export function resolveBaseRevision({ base = process.env.BASE_REF || "main", cwd = root, gitRunner = runGit } = {}) {
  if (/^[0-9a-f]{40}$/iu.test(base)) {
    if (canResolve(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], cwd, gitRunner)) return base;
    throw new Error(`could not resolve base revision ${base}; fetch more history or set BASE_REF`);
  }
  const remote = `origin/${base}`;
  if (!canResolve(["rev-parse", "--verify", "--quiet", remote], cwd, gitRunner)) {
    try {
      gitRunner(["fetch", "--no-tags", "--depth=200", "origin", base], { cwd });
    } catch {
    }
    if (!canResolve(["rev-parse", "--verify", "--quiet", remote], cwd, gitRunner)) {
      throw new Error(`could not resolve base ref ${remote}; fetch it or set BASE_REF`);
    }
  }
  return remote;
}

export function mergeBaseRevision({ revision, cwd = root, gitRunner = runGit } = {}) {
  try {
    return String(gitRunner(["merge-base", revision, "HEAD"], { cwd })).trim() || revision;
  } catch (error) {
    if (canResolve(["merge-base", "--is-ancestor", revision, "HEAD"], cwd, gitRunner)) return revision;
    throw new Error(`could not determine the merge base of ${revision} and HEAD; fetch more history or set BASE_REF`, { cause: error });
  }
}

function baseBlobHash({ base, file, cwd, gitRunner }) {
  try {
    return String(gitRunner(["rev-parse", "--verify", "--quiet", `${base}:${file}`], { cwd })).trim();
  } catch {
    return "";
  }
}

function worktreeBlobHash(file, cwd, gitRunner) {
  try {
    return String(gitRunner(["hash-object", "--path", file, file], { cwd })).trim();
  } catch {
    return "";
  }
}

export function changedProductionTypeScript({ base, cwd = root, gitRunner = runGit } = {}) {
  const tracked = String(gitRunner(["diff", "--no-ext-diff", "--name-status", "-z", "-M", base, "--", "apps/web"], { cwd })).split("\0");
  const changed = new Map();
  const deleted = new Map();
  for (let index = 0; index < tracked.length;) {
    const status = tracked[index++];
    if (!status) continue;
    const source = tracked[index++];
    const destination = /^[RC]/u.test(status) ? tracked[index++] : undefined;
    if (status === "D") {
      if (isProductionTypeScript(source)) {
        const hash = baseBlobHash({ base, file: source, cwd, gitRunner });
        if (hash) deleted.set(hash, [...(deleted.get(hash) ?? []), source]);
      }
      continue;
    }
    if (!/^[MATR]/u.test(status)) continue;
    const file = status.startsWith("R") ? destination : source;
    if (!isProductionTypeScript(file)) continue;
    const from = status.startsWith("R") && isProductionTypeScript(source) ? source : file;
    changed.set(file, { path: file, basePath: from });
  }
  const untracked = String(gitRunner(["ls-files", "--others", "--exclude-standard", "-z", "--", "apps/web"], { cwd })).split("\0");
  for (const file of untracked) if (isProductionTypeScript(file)) changed.set(file, { path: file, basePath: file });
  return [...changed.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((entry) => {
    const content = readFileSync(path.join(cwd, entry.path), "utf8");
    const atBase = canResolve(["cat-file", "-e", `${base}:${entry.basePath}`], cwd, gitRunner);
    const candidates = atBase || !deleted.size ? undefined : deleted.get(worktreeBlobHash(entry.path, cwd, gitRunner));
    const movedFrom = candidates?.length ? candidates.shift() : undefined;
    const basePath = movedFrom ?? entry.basePath;
    const baseContent = movedFrom !== undefined || atBase
      ? String(gitRunner(["show", `${base}:${basePath}`], { cwd })) : undefined;
    return { path: entry.path, basePath, content, baseContent };
  });
}

function validException(entry) {
  return isProductionTypeScript(entry?.path) && kinds.includes(entry?.kind)
    && Number.isSafeInteger(entry?.count) && entry.count > 0
    && typeof entry?.reason === "string" && Boolean(entry.reason.trim());
}

function exceptionCount(exceptions, file, kind) {
  return exceptions.filter((entry) => validException(entry) && entry.path === file && entry.kind === kind)
    .reduce((total, entry) => total + entry.count, 0);
}

export function evaluateAssertionDelta({ changed, exceptions, baseExceptions }) {
  const increases = [];
  const notes = [];
  const invalid = [];
  for (const entry of exceptions) if (!validException(entry)) {
    invalid.push(`${entry?.path ?? "(missing path)"}: invalid ${entry?.kind ?? "(missing kind)"} exception (positive count and reason required)`);
  }
  for (const { path: file, content, basePath, baseContent } of changed) {
    const actual = cachedCounts(file, content);
    const before = baseContent === undefined ? null : cachedCounts(file, baseContent);
    for (const kind of kinds) {
      const baseCount = before?.[kind] ?? 0;
      const inherited = exceptionCount(baseExceptions, basePath, kind)
        + (basePath === file ? 0 : exceptionCount(baseExceptions, file, kind));
      const granted = Math.max(0, exceptionCount(exceptions, file, kind) - inherited);
      const allowed = baseCount + granted;
      if (actual[kind] > allowed) increases.push(`${file}: ${kind} ${actual[kind]} > ${allowed}; narrow the new use with a runtime guard or add a reviewed exception with a reason`);
      if (granted > Math.max(0, actual[kind] - baseCount)) notes.push(`${file}: ${kind} exception allows ${granted} but this change adds ${Math.max(0, actual[kind] - baseCount)}; remove or narrow it`);
    }
  }
  return { increases: increases.sort(), notes: notes.sort(), invalid: invalid.sort() };
}

function readExceptions(content) {
  try {
    const data = JSON.parse(content);
    return Array.isArray(data?.exceptions) ? data.exceptions : null;
  } catch {
    return null;
  }
}

export function assertionExceptions({ revision, cwd = root, gitRunner = runGit } = {}) {
  try {
    const content = revision === undefined
      ? readFileSync(path.join(cwd, exceptionsPath), "utf8")
      : String(gitRunner(["show", `${revision}:${exceptionsPath}`], { cwd }));
    return readExceptions(content);
  } catch {
    return null;
  }
}

function inventory(files, exceptions) {
  const result = {};
  for (const { path: file, content } of files) {
    const counts = Object.fromEntries(Object.entries(cachedCounts(file, content)).filter(([, count]) => count > 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    if (Object.keys(counts).length) result[file] = counts;
  }
  return { files: result, exceptions };
}

export function assertionDebtReport({ cwd = root, gitRunner = runGit } = {}) {
  const ref = resolveBaseRevision({ cwd, gitRunner });
  const base = mergeBaseRevision({ revision: ref, cwd, gitRunner });
  const changed = changedProductionTypeScript({ base, cwd, gitRunner });
  const current = assertionExceptions({ cwd, gitRunner });
  const result = evaluateAssertionDelta({ changed, exceptions: current ?? [], baseExceptions: assertionExceptions({ revision: base, cwd, gitRunner }) ?? [] });
  if (current === null) result.invalid.push(`${exceptionsPath}: invalid exceptions file (missing, unparsable, or exceptions must be an array)`);
  return { ref, base, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== "--report")) {
    console.error("usage: node scripts/gates/type-assertions.mjs [--report]");
    process.exitCode = 1;
  } else if (process.argv[2] === "--report") {
    const exceptions = assertionExceptions();
    if (exceptions === null) {
      console.error(`${exceptionsPath}: invalid exceptions file (missing, unparsable, or exceptions must be an array)`);
      process.exitCode = 1;
    } else console.log(JSON.stringify(inventory(repositoryFiles(), exceptions), null, 2));
  } else {
    try {
      const { ref, base, result } = assertionDebtReport();
      console.log(`## Type-assertion gate (base ${base === ref ? ref : `${ref} at ${base.slice(0, 12)}`})`);
      for (const note of result.notes) console.log(`- ${note}`);
      for (const finding of [...result.increases, ...result.invalid].sort()) console.error(finding);
      if (result.increases.length || result.invalid.length) process.exitCode = 1;
      else console.log("No production TypeScript file increased its assertion debt.");
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
