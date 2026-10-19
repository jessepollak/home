import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { matchesGlob, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { trackedFiles } from "./unit-test-shards.mjs";

export const MANIFEST_PATH = "scripts/gates/unit-test-scope.json";
export const CATEGORY_IDS = ["money-math", "transaction-construction", "auth", "action-lifecycle", "route-contract-parser", "money-path-provider-failure", "money-record-integrity", "repository-gate", "review-board-runtime"];
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const webRoot = "apps/web";
const oneLine = (value) => typeof value === "string" && value.trim().length > 0 && !/[\r\n]/.test(value);
const literal = (value) => /^[A-Za-z0-9_-]+$/.test(value);
const relativePath = (value) => typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const scriptKinds = new Map([["tsx", "TSX"], ["jsx", "JSX"], ["mts", "MTS"], ["cts", "CTS"]]);
const caseRoots = new Set(["test", "it", "xtest", "xit"]);
const factoryMembers = new Set(["each", "if", "skipIf", "todoIf", "failingIf", "concurrentIf", "serialIf"]);
let typescriptModule = null;
const typescript = () => (typescriptModule ??= requireWeb("typescript"));

export function unitTestCases(file, content) {
  const ts = typescript();
  const scriptKind = scriptKinds.get(file.split(".").at(-1));
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind ? ts.ScriptKind[scriptKind] : ts.ScriptKind.TS);
  const implicitScope = { parent: null, bindings: new Map([...caseRoots].map((name) => [name, name])) };
  const moduleScope = { parent: implicitScope, bindings: new Map() };
  for (const statement of source.statements) {
    if (ts.isImportEqualsDeclaration(statement)) {
      const reference = statement.moduleReference;
      const external = ts.isExternalModuleReference(reference) && ts.isStringLiteralLike(reference.expression) ? reference.expression.text : null;
      moduleScope.bindings.set(statement.name.text, external === "bun:test" ? "namespace" : "other");
      continue;
    }
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bun = ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "bun:test";
    if (clause.name) moduleScope.bindings.set(clause.name.text, bun ? "namespace" : "other");
    const named = clause.namedBindings;
    if (!named) continue;
    if (ts.isNamespaceImport(named)) moduleScope.bindings.set(named.name.text, bun ? "namespace" : "other");
    else if (ts.isNamedImports(named)) for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      moduleScope.bindings.set(element.name.text, bun && caseRoots.has(imported) ? imported : "other");
    }
  }
  const chainKind = (node) => ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isExpressionWithTypeArguments(node);
  const unwrap = (expression) => {
    while (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isExpressionWithTypeArguments(expression)) expression = expression.expression;
    return expression;
  };
  const memberName = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
    return null;
  };
  const factoryCall = (node) => ts.isCallExpression(node) && factoryMembers.has(memberName(unwrap(node.expression)));
  const tracked = (kind) => kind !== null && kind !== "other";
  const lookup = (scope, name) => {
    for (let current = scope; current; current = current.parent) if (current.bindings.has(name)) return current.bindings.get(name);
    return null;
  };
  const unsupported = (reason) => new Error(`${file}: ${reason}; declare cases with test/it or move the suite into a protected category`);
  const moduleCall = (node) => ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") && node.arguments[0].text === "bun:test";
  const awaitedModule = (node) => {
    let child = node;
    for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent)) {
        if (parent.expression !== child) return false;
        continue;
      }
      return ts.isAwaitExpression(parent);
    }
    return false;
  };
  const resolve = (scope, expression) => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) return lookup(scope, node.text);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const member = memberName(node);
      if (ts.isIdentifier(node.expression) && node.expression.text === "globalThis" && lookup(scope, "globalThis") === null) {
        if (caseRoots.has(member)) return member;
        if (member === null) return "namespace-dynamic";
      }
      const object = resolve(scope, node.expression);
      if (object !== "namespace") return object;
      if (member === "default") return "namespace";
      if (caseRoots.has(member)) return member;
      return member === null ? "namespace-dynamic" : null;
    }
    if (ts.isAwaitExpression(node)) return resolve(scope, node.expression);
    if (moduleCall(node)) return node.expression.kind !== ts.SyntaxKind.ImportKeyword || awaitedModule(node) ? "namespace" : "namespace-dynamic";
    if (!ts.isCallExpression(node)) return null;
    const kind = resolve(scope, node.expression);
    if (factoryCall(node)) return kind;
    if (tracked(kind)) throw unsupported("unsupported invocation of a test call result");
    return null;
  };
  const declareName = (scope, name, kind = "other") => {
    if (ts.isIdentifier(name)) {
      if (!scope.bindings.has(name.text)) scope.bindings.set(name.text, kind);
      return;
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const element of name.elements) if (ts.isBindingElement(element)) declareName(scope, element.name, kind);
  };
  const setName = (scope, name, kind) => {
    if (ts.isIdentifier(name)) {
      scope.bindings.set(name.text, kind);
      return;
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const element of name.elements) if (ts.isBindingElement(element)) setName(scope, element.name, kind);
  };
  const bindingKey = (element) => {
    const key = element.propertyName ?? element.name;
    if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) return key.text;
    return ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression) ? key.expression.text : null;
  };
  const declarePattern = (scope, name, initializer) => {
    const object = initializer ? resolve(scope, initializer) : null;
    if (caseRoots.has(object)) throw unsupported("unsupported destructuring of a test binding");
    const namespace = object === "namespace" || object === "namespace-dynamic";
    for (const element of name.elements) {
      if (!ts.isBindingElement(element)) continue;
      if (namespace && element.dotDotDotToken) {
        setName(scope, element.name, "namespace");
        continue;
      }
      const member = bindingKey(element);
      if (namespace && (member === null || !ts.isIdentifier(element.name))) {
        setName(scope, element.name, "namespace-dynamic");
        continue;
      }
      setName(scope, element.name, object === "namespace" && caseRoots.has(member) ? member : "other");
    }
  };
  const declareArrayPattern = (scope, name, initializer) => {
    const elements = initializer && ts.isArrayLiteralExpression(initializer) ? initializer.elements : [];
    for (let index = 0; index < name.elements.length; index += 1) {
      const element = name.elements[index];
      if (!ts.isBindingElement(element)) continue;
      const source = element.dotDotDotToken ? null : elements[index];
      setName(scope, element.name, source ? aliasKind(scope, source) : "other");
    }
  };
  const aliasKind = (scope, initializer) => {
    if (!initializer) return "other";
    const kind = resolve(scope, initializer);
    return tracked(kind) ? kind : "other";
  };
  const declareVariable = (scope, name, initializer) => {
    if (ts.isObjectBindingPattern(name)) declarePattern(scope, name, initializer);
    else if (ts.isArrayBindingPattern(name)) declareArrayPattern(scope, name, initializer);
    else setName(scope, name, aliasKind(scope, initializer));
  };
  const declareListNames = (scope, functionScope, list) => {
    const variable = (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
    for (const declaration of list.declarations) declareName(variable ? functionScope : scope, declaration.name);
  };
  const resolveListAliases = (scope, list) => {
    const constant = (list.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of list.declarations) {
      if (constant) declareVariable(scope, declaration.name, declaration.initializer);
      else if (declaration.initializer && tracked(resolve(scope, declaration.initializer))) throw unsupported("unsupported mutable alias of a test binding");
    }
  };
  const declareStatements = (scope, statements, functionScope) => {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) declareListNames(scope, functionScope, statement.declarationList);
      else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) declareName(scope, statement.name);
    }
    for (const statement of statements) if (ts.isVariableStatement(statement)) resolveListAliases(scope, statement.declarationList);
  };
  const functionLike = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
  const hoistVars = (scope, node) => {
    if (functionLike(node) || ts.isClassStaticBlockDeclaration(node)) return;
    if (ts.isVariableDeclarationList(node) && (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) {
      for (const declaration of node.declarations) declareName(scope, declaration.name);
      return;
    }
    ts.forEachChild(node, (child) => hoistVars(scope, child));
  };
  const scopes = new Map([[source, moduleScope]]);
  const build = (node, scope, functionScope) => {
    let current = scope;
    let currentFunction = functionScope;
    if (functionLike(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      currentFunction = current;
      hoistVars(current, node.body ?? node);
      if (node.name && ts.isIdentifier(node.name)) {
        if (ts.isFunctionExpression(node)) declareName(current, node.name);
        else if (ts.isFunctionDeclaration(node)) declareName(scope, node.name);
      }
      for (const parameter of node.parameters ?? []) {
        declareName(current, parameter.name);
        if (parameter.initializer && tracked(resolve(scope, parameter.initializer))) throw unsupported("unsupported tracked parameter default");
      }
    } else if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      if (node.name && ts.isIdentifier(node.name)) declareName(ts.isClassExpression(node) ? current : scope, node.name);
    } else if (ts.isClassStaticBlockDeclaration(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      currentFunction = current;
      hoistVars(current, node.body);
    } else if (ts.isEnumDeclaration(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      for (const member of node.members) if (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) current.bindings.set(member.name.text, "other");
    } else if (ts.isSourceFile(node)) {
      current = scopes.get(node);
      currentFunction = moduleScope;
      hoistVars(currentFunction, node);
      declareStatements(current, node.statements, currentFunction);
    } else if (ts.isBlock(node) || ts.isModuleBlock(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      declareStatements(current, node.statements, functionScope);
    } else if (ts.isCaseBlock(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      for (const clause of node.clauses) declareStatements(current, clause.statements ?? [], functionScope);
    } else if (ts.isCatchClause(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      if (node.variableDeclaration) declareName(current, node.variableDeclaration.name);
    } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      current = { parent: scope, bindings: new Map() };
      scopes.set(node, current);
      const initializer = node.initializer;
      if (initializer && ts.isVariableDeclarationList(initializer)) {
        declareListNames(current, functionScope, initializer);
        resolveListAliases(current, initializer);
      }
    }
    ts.forEachChild(node, (child) => build(child, current, currentFunction));
  };
  build(source, moduleScope, moduleScope);
  const reference = (node) => {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) return parent.expression === node;
    if (ts.isBindingElement(parent)) return parent.name !== node && parent.propertyName !== node;
    if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isEnumDeclaration(parent) || ts.isEnumMember(parent) || ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isModuleDeclaration(parent) || ts.isTypeParameterDeclaration(parent)) return parent.name !== node;
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent) || ts.isImportEqualsDeclaration(parent)) return false;
    if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isJsxAttribute(parent)) return parent.name !== node;
    if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
    if (ts.isTypeNode(parent)) return false;
    return true;
  };
  const modeledReference = (node) => {
    let child = node;
    for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (chainKind(parent) && parent.expression === child) {
        if (ts.isCallExpression(parent)) return true;
        continue;
      }
      if (ts.isVariableDeclaration(parent) && parent.initializer === child && ts.isVariableDeclarationList(parent.parent) && (parent.parent.flags & ts.NodeFlags.Const) !== 0) return true;
      return false;
    }
    return false;
  };
  const invokeMembers = new Set(["call", "apply", "bind"]);
  const modeledModuleLoad = (node) => {
    let child = node;
    for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent)) {
        if (parent.expression !== child) return false;
        continue;
      }
      if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) return parent.expression === child && caseRoots.has(memberName(parent));
      if (ts.isVariableDeclaration(parent)) return parent.initializer === child && ts.isVariableDeclarationList(parent.parent) && (parent.parent.flags & ts.NodeFlags.Const) !== 0;
      return false;
    }
    return false;
  };
  const names = [];
  const visit = (node, scope) => {
    const current = scopes.get(node) ?? scope;
    if (moduleCall(node) && !modeledModuleLoad(node)) throw unsupported("unsupported bun:test module load form");
    if (ts.isCallExpression(node) && !factoryCall(node)) {
      const kind = resolve(current, node.expression);
      if (kind === "namespace-dynamic") throw unsupported("unsupported dynamic member call on a bun:test namespace import");
      if (caseRoots.has(kind) && invokeMembers.has(memberName(unwrap(node.expression)))) throw unsupported("unsupported invocation form on a test binding");
      if (caseRoots.has(kind)) {
        const [argument] = node.arguments;
        names.push(!argument ? "" : ts.isStringLiteralLike(argument) ? argument.text : argument.getText().replace(/\s+/g, " ").trim());
      }
    } else if (ts.isIdentifier(node) && reference(node)) {
      const kind = lookup(current, node.text);
      if (tracked(kind) && !modeledReference(node)) throw unsupported(`unsupported use of the ${node.text} test binding`);
    }
    ts.forEachChild(node, (child) => visit(child, current));
  };
  visit(source, moduleScope);
  return names;
}

