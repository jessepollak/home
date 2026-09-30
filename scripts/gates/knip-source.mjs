import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const requireWeb = createRequire(path.join(root, "apps/web/package.json"));
export const ts = requireWeb("typescript");
const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

export function readWebSources() {
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: root })
    .toString().split("\0").filter((file) => extensions.some((ext) => file.endsWith(ext)) && existsSync(path.join(root, file)));
  return paths.map((file) => ({ path: file.slice("apps/web/".length), content: readFileSync(path.join(root, file), "utf8") }));
}

export function designLane(file) {
  return /(?:^|\/)explorations\//.test(file) || /(?:^|\/)[^/]+\.stories\.[^/]+$/.test(file)
    || /^(?:stories|\.storybook)\//.test(file);
}

export function nonProduction(file) {
  return designLane(file) || /(?:^|\/)(?:tests|testing)\//.test(file) || /\.test\.[^/]+$/.test(file);
}

export function explorationOnlyPaths(files, importers) {
  const production = new Set(files.map((file) => file.path).filter((file) => !nonProduction(file)));
  const indices = new Map();
  const lowlinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  function visit(file) {
    const index = indices.size;
    indices.set(file, index);
    lowlinks.set(file, index);
    stack.push(file);
    onStack.add(file);
    for (const user of importers.get(file) ?? []) {
      if (!production.has(user)) continue;
      if (!indices.has(user)) {
        visit(user);
        lowlinks.set(file, Math.min(lowlinks.get(file), lowlinks.get(user)));
      } else if (onStack.has(user)) {
        lowlinks.set(file, Math.min(lowlinks.get(file), indices.get(user)));
      }
    }
    if (lowlinks.get(file) === indices.get(file)) {
      const members = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        members.push(member);
      } while (member !== file);
      components.push(members);
    }
  }
  for (const file of production) if (!indices.has(file)) visit(file);
  const componentOf = new Map(components.flatMap((members, index) => members.map((file) => [file, index])));
  const externalUsers = components.map((members, index) => new Set(members.flatMap((file) =>
    [...(importers.get(file) ?? [])].filter((user) => componentOf.get(user) !== index))));
  const flaggedComponents = new Set();
  let changed;
  do {
    changed = false;
    for (const [index, users] of externalUsers.entries()) {
      if (flaggedComponents.has(index) || !users.size) continue;
      if (![...users].some((user) => designLane(user) || flaggedComponents.has(componentOf.get(user)))) continue;
      if (![...users].every((user) => nonProduction(user) || flaggedComponents.has(componentOf.get(user)))) continue;
      flaggedComponents.add(index);
      changed = true;
    }
  } while (changed);
  return new Set(components.flatMap((members, index) => flaggedComponents.has(index) ? members : []));
}

export function source(file, content) {
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, /\.[cm]?[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function resolveImport(from, specifier, paths) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const base = specifier.startsWith("@/") ? specifier.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const direct = [base, ...extensions.map((ext) => base + ext), ...extensions.map((ext) => base + "/index" + ext)];
  const substitutions = { ".js": [".ts", ".tsx"], ".jsx": [".tsx", ".ts"], ".mjs": [".mts"], ".cjs": [".cts"] };
  const ext = path.posix.extname(base);
  return [...(substitutions[ext] ?? []).map((replacement) => base.slice(0, -ext.length) + replacement), ...direct].find((candidate) => paths.has(candidate)) ?? null;
}

function staticSpecifiers(node) {
  if (ts.isParenthesizedExpression(node)) return staticSpecifiers(node.expression);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) return staticSpecifiers(node.expression);
  if (ts.isLiteralTypeNode(node)) return staticSpecifiers(node.literal);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticSpecifiers(node.left);
    const right = staticSpecifiers(node.right);
    return left.flatMap((prefix) => right.map((suffix) => prefix + suffix));
  }
  if (ts.isConditionalExpression(node)) return [...staticSpecifiers(node.whenTrue), ...staticSpecifiers(node.whenFalse)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    return [...staticSpecifiers(node.left), ...staticSpecifiers(node.right)];
  }
  if (!ts.isTemplateExpression(node) && !ts.isTemplateLiteralTypeNode(node)) return [];
  return node.templateSpans.reduce((values, span) => {
    const alternatives = staticSpecifiers(span.expression ?? span.type);
    return values.flatMap((prefix) => alternatives.map((alternative) => prefix + alternative + span.literal.text));
  }, [node.head.text]);
}

export function importGraph(files) {
  const paths = new Set(files.map((file) => file.path));
  const importers = new Map(files.map((file) => [file.path, new Set()]));
  const bindings = new Map(files.map((file) => [file.path, []]));
  for (const file of files) {
    const ast = source(file.path, file.content);
    function add(specifier, names = []) {
      const target = resolveImport(file.path, specifier, paths);
      if (!target) return;
      importers.get(target).add(file.path);
      for (const [imported, local] of names) bindings.get(file.path).push({ target, imported, local });
    }
    function visit(node) {
      for (const doc of node.jsDoc ?? []) visit(doc);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const names = [];
        if (clause?.name) names.push(["default", clause.name.text]);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push(["*", clause.namedBindings.name.text]);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) names.push([element.propertyName?.text ?? element.name.text, element.name.text]);
        }
        add(node.moduleSpecifier.text, names);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const names = node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map((el) => [el.propertyName?.text ?? el.name.text, el.name.text]) : [["*", "*"]];
        add(node.moduleSpecifier.text, names);
      } else if (ts.isImportTypeNode(node)) {
        for (const specifier of staticSpecifiers(node.argument)) add(specifier, [["*", "*"]]);
      } else if (ts.isCallExpression(node) && node.arguments.length && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        for (const specifier of staticSpecifiers(node.arguments[0])) add(specifier, [["*", "*"]]);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return { importers, bindings };
}

export const webRoot = path.join(root, "apps/web");
