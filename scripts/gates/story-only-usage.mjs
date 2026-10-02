import { fileURLToPath, pathToFileURL } from "node:url";
import { designLane, explorationOnlyPaths, importGraph, nonProduction, readWebSources, source, ts } from "./knip-source.mjs";

const property = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : null;
const member = (object, name) => object?.properties?.find((item) => ts.isPropertyAssignment(item) && property(item.name) === name)?.initializer;
const object = (node) => node && ts.isObjectLiteralExpression(node) ? node : null;

function literals(node) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return [...literals(node.left), ...literals(node.right)];
  return [];
}

function exportsOf(ast) {
  const exported = new Set();
  for (const node of ast.statements) {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && !node.isTypeOnly) {
      for (const element of node.exportClause.elements) if (!element.isTypeOnly) exported.add(element.name.text);
    }
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name && ts.isIdentifier(node.name)) exported.add(node.name.text);
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) exported.add(declaration.name.text);
      if (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) exported.add("default");
    }
  }
  return exported;
}

export function evaluateStoryOnlyUsage(files) {
  const { bindings, importers } = importGraph(files);
  const explorationOnly = explorationOnlyPaths(files, importers);
  const storyOnly = (file) => designLane(file) || explorationOnly.has(file);
  const production = (file) => !nonProduction(file) && !explorationOnly.has(file);
  const parsed = new Map(files.map((file) => [file.path, source(file.path, file.content)]));
  const results = [];
  for (const [file, ast] of parsed) {
    if (!file.startsWith("components/") || nonProduction(file)) continue;
    const exported = exportsOf(ast);
    for (const name of exported) {
      const usedBy = [...bindings].filter(([, imports]) => imports.some((binding) => binding.target === file && (binding.imported === name || binding.imported === "*")))
        .map(([path]) => path).sort();
      if (usedBy.some(storyOnly) && usedBy.every((user) => !production(user))) results.push({ path: file, kind: "export", name, usedBy: usedBy.filter(storyOnly) });
    }
    const variantGroups = new Map();
    const defaultsByGroup = new Map();
    function findCva(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "cva") {
        const options = object(node.arguments[1]);
        const variants = object(member(options, "variants"));
        const defaults = object(member(options, "defaultVariants"));
        if (variants) for (const group of variants.properties) {
          if (!ts.isPropertyAssignment(group) || !object(group.initializer)) continue;
          const name = property(group.name);
          if (!name) continue;
          const values = variantGroups.get(name) ?? new Map();
          const defaultValues = defaultsByGroup.get(name) ?? new Set();
          for (const value of literals(member(defaults, name))) defaultValues.add(value);
          defaultsByGroup.set(name, defaultValues);
          for (const value of group.initializer.properties) if (ts.isPropertyAssignment(value)) {
            const key = property(value.name);
            if (key !== null && !values.has(key)) values.set(key, new Set());
          }
          variantGroups.set(name, values);
        }
      }
      ts.forEachChild(node, findCva);
    }
    findCva(ast);
    for (const [group, defaults] of defaultsByGroup) for (const value of defaults) variantGroups.get(group).delete(value);
    if (!variantGroups.size) continue;
    const productionUses = new Map([...variantGroups].map(([group]) => [group, new Set()]));
    const unknown = new Set();
    for (const [user, userAst] of parsed) {
      const local = new Set();
      if (user === file) {
        for (const name of exported) if (/^[A-Z]/.test(name)) local.add(name);
        for (const statement of ast.statements) {
          if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && /^[A-Z]/.test(statement.name.text)) local.add(statement.name.text);
          if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && /^[A-Z]/.test(declaration.name.text)) local.add(declaration.name.text);
        }
      }
      const variantFns = user === file ? new Set([...exported].filter((name) => name.endsWith("Variants"))) : new Set();
      for (const binding of bindings.get(user) ?? []) if (binding.target === file) {
        if (binding.typeOnly) continue;
        if (binding.imported === "*" && binding.local !== "*") continue;
        if (binding.imported === "*" || binding.imported === "default" || /^[A-Z]/.test(binding.imported)) local.add(binding.local);
        if (binding.imported.endsWith("Variants")) variantFns.add(binding.local);
      }
      function record(group, expression) {
        if (!variantGroups.has(group)) return;
        const values = literals(expression);
        if (user !== file && production(user) && !values.length) unknown.add(group);
        for (const value of values) {
          const uses = variantGroups.get(group).get(value);
          if (uses) {
            if (production(user)) productionUses.get(group).add(value);
            else if (storyOnly(user)) uses.add(user);
          }
        }
      }
      function visit(node) {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && local.has(node.tagName.text)) {
          for (const attr of node.attributes.properties) if (ts.isJsxAttribute(attr)) record(attr.name.text, attr.initializer);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && variantFns.has(node.expression.text) && object(node.arguments[0])) {
          for (const prop of node.arguments[0].properties) if (ts.isPropertyAssignment(prop)) record(property(prop.name), prop.initializer);
        }
        ts.forEachChild(node, visit);
      }
      visit(userAst);
    }
    for (const [group, values] of variantGroups) if (!unknown.has(group)) for (const [value, usedBy] of values) {
      if (usedBy.size && !productionUses.get(group).has(value)) results.push({ path: file, kind: "variant", name: `${group}=${value}`, usedBy: [...usedBy].sort() });
    }
  }
  return results.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export function formatStoryOnlyReport(entries) {
  return [`Story-only shared component usage: ${entries.length} finding(s)`, ...entries.map(({ path, kind, name, usedBy }) => `${path}: ${kind} ${name} ← ${usedBy.join(", ")}`)].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  console.log(formatStoryOnlyReport(evaluateStoryOnlyUsage(readWebSources())));
}