function addedCases(baseCases, headCases) {
  const remaining = new Map();
  for (const name of baseCases) remaining.set(name, (remaining.get(name) ?? 0) + 1);
  const added = [];
  for (const name of headCases) {
    const count = remaining.get(name) ?? 0;
    if (count > 0) remaining.set(name, count - 1);
    else added.push(name);
  }
  return added;
}

function readBaseContents(root, revision, paths) {
  const contents = new Map();
  if (!paths.length) return contents;
  const input = paths.map((path) => `${revision}:${webRoot}/${path}\0`).join("");
  const output = execFileSync("git", ["cat-file", "--batch", "-Z"], { cwd: root, input, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  let offset = 0;
  for (const path of paths) {
    const end = output.indexOf(0, offset);
    if (end === -1) throw new Error("Malformed git cat-file output");
    const header = output.toString("utf8", offset, end);
    offset = end + 1;
    const match = /^[a-f0-9]{40,64} blob (\d+)$/.exec(header);
    if (!match) {
      if (!header.endsWith(" missing")) throw new Error(`Unexpected git cat-file output: ${header}`);
      continue;
    }
    const size = Number(match[1]);
    contents.set(path, output.toString("utf8", offset, offset + size));
    offset += size + 1;
  }
  return contents;
}

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

export function evaluateUnitTestScope({ files, manifest, reference = null, baseContents = new Map(), headContents = new Map() }) {
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
  if (reference) {
    const basePaths = new Set(reference);
    for (const entry of Array.isArray(manifest?.grandfathered) ? manifest.grandfathered : []) {
      const { path } = entry ?? {};
      if (!relativePath(path) || !grandfathered.has(path) || !files.includes(path) || !basePaths.has(path)) continue;
      const baseContent = baseContents.get(path);
      if (baseContent === undefined) throw new Error(`${path}: grandfathered in the base manifest but missing from the merge base; merge the base branch and rerun so its cases can be compared`);
      const headContent = headContents.get(path);
      if (headContent === undefined || headContent === baseContent) continue;
      const added = addedCases(unitTestCases(path, baseContent), unitTestCases(path, headContent));
      if (!added.length) continue;
      const names = added.map((name) => JSON.stringify(name)).join(", ");
      findings.push(added.length === 1
        ? `${path}: new unit test case ${names} in a grandfathered file; move it into a protected category (docs/architecture.md#test-policy), cover it with a story, or delete it`
        : `${path}: new unit test cases ${names} in a grandfathered file; move each into a protected category (docs/architecture.md#test-policy), cover it with a story, or delete it`);
    }
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
  const paths = manifest.grandfathered.map((entry) => entry.path);
  return { paths, contents: readBaseContents(root, git(["merge-base", base, "HEAD"]).trim(), paths) };
}

export function checkUnitTestScope({ root = repositoryRoot, baseRef = process.env.BASE_REF || "main" } = {}) {
  const web = join(root, webRoot);
  const files = trackedFiles(web).filter((file) => existsSync(join(web, file)));
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  const base = readBaseGrandfathered(root, baseRef);
  const grandfathered = new Set((Array.isArray(manifest?.grandfathered) ? manifest.grandfathered : []).map((entry) => entry?.path));
  const headContents = new Map();
  for (const file of files) if (grandfathered.has(file)) headContents.set(file, readFileSync(join(web, file), "utf8"));
  return evaluateUnitTestScope({ files, manifest, reference: base?.paths ?? null, baseContents: base?.contents, headContents });
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
