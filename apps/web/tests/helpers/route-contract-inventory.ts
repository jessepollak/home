import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

type MethodEntry = { contracts?: string[]; allowance?: { kind: string; reason: string } };
type RouteEntry = { contracts?: string[]; exempt?: { kind: string; reason: string }; client?: string; methods?: Record<string, MethodEntry> };
type AppRouteEntry = { exempt?: { kind: string; reason: string }; contracts?: string[] };
type Manifest = {
  routes: Record<string, RouteEntry>;
  appRoutes: Record<string, AppRouteEntry>;
  baseline: {
    routesWithoutVersionedParser: Record<string, string[]>;
    unversionedContracts: string[];
    parserlessContracts: string[];
    handlerUnlinked: Record<string, string[]>;
    clientUnlinked: Record<string, string[]>;
    undeclaredHandlerContracts: Record<string, string[]>;
  };
};
type Violation = { code: string; path: string; detail: string };

const versionPattern = /^[A-Z][A-Z0-9_]*_VERSION$/;
const parserPattern = /^(parse|read|assert)[A-Z]/;
const contractPattern = /(?:^|\/)[^/]*contract[^/]*\.ts$|\/contracts\/[^/]+\.ts$/;
const testPattern = /(?:\.test|\.spec)\.(?:ts|tsx|js|jsx)$/;
const clientDependencyPattern = /^(?:client|components|shared)\//;
const privateFolderPattern = /(?:^|\/)_[^/]*(?=\/)/;
const exemptionKinds = ["webhook", "machine", "redirect", "status", "document"];
const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const allowanceKinds = ["unversioned-compatibility"];

type ExportedValue = { callable: boolean; version: boolean };
type ExportLink = { name: string; original: string; specifier?: string };

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}

function literalPropertyKey(node: ts.Node): string | undefined {
  return ts.isNumericLiteral(node) ? String(Number(node.text))
    : ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function bindingNames(name: ts.BindingName): string[] {
  return ts.isIdentifier(name) ? [name.text]
    : name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
}

function inspect(source: string, path: string) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : path.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const modules: { specifier: string; runtime: boolean }[] = [];
  const urls: string[] = [];
  const localCallables = new Set<string>();
  const localAliases = new Map<string, string>();
  const localVersions = new Set<string>();
  const versionRefs = new Set<string>();
  const shadowedNames = new Set<string>();
  const functionDeclarations = new Map<string, ts.FunctionDeclaration>();
  const variableInitializers = new Map<string, ts.Expression>();
  const destructuredInitializers = new Map<string, { initializer: ts.Expression; property?: string }>();
  const directExports = new Set<string>();
  const exportLinks: ExportLink[] = [];
  const stars: string[] = [];
  const importedNames = new Map<string, { specifier: string; original: string }>();
  const runtimeBindings: { specifier: string; original?: string; namespace?: string }[] = [];
  const namespaceImports = new Map<string, string>();
  const referencedMembers = new Map<string, Set<string>>();
  let propertyVersioned = false;
  let defaultParser = false;
  const nameOf = (name: ts.PropertyName) => ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
  const literalVersion = (node: ts.Expression | undefined) => {
    if (!node) return false;
    const value = unwrap(node);
    return ts.isStringLiteral(value) || ts.isNumericLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value);
  };
  const schemaVersionArgument = (node: ts.Expression): ts.Expression | undefined => {
    const value = unwrap(node);
    return ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && ts.isIdentifier(value.expression.expression) &&
      value.expression.expression.text === "z" && value.expression.name.text === "literal" && value.arguments.length === 1
      ? value.arguments[0] : undefined;
  };
  const exported = (node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }) =>
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const moduleScope = (node: ts.Node) => node.parent === file;
  const shadowParameters = (node: ts.Node) => {
    if (!ts.isFunctionDeclaration(node) && !ts.isFunctionExpression(node) && !ts.isArrowFunction(node) && !ts.isMethodDeclaration(node)) return;
    for (const parameter of node.parameters) for (const name of bindingNames(parameter.name)) shadowedNames.add(name);
  };
  const isDeferred = (node: ts.FunctionLikeDeclaration) =>
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0 ||
    !!(node as { asteriskToken?: ts.Node }).asteriskToken;
  const hasImplementation = (node: ts.FunctionLikeDeclaration) =>
    !!(node as { body?: ts.ConciseBody }).body &&
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient) === 0;
  const directValue = (node: ts.Node) =>
    ts.isVariableStatement(node) || ts.isVariableDeclarationList(node) || ts.isVariableDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isExportAssignment(node) ||
    ts.isObjectLiteralExpression(node) || ts.isTypeLiteralNode(node) || ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isParenthesizedTypeNode(node) ||
    ts.isIntersectionTypeNode(node);
  const satisfiesConstraint = (node: ts.Node, child: ts.Node) => ts.isSatisfiesExpression(node) && node.type === child;
  const versionScope = (node: ts.Node) => exported(node) &&
    (!ts.isFunctionDeclaration(node) || (!!node.name && parserPattern.test(node.name.text)));
  const visit = (node: ts.Node, exportedScope = false) => {
    const inExport = exportedScope || versionScope(node);
    shadowParameters(node);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const runtime = !clause || (!clause.isTypeOnly && (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings) ||
        !!clause.name || clause.namedBindings.elements.some((element) => !element.isTypeOnly)));
      modules.push({ specifier: node.moduleSpecifier.text, runtime });
      if (clause && !clause.isTypeOnly) {
        if (clause.name) {
          runtimeBindings.push({ specifier: node.moduleSpecifier.text, original: "default" });
          importedNames.set(clause.name.text, { specifier: node.moduleSpecifier.text, original: "default" });
        }
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          runtimeBindings.push({ specifier: node.moduleSpecifier.text, namespace: clause.namedBindings.name.text });
          namespaceImports.set(clause.namedBindings.name.text, node.moduleSpecifier.text);
        }
      }
      if (clause && !clause.isTypeOnly) {
        for (const element of clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : []) {
          if (!element.isTypeOnly) importedNames.set(element.name.text, { specifier: node.moduleSpecifier.text, original: element.propertyName?.text ?? element.name.text });
          if (!element.isTypeOnly) runtimeBindings.push({ specifier: node.moduleSpecifier.text, original: element.propertyName?.text ?? element.name.text });
        }
      }
    }
    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      if (specifier) modules.push({ specifier, runtime: !node.isTypeOnly && (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some((element) => !element.isTypeOnly)) });
      if (!node.isTypeOnly) {
        if (!node.exportClause && specifier) stars.push(specifier);
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            if (!element.isTypeOnly) exportLinks.push({ name: element.name.text, original: element.propertyName?.text ?? element.name.text, specifier });
          }
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      modules.push({ specifier: node.moduleReference.expression.text, runtime: !node.isTypeOnly });
    }
    const dynamicImport = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length >= 1 ? unwrap(node.arguments[0]) : undefined;
    if (dynamicImport && ts.isStringLiteralLike(dynamicImport)) {
      modules.push({ specifier: dynamicImport.text, runtime: true });
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const members = referencedMembers.get(node.expression.text) ?? new Set<string>();
      members.add(node.name.text);
      referencedMembers.set(node.expression.text, members);
    }
    if (ts.isFunctionDeclaration(node) && moduleScope(node)) {
      const isDefault = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      for (const name of [node.name?.text, ...(isDefault ? ["default"] : [])]) {
        if (!name) continue;
        if (!isDeferred(node) && hasImplementation(node)) localCallables.add(name);
        functionDeclarations.set(name, node);
        if (exported(node)) directExports.add(name);
      }
      if (isDefault && !isDeferred(node) && hasImplementation(node) && node.name && parserPattern.test(node.name.text)) defaultParser = true;
    }
    if (ts.isFunctionDeclaration(node) && node.name && !moduleScope(node)) shadowedNames.add(node.name.text);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!moduleScope(node)) {
          for (const name of bindingNames(declaration.name)) shadowedNames.add(name);
          continue;
        }
        if (!ts.isIdentifier(declaration.name)) {
          if (exported(node)) for (const name of bindingNames(declaration.name)) {
            directExports.add(name);
            if (declaration.initializer) {
              const element = ts.isObjectBindingPattern(declaration.name)
                ? declaration.name.elements.find((element) => ts.isIdentifier(element.name) && element.name.text === name && !element.dotDotDotToken)
                : undefined;
              destructuredInitializers.set(name, { initializer: declaration.initializer, property: element?.propertyName ? ts.isNumericLiteral(element.propertyName) ? literalPropertyKey(element.propertyName) : nameOf(element.propertyName) : element ? name : undefined });
            }
          }
          continue;
        }
        const isConst = (node.declarationList.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const;
        if (declaration.initializer && isConst) {
          variableInitializers.set(declaration.name.text, declaration.initializer);
          if (ts.isIdentifier(declaration.initializer)) localAliases.set(declaration.name.text, declaration.initializer.text);
        }
        if (versionPattern.test(declaration.name.text) && isConst && literalVersion(declaration.initializer)) localVersions.add(declaration.name.text);
        if (exported(node)) directExports.add(declaration.name.text);
      }
    }
    if (ts.isPropertySignature(node) && inExport && nameOf(node.name) === "version" && node.type) {
      if (ts.isLiteralTypeNode(node.type) && (ts.isStringLiteral(node.type.literal) || ts.isNumericLiteral(node.type.literal))) propertyVersioned = true;
      else if (ts.isTypeQueryNode(node.type) && ts.isIdentifier(node.type.exprName) && versionPattern.test(node.type.exprName.text)) versionRefs.add(node.type.exprName.text);
    }
    if (ts.isPropertyAssignment(node) && inExport && nameOf(node.name) === "version") {
      const candidate = unwrap(schemaVersionArgument(node.initializer) ?? node.initializer);
      if (literalVersion(candidate)) propertyVersioned = true;
      else if (ts.isIdentifier(candidate) && versionPattern.test(candidate.text)) versionRefs.add(candidate.text);
    }
    if (ts.isExportAssignment(node) && !node.isExportEquals && moduleScope(node)) {
      directExports.add("default");
      variableInitializers.set("default", unwrap(node.expression));
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) urls.push(node.text);
    if (ts.isTemplateExpression(node)) urls.push(node.head.text + node.templateSpans.map((span) => "${}" + span.literal.text).join(""));
    ts.forEachChild(node, (child) => visit(child, inExport && directValue(node) && !satisfiesConstraint(node, child)));
  };
  visit(file);
  function functionBody(name: string): ts.ConciseBody | undefined {
    if (shadowedNames.has(name)) return undefined;
    const declaration = functionDeclarations.get(name);
    if (declaration) return declaration.body;
    const initializer = variableInitializers.get(name);
    const value = initializer && unwrap(initializer);
    return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value.body : undefined;
  }
  function deferred(name: string): boolean {
    const declaration = functionDeclarations.get(name);
    if (declaration) return isDeferred(declaration);
    const initializer = variableInitializers.get(name);
    const value = initializer && unwrap(initializer);
    return !!value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && isDeferred(value);
  }
  function callableValue(expression: ts.Expression, seen: Set<string>): boolean {
    const node = unwrap(expression);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return !isDeferred(node);
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text) || shadowedNames.has(node.text)) return false;
      const next = new Set(seen).add(node.text);
      const initializer = variableInitializers.get(node.text);
      const declaration = functionDeclarations.get(node.text);
      return initializer ? callableValue(initializer, next) : !!declaration && !deferred(node.text) && hasImplementation(declaration);
    }
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrap(node.expression);
    if (!ts.isIdentifier(callee) || seen.has(callee.text) || shadowedNames.has(callee.text)) return false;
    const body = functionBody(callee.text);
    return body && !deferred(callee.text) ? returnsCallable(body, new Set(seen).add(callee.text)) : false;
  }
  function terminatesCallable(statement: ts.Statement, seen: Set<string>): boolean {
    if (ts.isReturnStatement(statement)) return !!statement.expression && callableValue(statement.expression, seen);
    if (ts.isBlock(statement)) return statement.statements.length > 0 && terminatesCallable(statement.statements[statement.statements.length - 1], seen);
    if (ts.isIfStatement(statement)) return !!statement.elseStatement && terminatesCallable(statement.thenStatement, seen) && terminatesCallable(statement.elseStatement, seen);
    return false;
  }
  function returnsCallable(body: ts.ConciseBody, seen: Set<string>): boolean {
    if (!ts.isBlock(body)) return callableValue(body, seen);
    let returned = false;
    let valid = true;
    const scan = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
      if (ts.isReturnStatement(node)) {
        if (node.expression && callableValue(node.expression, seen)) returned = true;
        else valid = false;
        return;
      }
      ts.forEachChild(node, scan);
    };
    scan(body);
    return returned && valid && terminatesCallable(body, seen);
  }
  for (const [name, initializer] of variableInitializers) if (callableValue(initializer, new Set())) localCallables.add(name);
  return { modules, urls, localCallables, localAliases, localVersions, versionRefs, shadowedNames, functionDeclarations, variableInitializers, destructuredInitializers, directExports, exportLinks, stars, importedNames, runtimeBindings, namespaceImports, referencedMembers, defaultParser, propertyVersioned };
}

const routeGroupPattern = /^\(.+\)$/;

function routeSegments(path: string): string[] {
  return path.replace(/(?:^|\/)route\.(?:ts|tsx|js|jsx)$/, "").split("/").filter(Boolean).filter((part) => !routeGroupPattern.test(part));
}

function urlSegments(literal: string): string[] | undefined {
  const match = /^(?:\$\{\}|https?:\/\/[^/?#]+)?(\/api(?:\/[^?#]*)?)/.exec(literal);
  if (!match) return undefined;
  return match[1].replace(/\/+$/, "").split("/").slice(2);
}

function resolvesTo(path: string, segments: string[]): boolean {
  const route = routeSegments(path);
  let index = 0;
  for (const part of route) {
    if (/^\[\[\.\.\..+\]\]$/.test(part)) return route[route.length - 1] === part;
    if (/^\[\.\.\..+\]$/.test(part)) return index < segments.length && segments.slice(index).every(Boolean);
    if (!segments[index]) return false;
    if (!/^\[.+\]$/.test(part) && part !== segments[index]) return false;
    index++;
  }
  return index === segments.length;
}

function routePriority(a: string, b: string): number {
  const rank = (segment: string) => segment.startsWith("[[...") || segment.startsWith("[...") ? 1 : segment.startsWith("[") ? 2 : 3;
  const left = routeSegments(a);
  const right = routeSegments(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (rank(left[i]) !== rank(right[i])) return rank(right[i]) - rank(left[i]);
  }
  return right.length - left.length || a.localeCompare(b);
}

export function inventoryRouteContracts({ root, manifest }: { root: string; manifest: Manifest }): Violation[] {
  const violations: Violation[] = [];
  const report = (code: string, path: string, detail: string) => violations.push({ code, path, detail });
  const files = (pattern: string, dot = false) => [...new Bun.Glob(pattern).scanSync({ cwd: root, dot })].sort();
  const routeFiles = (directory: string) =>
    ["ts", "tsx", "js", "jsx"].flatMap((extension) => files(`${directory}/**/route.${extension}`, true))
      .filter((path) => !privateFolderPattern.test(path));
  const routes = new Set(routeFiles("app/api").map((path) => path.slice("app/api/".length)));
  const appRoutes = new Set(routeFiles("app").filter((path) => !path.startsWith("app/api/")));
  const contracts = new Set(files("shared/**/*.ts").filter((path) => !testPattern.test(path) && contractPattern.test(path)));
  const clientFiles = ["client", "components", "app"].flatMap((directory) =>
    files(`${directory}/**/*.{ts,tsx,js,jsx}`).filter((path) =>
      !testPattern.test(path) && !path.startsWith("app/api/") && !path.includes("/explorations/") && !/\.stories(?:\.|$)/.test(path)),
  );
  const dependencies = new Map<string, Set<string>>();
  const runtimeDependencies = new Map<string, Set<string>>();
  const inspected = new Map<string, ReturnType<typeof inspect>>();
  const sourceInfo = (path: string) => {
    let result = inspected.get(path);
    if (!result) {
      result = inspect(readFileSync(join(root, path), "utf8"), path);
      inspected.set(path, result);
    }
    return result;
  };
  const resolveModule = (path: string, specifier: string): string | undefined => {
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return undefined;
    const target = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(root, dirname(path), specifier);
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.jsx`,
      join(target, "index.ts"), join(target, "index.tsx"), join(target, "index.js"), join(target, "index.jsx")]) {
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return relative(root, candidate).replaceAll("\\", "/");
    }
    return undefined;
  };
  const importPaths = (path: string, runtimeOnly = false): Set<string> => {
    const cache = runtimeOnly ? runtimeDependencies : dependencies;
    const cached = cache.get(path);
    if (cached) return cached;
    const result = new Set<string>();
    cache.set(path, result);
    for (const { specifier, runtime } of sourceInfo(path).modules) {
      if (runtimeOnly && !runtime) continue;
      const target = resolveModule(path, specifier);
      if (target) result.add(target);
    }
    return result;
  };
  const exportedValues = (path: string, visiting = new Set<string>()): Map<string, ExportedValue> => {
    if (visiting.has(path)) return new Map();
    visiting.add(path);
    const info = sourceInfo(path);
    const values = new Map<string, ExportedValue>();
    const imported = (original: string, specifier: string) => {
      const target = resolveModule(path, specifier);
      return target ? exportedValues(target, visiting).get(original) : undefined;
    };
    const local = (original: string, seen = new Set<string>()): ExportedValue => {
      if (seen.has(original)) return { callable: false, version: false };
      seen.add(original);
      const link = info.importedNames.get(original);
      if (link) return imported(link.original, link.specifier) ?? { callable: false, version: false };
      const alias = info.localAliases.get(original);
      return { callable: info.localCallables.has(original) || (alias ? local(alias, seen).callable : false), version: info.localVersions.has(original) };
    };
    for (const name of info.directExports) values.set(name, local(name));
    for (const link of info.exportLinks) values.set(link.name, link.specifier ? imported(link.original, link.specifier) ?? { callable: false, version: false } : local(link.original));
    for (const specifier of info.stars) {
      const target = resolveModule(path, specifier);
      if (target) for (const [name, value] of exportedValues(target, visiting)) if (!values.has(name)) values.set(name, value);
    }
    visiting.delete(path);
    return values;
  };
  const referencedContracts = (path: string, method: string): { contracts: Set<string>; limited: boolean } => {
    const result = new Set<string>();
    let limited = false;
    const contractOrigin = (path: string, name: string, visiting = new Set<string>()): string | undefined => {
      const key = `${path}\u0000${name}`;
      if (visiting.has(key)) return undefined;
      if (visiting.size >= 1_000) {
        limited = true;
        return undefined;
      }
      visiting.add(key);
      if (contracts.has(path)) return exportedValues(path).has(name) ? path : undefined;
      const info = sourceInfo(path);
      const link = info.importedNames.get(name) ?? info.exportLinks.find((candidate) => candidate.name === name);
      if (link) {
        const target = link.specifier ? resolveModule(path, link.specifier) : path;
        return target ? contractOrigin(target, link.original, visiting) : undefined;
      }
      for (const specifier of info.stars) {
        const target = resolveModule(path, specifier);
        const origin = target && contractOrigin(target, name, visiting);
        if (origin) return origin;
      }
      return undefined;
    };
    type Implementation = { path: string; node: ts.Node; selected?: boolean };
    const resolvingImplementations = new Set<string>();
    const implementationValue = (path: string, name: string, visiting = new Set<string>()): Implementation | undefined => {
      const key = `${path}\u0000${name}`;
      if (resolvingImplementations.has(key)) return undefined;
      if (resolvingImplementations.size >= 1_000) {
        limited = true;
        return undefined;
      }
      resolvingImplementations.add(key);
      try {
        return resolveImplementationValue(path, name, visiting);
      } finally {
        resolvingImplementations.delete(key);
      }
    };
    const resolveImplementationValue = (path: string, name: string, visiting: Set<string>): Implementation | undefined => {
      const key = `${path}\u0000${name}`;
      if (visiting.has(key)) return undefined;
      if (visiting.size >= 1_000) {
        limited = true;
        return undefined;
      }
      visiting.add(key);
      const info = sourceInfo(path);
      const destructured = info.destructuredInitializers.get(name);
      if (destructured) {
        const member = destructured.property && memberValue(path, destructured.initializer, destructured.property);
        return member ? { ...member, selected: true } : { path, node: destructured.initializer };
      }
      const node = info.functionDeclarations.get(name) ?? info.variableInitializers.get(name);
      if (node) {
        const value = ts.isExpression(node) ? unwrap(node) : node;
        return ts.isIdentifier(value) && !contractOrigin(path, value.text) ? implementationValue(path, value.text, visiting) : { path, node: value };
      }
      const link = info.importedNames.get(name) ?? info.exportLinks.find((candidate) => candidate.name === name);
      if (link) {
        const target = link.specifier ? resolveModule(path, link.specifier) : path;
        return target ? implementationValue(target, link.original, visiting) : undefined;
      }
      for (const specifier of info.stars) {
        const target = resolveModule(path, specifier);
        const value = target && implementationValue(target, name, visiting);
        if (value) return value;
      }
      return undefined;
    };
    const varBinding = (body: ts.Node, name: string): { node?: ts.Node } => {
      const declarations: ts.VariableDeclaration[] = [];
      const collect = (current: ts.Node) => {
        if (ts.isFunctionLike(current) || ts.isClassDeclaration(current) || ts.isClassExpression(current)) return;
        if (ts.isVariableDeclarationList(current) && (current.flags & ts.NodeFlags.BlockScoped) === 0) {
          declarations.push(...current.declarations.filter((declaration) => bindingNames(declaration.name).includes(name)));
        }
        ts.forEachChild(current, collect);
      };
      collect(body);
      const declaration = declarations.length === 1 ? declarations[0] : undefined;
      return declaration && ts.isIdentifier(declaration.name) && declaration.initializer ? { node: declaration.initializer } : {};
    };
    const lexicalBinding = (node: ts.Node, name: string): { node?: ts.Node } | undefined => {
      const owningVarBinding = (scope: ts.Node): { node?: ts.Node } => {
        let owner: ts.Node | undefined = scope;
        while (owner && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)) owner = owner.parent;
        return owner && ts.isSourceFile(owner) ? varBinding(owner, name)
          : owner && ts.isFunctionLike(owner) && "body" in owner && owner.body ? varBinding(owner.body, name) : {};
      };
      const hasVarBinding = (current: ts.Node): boolean => {
        if (ts.isFunctionLike(current) || ts.isClassDeclaration(current) || ts.isClassExpression(current)) return false;
        if (ts.isVariableDeclarationList(current) && (current.flags & ts.NodeFlags.BlockScoped) === 0 &&
          current.declarations.some((declaration) => bindingNames(declaration.name).includes(name))) return true;
        return ts.forEachChild(current, hasVarBinding) ?? false;
      };
      for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
        if (ts.isFunctionLike(parent)) {
          if (parent.parameters.some((parameter) => bindingNames(parameter.name).includes(name))) return {};
          if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) && parent.name?.text === name) return { node: parent };
          if ("body" in parent && parent.body === child && functionBindings(parent).has(name)) return varBinding(child, name);
        }
        if (ts.isCatchClause(parent) && parent.variableDeclaration && bindingNames(parent.variableDeclaration.name).includes(name)) return {};
        if (ts.isForStatement(parent) || ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
          const initializer = parent.initializer;
          if (initializer && ts.isVariableDeclarationList(initializer)) {
            const declaration = initializer.declarations.find((candidate) => bindingNames(candidate.name).includes(name));
            if (declaration) {
              if (!ts.isForStatement(parent)) return {};
              if ((initializer.flags & ts.NodeFlags.BlockScoped) === 0) return owningVarBinding(parent);
              return ts.isIdentifier(declaration.name) && declaration.initializer ? { node: declaration.initializer } : {};
            }
          }
        }
        if (!ts.isBlock(parent) && !ts.isCaseBlock(parent) && !ts.isSourceFile(parent)) continue;
        const statements = ts.isCaseBlock(parent) ? parent.clauses.flatMap((clause) => [...clause.statements]) : parent.statements;
        for (const statement of statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
            const implementation = statements.find((candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name && candidate.body);
            return implementation ? { node: implementation } : {};
          }
          if (ts.isClassDeclaration(statement) && statement.name?.text === name) return {};
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (!bindingNames(declaration.name).includes(name)) continue;
            if ((statement.declarationList.flags & ts.NodeFlags.BlockScoped) === 0) return owningVarBinding(parent);
            return { node: ts.isIdentifier(declaration.name) ? declaration.initializer : undefined };
          }
        }
        if (ts.isSourceFile(parent) && hasVarBinding(parent)) return varBinding(parent, name);
      }
      return undefined;
    };
    const identifierValue = (module: string, node: ts.Identifier): { path: string; node: ts.Node; selected?: boolean } | undefined => {
      const local = lexicalBinding(node, node.text);
      return local ? local.node && { path: module, node: local.node } : implementationValue(module, node.text);
    };
    const resolvedCalls = new Set<ts.Node>();
    const namespaceTarget = (module: string, name: string): string | undefined => {
      const specifier = sourceInfo(module).namespaceImports.get(name);
      return specifier ? resolveModule(module, specifier) : undefined;
    };
    const memberName = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined => {
      if (ts.isPropertyAccessExpression(node)) return node.name.text;
      const argument = node.argumentExpression ? unwrap(node.argumentExpression) : undefined;
      return argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? literalPropertyKey(argument) : undefined;
    };
    const memberValue = (module: string, node: ts.Node, property: string, visiting = new Set<ts.Node>()): { path: string; node: ts.Node } | null | undefined => {
      if (visiting.has(node)) return undefined;
      if (visiting.size >= 1_000) {
        limited = true;
        return undefined;
      }
      const next = new Set(visiting).add(node);
      const value = ts.isExpression(node) ? unwrap(node) : node;
      if (ts.isIdentifier(value)) {
        const implementation = identifierValue(module, value);
        if (implementation) return memberValue(implementation.path, implementation.node, property, next);
        if (lexicalBinding(value, value.text)) return undefined;
        const target = namespaceTarget(module, value.text);
        return target ? implementationValue(target, property) : undefined;
      }
      if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
        const name = memberName(value);
        if (name === undefined) return undefined;
        const inner = memberValue(module, value.expression, name, next);
        return inner && memberValue(inner.path, inner.node, property, next);
      }
      if (ts.isCallExpression(value)) {
        const callee = unwrap(value.expression);
        let implementation: { path: string; node: ts.Node } | undefined;
        if (ts.isIdentifier(callee)) implementation = identifierValue(module, callee);
        else if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
          const name = memberName(callee);
          if (name !== undefined) implementation = memberValue(module, callee.expression, name, next) ?? undefined;
        }
        const resolved = implementation && memberValue(implementation.path, implementation.node, property, next);
        if (resolved) resolvedCalls.add(value);
        return resolved;
      }
      if (ts.isFunctionDeclaration(value) || ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
        if (!value.body) return undefined;
        if (!ts.isBlock(value.body)) return memberValue(module, value.body, property, next);
        const returns: ts.Expression[] = [];
        const collect = (child: ts.Node) => {
          if (ts.isFunctionLike(child)) return;
          if (ts.isReturnStatement(child)) {
            if (child.expression) returns.push(child.expression);
            return;
          }
          ts.forEachChild(child, collect);
        };
        collect(value.body);
        if (returns.length !== 1) return undefined;
        const [returned] = returns;
        return returned ? memberValue(module, returned, property, next) : undefined;
      }
      if (ts.isObjectLiteralExpression(value)) {
        let selected: { path: string; node: ts.Node } | null | undefined = null;
        let selectedGetter = false;
        for (const member of value.properties) {
          if (ts.isSpreadAssignment(member)) {
            const spread = memberValue(module, member.expression, property, next);
            if (spread !== null) {
              selected = spread;
              selectedGetter = false;
            }
            continue;
          }
          let name: string | undefined;
          if (ts.isComputedPropertyName(member.name)) {
            const expression = unwrap(member.name.expression);
            if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) name = literalPropertyKey(expression);
            else {
              selected = undefined;
              selectedGetter = false;
              continue;
            }
          } else name = ts.isIdentifier(member.name) ? member.name.text : literalPropertyKey(member.name);
          if (name !== property) continue;
          if (ts.isSetAccessorDeclaration(member)) {
            if (!selectedGetter) selected = undefined;
            continue;
          }
          selectedGetter = ts.isGetAccessorDeclaration(member);
          selected = { path: module, node: ts.isPropertyAssignment(member) ? member.initializer : ts.isShorthandPropertyAssignment(member) ? member.name : member };
        }
        return selected;
      }
      return undefined;
    };
    const callableMember = (module: string, callee: ts.Expression, active: Set<string>[]): Implementation | undefined => {
      const value = unwrap(callee);
      if (ts.isIdentifier(value)) {
        if (active.some((scope) => scope.has(value.text)) || lexicalBinding(value, value.text) || contractOrigin(module, value.text) || !sourceInfo(module).importedNames.has(value.text)) return undefined;
        return implementationValue(module, value.text);
      }
      if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
        const name = memberName(value);
        if (name === undefined) return undefined;
        const object = value.expression;
        if (ts.isIdentifier(object) && active.some((scope) => scope.has(object.text))) return undefined;
        return memberValue(module, object, name) ?? undefined;
      }
      return undefined;
    };
    const resolveValue = (module: string, start: ts.Node): ts.Node => {
      const info = sourceInfo(module);
      const seen = new Set<ts.Node>();
      let node = ts.isExpression(start) ? unwrap(start) : start;
      while (ts.isIdentifier(node) && !seen.has(node)) {
        seen.add(node);
        const binding = lexicalBinding(node, node.text);
        const next = binding ? binding.node : info.functionDeclarations.get(node.text) ?? info.variableInitializers.get(node.text);
        if (!next) break;
        node = ts.isExpression(next) ? unwrap(next) : next;
      }
      return node;
    };
    const callbackValue = (module: string, argument: ts.Expression): { path: string; node: ts.Node } | undefined => {
      const resolved = resolveValue(module, unwrap(argument));
      if (!ts.isExpression(resolved)) return undefined;
      const member = callableMember(module, resolved, []);
      return member && member.path !== module ? member : undefined;
    };
    const visitedFunctions = new Map<ts.Node, { followImportedCalls: boolean; eager: boolean }>();
    const visitedInitializers = new Map<ts.Node, { followImportedCalls: boolean; eager: boolean }>();
    const covered = (prior: { followImportedCalls: boolean; eager: boolean } | undefined, followImportedCalls: boolean, eager: boolean) =>
      prior !== undefined && (prior.followImportedCalls || !followImportedCalls) && (!prior.eager || eager);
    const blockBindings = (statements: readonly ts.Statement[]): Set<string> => {
      const names = new Set<string>();
      for (const statement of statements) {
        if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0) {
          for (const declaration of statement.declarationList.declarations) for (const name of bindingNames(declaration.name)) names.add(name);
        }
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text);
      }
      return names;
    };
    const functionBindings = (node: ts.FunctionLikeDeclaration): Set<string> => {
      const names = new Set(node.parameters.flatMap((parameter) => bindingNames(parameter.name)));
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) names.add(node.name.text);
      const collect = (child: ts.Node) => {
        if (ts.isFunctionLike(child) || ts.isClassDeclaration(child) || ts.isClassExpression(child)) return;
        if (ts.isVariableDeclarationList(child) && (child.flags & ts.NodeFlags.BlockScoped) === 0) {
          for (const declaration of child.declarations) for (const name of bindingNames(declaration.name)) names.add(name);
        }
        ts.forEachChild(child, collect);
      };
      ts.forEachChild(node, collect);
      return names;
    };
    const scan = (node: ts.Node, module: string, followImportedCalls = module === path, eager = false, invoked = true) => {
      const info = sourceInfo(module);
      const deferredCallable = (node: ts.Node) =>
        ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
      const isCallCallee = (node: ts.Node): boolean => {
        let current = node;
        let parent = node.parent;
        while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent) ||
          ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent))) {
          current = parent;
          parent = parent.parent;
        }
        return ts.isCallExpression(parent) && parent.expression === current;
      };
      const walk = (current: ts.Node, active: Set<string>[], invoked = false) => {
        if (ts.isTypeNode(current) || ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) return;
        if (deferredCallable(current)) {
          if (eager && !invoked) return;
          if (covered(visitedFunctions.get(current), followImportedCalls, eager)) return;
          if (visitedFunctions.size >= 1_000) {
            limited = true;
            return;
          }
          visitedFunctions.set(current, { followImportedCalls, eager });
          const parameters = [...active, new Set(current.parameters.flatMap((parameter) => bindingNames(parameter.name)))];
          const defaults = (name: ts.BindingName) => {
            if (ts.isIdentifier(name)) return;
            for (const element of name.elements) {
              if (ts.isOmittedExpression(element)) continue;
              if (element.initializer) walk(element.initializer, parameters);
              defaults(element.name);
            }
          };
          for (const parameter of current.parameters) {
            if (parameter.initializer) walk(parameter.initializer, parameters);
            defaults(parameter.name);
          }
          if (current.body) walk(current.body, [...active, functionBindings(current)]);
          return;
        }
        if (ts.isBlock(current)) {
          const nested = [...active, blockBindings(current.statements)];
          for (const statement of current.statements) walk(statement, nested);
          return;
        }
        if (ts.isCaseBlock(current)) {
          const nested = [...active, blockBindings(current.clauses.flatMap((clause) => [...clause.statements]))];
          ts.forEachChild(current, (child) => walk(child, nested));
          return;
        }
        if (ts.isCatchClause(current)) {
          const names = new Set(current.variableDeclaration ? bindingNames(current.variableDeclaration.name) : []);
          walk(current.block, [...active, names]);
          return;
        }
        if (ts.isForStatement(current) || ts.isForOfStatement(current) || ts.isForInStatement(current)) {
          const initializer = current.initializer;
          const names = new Set(initializer && ts.isVariableDeclarationList(initializer) && (initializer.flags & ts.NodeFlags.BlockScoped) !== 0
            ? initializer.declarations.flatMap((declaration) => bindingNames(declaration.name)) : []);
          ts.forEachChild(current, (child) => walk(child, [...active, names]));
          return;
        }
        if (ts.isVariableDeclaration(current)) {
          if (current.initializer) walk(current.initializer, active);
          return;
        }
        if ((ts.isClassDeclaration(current) || ts.isClassExpression(current)) && current.name) {
          const nested = [...active, new Set([current.name.text])];
          ts.forEachChild(current, (child) => { if (child !== current.name) walk(child, nested); });
          return;
        }
        if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword && current.arguments.length >= 1) {
          const specifier = unwrap(current.arguments[0]);
          if (ts.isStringLiteralLike(specifier)) {
            const target = resolveModule(module, specifier.text);
            if (target && contracts.has(target)) result.add(target);
          }
        }
        if (followImportedCalls && ts.isCallExpression(current)) {
          const implementation = callableMember(module, current.expression, active);
          if (implementation) scan(implementation.node, implementation.path, false, resolvedCalls.has(current), true);
          if (!resolvedCalls.has(current)) {
            for (const argument of current.arguments) {
              const callback = callbackValue(module, argument);
              if (callback) scan(callback.node, callback.path, false, false, true);
            }
          }
        }
        if (ts.isIdentifier(current)) {
          const parent = current.parent;
          if ((ts.isPropertyAccessExpression(parent) && parent.name === current) ||
            ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === current) ||
            (ts.isBindingElement(parent) && (parent.name === current || parent.propertyName === current)) || ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return;
          if (active.some((scope) => scope.has(current.text))) return;
          const local = lexicalBinding(current, current.text);
          const imported = !local && info.importedNames.get(current.text);
          if (imported) {
            const target = resolveModule(module, imported.specifier);
            const origin = target && (contracts.has(target) ? target : contractOrigin(target, imported.original));
            if (origin) result.add(origin);
          }
          for (const binding of info.runtimeBindings) {
            if (local || binding.namespace !== current.text) continue;
            const target = resolveModule(module, binding.specifier);
            if (target && contracts.has(target)) result.add(target);
          }
          const value = local ? local.node : info.functionDeclarations.get(current.text) ?? info.variableInitializers.get(current.text);
          const resolved = value && resolveValue(module, value);
          const invokedValue = invoked || isCallCallee(current);
          if (resolved && !covered(visitedInitializers.get(resolved), followImportedCalls, eager) && !(eager && !invokedValue && deferredCallable(resolved))) {
            if (visitedInitializers.size >= 1_000) limited = true;
            else {
              visitedInitializers.set(resolved, { followImportedCalls, eager });
              scan(resolved, module, followImportedCalls, eager, invokedValue);
            }
          }
        }
        ts.forEachChild(current, (child) => walk(child, active));
      };
      walk(node, [], invoked);
    };
    const handle = (node: ts.Node, module: string, visiting = new Set<ts.Node>(), followImportedCalls = module === path) => {
      if (visiting.has(node)) return;
      if (visiting.size >= 1_000) {
        limited = true;
        return;
      }
      visiting.add(node);
      const value = ts.isExpression(node) ? unwrap(node) : node;
      if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
        const property = memberName(value);
        const member = property === undefined ? undefined : memberValue(module, value.expression, property);
        if (member) {
          if (contracts.has(member.path)) result.add(member.path);
          handle(member.node, member.path, visiting, false);
        } else {
          handle(value.expression, module, visiting, followImportedCalls);
          scan(value, module, followImportedCalls);
        }
      } else if (ts.isCallExpression(value)) {
        const callee = unwrap(value.expression);
        if (ts.isIdentifier(callee)) {
          const origin = !lexicalBinding(callee, callee.text) && contractOrigin(module, callee.text);
          if (origin) result.add(origin);
          else {
            const implementation = identifierValue(module, callee);
            if (implementation) handle(implementation.node, implementation.path, visiting, followImportedCalls && implementation.path === path && !implementation.selected);
          }
        } else {
          const implementation = callableMember(module, callee, []);
          if (implementation) handle(implementation.node, implementation.path, visiting, false);
        }
        scan(value.expression, module, followImportedCalls);
        for (const argument of value.arguments) {
          const callback = callbackValue(module, argument);
          if (callback) handle(callback.node, callback.path, visiting, false);
          scan(argument, module, followImportedCalls);
        }
      } else if (ts.isIdentifier(value)) {
        const origin = !lexicalBinding(value, value.text) && contractOrigin(module, value.text);
        if (origin) result.add(origin);
        else {
          const implementation = identifierValue(module, value);
          if (implementation) handle(implementation.node, implementation.path, visiting, followImportedCalls && implementation.path === path && !implementation.selected);
          else scan(value, module, followImportedCalls);
        }
      } else scan(value, module, followImportedCalls);
    };
    const origin = contractOrigin(path, method);
    if (origin) result.add(origin);
    else {
      const implementation = implementationValue(path, method);
      if (implementation) handle(implementation.node, implementation.path, new Set(), implementation.path === path && !implementation.selected);
    }
    return { contracts: result, limited };
  };
  const closures = new Map<string, Set<string>>();
  const closure = (path: string, clientOnly = false): Set<string> => {
    const key = `${clientOnly ? "client" : "all"}\u0000${path}`;
    const cached = closures.get(key);
    if (cached) return cached;
    const visited = new Set<string>();
    const queue = [path];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      for (const dependency of importPaths(next, clientOnly)) {
        if (!clientOnly || clientDependencyPattern.test(dependency)) queue.push(dependency);
      }
    }
    closures.set(key, visited);
    return visited;
  };
  const bestRouteCache = new Map<string, string | undefined>();
  const bestRoute = (literal: string): string | undefined => {
    if (bestRouteCache.has(literal)) return bestRouteCache.get(literal);
    const segments = urlSegments(literal);
    const result = segments && [...routes].filter((path) => resolvesTo(path, segments)).sort(routePriority)[0];
    bestRouteCache.set(literal, result);
    return result;
  };
  const parserExports = (path: string, contract: string, visiting = new Set<string>()): Set<string> => {
    if (visiting.has(path)) return new Set();
    visiting.add(path);
    const info = sourceInfo(path);
    const names = new Set<string>();
    if (path === contract) {
      if (info.defaultParser) names.add("default");
      for (const [name, value] of exportedValues(contract)) if (parserPattern.test(name) && value.callable) names.add(name);
      if (info.exportLinks.some((link) => link.name === "default" && parserPattern.test(link.original) && exportedValues(contract).get("default")?.callable)) names.add("default");
    } else {
      const from = (specifier: string) => {
        const target = resolveModule(path, specifier);
        return target ? parserExports(target, contract, visiting) : new Set<string>();
      };
      const local = (name: string) => {
        const imported = info.importedNames.get(name);
        return imported && from(imported.specifier).has(imported.original);
      };
      for (const name of info.directExports) if (local(name)) names.add(name);
      for (const link of info.exportLinks) {
        if (link.specifier ? from(link.specifier).has(link.original) : local(link.original)) names.add(link.name);
      }
      for (const specifier of info.stars) for (const name of from(specifier)) if (name !== "default") names.add(name);
    }
    visiting.delete(path);
    return names;
  };
  const carriesParserUncached = (path: string, contract: string) => {
    const info = sourceInfo(path);
    for (const binding of info.runtimeBindings) {
      const target = resolveModule(path, binding.specifier);
      if (!target) continue;
      const names = parserExports(target, contract);
      if (binding.original && names.has(binding.original)) return true;
      const namespace = binding.namespace;
      if (namespace && [...names].some((name) => info.referencedMembers.get(namespace)?.has(name))) return true;
    }
    for (const link of info.exportLinks) {
      if (!link.specifier) continue;
      const target = resolveModule(path, link.specifier);
      if (target && parserExports(target, contract).has(link.original)) return true;
    }
    for (const specifier of info.stars) {
      const target = resolveModule(path, specifier);
      if (target && parserExports(target, contract).size > 0) return true;
    }
    return false;
  };
  const parserContractCache = new Map<string, boolean>();
  const carriesParser = (path: string, contract: string) => {
    const cacheKey = `${path}\u0000${contract}`;
    const cached = parserContractCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const result = carriesParserUncached(path, contract);
    parserContractCache.set(cacheKey, result);
    return result;
  };
  const reachableRoutesCache = new Map<string, Set<string>>();
  const reachableRoutes = (file: string): Set<string> => {
    const cached = reachableRoutesCache.get(file);
    if (cached) return cached;
    const result = new Set<string>();
    for (const dependency of closure(file, true)) {
      if (contracts.has(dependency)) continue;
      for (const url of sourceInfo(dependency).urls) {
        const route = bestRoute(url);
        if (route) result.add(route);
      }
    }
    reachableRoutesCache.set(file, result);
    return result;
  };
  const runtimeClosures = new Map<string, Set<string>>();
  const runtimeClosure = (file: string): Set<string> => {
    const cached = runtimeClosures.get(file);
    if (cached) return cached;
    const visited = new Set<string>([file]);
    const queue = [file];
    while (queue.length > 0) {
      const next = queue.pop()!;
      for (const dependency of importPaths(next, true)) {
        if (visited.has(dependency)) continue;
        visited.add(dependency);
        queue.push(dependency);
      }
    }
    runtimeClosures.set(file, visited);
    return visited;
  };
  let filesByRoute: Map<string, string[]> | undefined;
  const reachingFiles = (path: string): string[] => {
    if (!filesByRoute) {
      filesByRoute = new Map<string, string[]>();
      for (const file of clientFiles) for (const route of reachableRoutes(file)) {
        const list = filesByRoute.get(route);
        if (list) list.push(file);
        else filesByRoute.set(route, [file]);
      }
    }
    return filesByRoute.get(path) ?? [];
  };
  const clientLinked = (path: string, declared: string[]) =>
    reachingFiles(path).some((file) =>
      declared.every((contract) => runtimeClosure(file).has(contract) && carriesParser(file, contract)));
  const clientReachable = (path: string) => reachingFiles(path).length > 0;
  const baseline = manifest.baseline;
  const versionIdentifier = (path: string, name: string, visiting = new Set<string>()): boolean => {
    const key = `${path}\u0000${name}`;
    if (visiting.has(key)) return false;
    visiting.add(key);
    const info = sourceInfo(path);
    if (info.shadowedNames.has(name)) return false;
    if (info.localVersions.has(name)) return true;
    const link = info.importedNames.get(name) ?? info.exportLinks.find((candidate) => candidate.name === name);
    if (!link?.specifier) return false;
    const target = resolveModule(path, link.specifier);
    return target ? versionIdentifier(target, link.original, visiting) : false;
  };
  const contractShape = new Map([...contracts].map((contract) => {
    const info = sourceInfo(contract);
    const versioned = info.propertyVersioned || [...info.versionRefs].some((name) => versionIdentifier(contract, name)) ||
      [...exportedValues(contract)].some(([name, value]) => versionPattern.test(name) && value.version);
    const parsed = info.defaultParser ||
      [...exportedValues(contract)].some(([name, value]) => parserPattern.test(name) && value.callable) ||
      info.exportLinks.some((link) => link.name === "default" && parserPattern.test(link.original) && exportedValues(contract).get("default")?.callable);
    return [contract, { versioned, parsed }] as const;
  }));
  const versionedParser = (contract: string) => {
    const shape = contractShape.get(contract);
    return !!(shape?.versioned && shape.parsed);
  };
  const arrays = {
    unversionedContracts: baseline.unversionedContracts,
    parserlessContracts: baseline.parserlessContracts,
  };
  for (const [name, values] of Object.entries(arrays)) {
    if (values.join("\0") !== [...values].sort().join("\0")) report("baseline-unsorted", name, "Entries must be sorted");
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) report("baseline-stale", value, `Duplicate ${name} entry`);
      seen.add(value);
    }
  }
  const maps = {
    handlerUnlinked: baseline.handlerUnlinked,
    routesWithoutVersionedParser: baseline.routesWithoutVersionedParser,
    clientUnlinked: baseline.clientUnlinked,
    undeclaredHandlerContracts: baseline.undeclaredHandlerContracts,
  };
  for (const [name, values] of Object.entries(maps)) {
    if (Object.keys(values).join("\0") !== Object.keys(values).sort().join("\0")) {
      report("baseline-unsorted", name, "Routes must be sorted");
    }
    for (const [path, contracts] of Object.entries(values)) {
      if (contracts.join("\0") !== [...contracts].sort().join("\0")) report("baseline-unsorted", path, "Contracts must be sorted");
      const seen = new Set<string>();
      for (const contract of contracts) {
        if (seen.has(contract)) report("baseline-stale", path, `Duplicate ${name} entry: ${contract}`);
        seen.add(contract);
      }
    }
  }
  for (const path of appRoutes) {
    if (!(path in manifest.appRoutes)) report("route-unclassified", path, "Route is not in the manifest's appRoutes section");
  }
  const manifestAppRoutes = Object.keys(manifest.appRoutes);
  if (manifestAppRoutes.join("\0") !== [...manifestAppRoutes].sort().join("\0")) {
    report("manifest-unsorted", "appRoutes", "App routes must be sorted");
  }
  for (const [path, entry] of Object.entries(manifest.appRoutes)) {
    if (!appRoutes.has(path)) report("route-unknown", path, "Manifest app route does not exist");
    if (Object.hasOwn(entry, "contracts")) {
      report("route-contract-unsupported", path, "Handlers outside app/api must carry an exemption; declare shared contracts on an app/api route");
    }
    if (!entry.exempt || !exemptionKinds.includes(entry.exempt.kind) || typeof entry.exempt.reason !== "string" || entry.exempt.reason.trim().length < 30) {
      report("exempt-invalid", path, "Exemption needs a recognized kind and a specific reason");
    }
  }
  for (const path of routes) {
    if (!(path in manifest.routes)) report("route-unclassified", path, "Route is not in the manifest");
  }
  const manifestRoutes = Object.keys(manifest.routes);
  if (manifestRoutes.join("\0") !== [...manifestRoutes].sort().join("\0")) {
    report("manifest-unsorted", "routes", "Routes must be sorted");
  }
  for (const [path, entry] of Object.entries(manifest.routes)) {
    if (!Array.isArray(entry.contracts)) continue;
    if (entry.contracts.join("\0") !== [...entry.contracts].sort().join("\0")) report("manifest-unsorted", path, "Contracts must be sorted");
    const seen = new Set<string>();
    for (const contract of entry.contracts) {
      if (seen.has(contract)) report("manifest-duplicate", path, `Duplicate contract entry: ${contract}`);
      seen.add(contract);
    }
  }
  for (const [path, tolerated] of Object.entries(baseline.routesWithoutVersionedParser)) {
    if (!routes.has(path)) report("route-unknown", path, "Baseline route does not exist");
    const entry = manifest.routes[path];
    if (!routes.has(path) || entry?.exempt || (Array.isArray(entry?.contracts) && entry.contracts.every(versionedParser))) {
      report("baseline-stale", path, "Route was removed, exempted, or now declares a versioned parser");
    }
    if (entry && Object.hasOwn(entry, "methods")) {
      report("baseline-stale", path, "Per-method contracts replace the route-level weak contract tolerance");
    }
    for (const contract of tolerated) {
      if (!routes.has(path) || !entry?.contracts?.includes(contract) || !contracts.has(contract) || versionedParser(contract)) {
        report("baseline-stale", path, `Weak contract tolerance no longer applies: ${contract}`);
      }
    }
  }
  const undeclaredHandlerContracts = new Map<string, Set<string>>();
  const limitedHandlerRoutes = new Set<string>();
  for (const [path, entry] of Object.entries(manifest.routes)) {
    if (!routes.has(path)) report("route-unknown", path, "Manifest route does not exist");
    const hasContracts = Object.hasOwn(entry, "contracts");
    const hasExempt = Object.hasOwn(entry, "exempt");
    const hasMethods = Object.hasOwn(entry, "methods");
    const methods = entry.methods;
    const validMethodMap = methods !== null && typeof methods === "object" && !Array.isArray(methods);
    if (hasMethods && (hasExempt || !validMethodMap)) {
      report("method-map-invalid", path, "Methods must be an object on a non-exempt route");
    }
    if (routes.has(path) && !hasExempt) {
      const exportedMethods = new Set([...exportedValues(`app/api/${path}`).keys()].filter((name) => httpMethods.includes(name)));
      const gaps = new Set<string>();
      undeclaredHandlerContracts.set(path, gaps);
      for (const method of exportedMethods) {
        const declared = hasMethods ? methods?.[method]?.contracts : entry.contracts;
        const references = referencedContracts(`app/api/${path}`, method);
        if (references.limited) {
          report("handler-analysis-limit", path, `${method} handler reference scan exceeded its analysis budget`);
          limitedHandlerRoutes.add(path);
          continue;
        }
        for (const contract of references.contracts) {
          if (Array.isArray(declared) && declared.includes(contract)) continue;
          const identity = hasMethods ? `${method} ${contract}` : contract;
          gaps.add(identity);
          if (!baseline.undeclaredHandlerContracts[path]?.includes(identity)) {
            report("handler-contract-undeclared", path, `${method} references an undeclared contract: ${contract}`);
          }
        }
      }
      if (!hasMethods && exportedMethods.size > 1) {
        report("method-unclassified", path, "Routes exporting multiple HTTP methods must classify every method");
      } else if (hasMethods && validMethodMap) {
        for (const method of exportedMethods) {
          if (!Object.hasOwn(methods, method)) report("method-unclassified", path, `Exported method has no classification: ${method}`);
        }
        const boundContracts = new Set<string>();
        for (const [method, classification] of Object.entries(methods)) {
          if (!exportedMethods.has(method)) report("method-unknown", path, `Route does not export method: ${method}`);
          const methodContracts = Array.isArray(classification?.contracts) ? classification.contracts : [];
          for (const contract of methodContracts) {
            boundContracts.add(contract);
            if (!entry.contracts?.includes(contract)) report("method-contract-undeclared", path, `${method} binds an undeclared contract: ${contract}`);
          }
          const allowance = classification?.allowance;
          const validAllowance = !!allowance && allowanceKinds.includes(allowance.kind) && typeof allowance.reason === "string" && allowance.reason.trim().length >= 30;
          if (classification && Object.hasOwn(classification, "allowance") && !validAllowance) {
            report("method-allowance-invalid", path, `${method} allowance needs a recognized kind and a specific reason`);
          }
          if ((methodContracts.length === 0 || !methodContracts.every(versionedParser)) && !validAllowance) {
            report("method-unversioned", path, `${method} has no versioned parser or valid allowance`);
          }
        }
        for (const contract of Array.isArray(entry.contracts) ? entry.contracts : []) {
          if (!boundContracts.has(contract)) report("method-contract-unbound", path, `Declared contract is not bound to any method: ${contract}`);
        }
      }
    }
    if ((hasExempt && Object.hasOwn(baseline.routesWithoutVersionedParser, path)) || hasContracts === hasExempt || (hasContracts && (!Array.isArray(entry.contracts) || entry.contracts.length === 0))) {
      report("route-double", path, "Route must have exactly one nonempty contract list or exemption and cannot be both exempt and baselined");
    }
    if (hasExempt && (!entry.exempt || !exemptionKinds.includes(entry.exempt.kind) || typeof entry.exempt.reason !== "string" || entry.exempt.reason.trim().length < 30)) {
      report("exempt-invalid", path, "Exemption needs a recognized kind and a specific reason");
    }
    if (!Array.isArray(entry.contracts) || !routes.has(path)) continue;
    const toleratedWeak = baseline.routesWithoutVersionedParser[path];
    if (!hasMethods && !toleratedWeak && !entry.contracts.every(versionedParser)) {
      report("route-unversioned-parser", path, "No declared contract has both a version token and an exported parser");
    } else if (!hasMethods && toleratedWeak) {
      for (const contract of entry.contracts) {
        if (contracts.has(contract) && !versionedParser(contract) && !toleratedWeak.includes(contract)) {
          report("route-unversioned-parser", path, `Declared contract lacks a version token and exported parser: ${contract}`);
        }
      }
    }
    const linked = closure(`app/api/${path}`);
    for (const contract of entry.contracts) {
      if (!contracts.has(contract)) report("contract-unknown", path, contract);
      else if (!linked.has(contract) && !baseline.handlerUnlinked[path]?.includes(contract)) report("handler-unlinked", path, contract);
    }
    const isClientLinked = clientLinked(path, entry.contracts);
    const hasClientReason = typeof entry.client === "string" && entry.client.trim().length > 0;
    const toleratedClient = baseline.clientUnlinked[path];
    if (isClientLinked && hasClientReason) report("client-reason-stale", path, "Client reason is present despite a linked client");
    if (!isClientLinked && !toleratedClient && !(hasClientReason && !clientReachable(path))) {
      report("client-unlinked", path, "No URL-bearing client module imports a declared contract");
    } else if (!isClientLinked && toleratedClient) {
      for (const contract of entry.contracts) {
        if (contracts.has(contract) && !toleratedClient.includes(contract) && !clientLinked(path, [contract])) {
          report("client-unlinked", path, `Declared contract is not client-linked: ${contract}`);
        }
      }
    }
  }
  for (const [path, tolerated] of Object.entries(baseline.undeclaredHandlerContracts)) {
    if (!routes.has(path) || !Object.hasOwn(manifest.routes, path) || tolerated.length === 0) {
      report("baseline-stale", path, "Handler contract gap no longer applies");
    }
    if (limitedHandlerRoutes.has(path)) continue;
    for (const contract of tolerated) {
      if (!undeclaredHandlerContracts.get(path)?.has(contract)) {
        report("baseline-stale", path, `Handler contract gap no longer applies: ${contract}`);
      }
    }
  }
  for (const contract of contracts) {
    const { versioned, parsed } = contractShape.get(contract)!;
    if (!versioned && !baseline.unversionedContracts.includes(contract)) report("contract-unversioned", contract, "No version token");
    if (!parsed && !baseline.parserlessContracts.includes(contract)) report("contract-parserless", contract, "No exported parser");
    if (versioned && baseline.unversionedContracts.includes(contract)) report("baseline-stale", contract, "Contract now has a version token");
    if (parsed && baseline.parserlessContracts.includes(contract)) report("baseline-stale", contract, "Contract now has a parser");
  }
  for (const contract of baseline.unversionedContracts) {
    if (!contracts.has(contract)) report("baseline-stale", contract, "Unversioned contract removed");
  }
  for (const contract of baseline.parserlessContracts) {
    if (!contracts.has(contract)) report("baseline-stale", contract, "Parserless contract removed");
  }
  for (const [path, values] of Object.entries(baseline.handlerUnlinked)) {
    const declared = manifest.routes[path]?.contracts;
    const linked = routes.has(path) ? closure(`app/api/${path}`) : new Set<string>();
    for (const contract of values) {
      if (!routes.has(path) || !declared?.includes(contract) || !contracts.has(contract) || linked.has(contract)) {
        report("baseline-stale", path, `Handler gap no longer applies: ${contract}`);
      }
    }
  }
  for (const [path, tolerated] of Object.entries(baseline.clientUnlinked)) {
    const entry = manifest.routes[path];
    const declared = entry?.contracts;
    if (!routes.has(path) || !declared?.length || clientLinked(path, declared)) {
      report("baseline-stale", path, "Client gap no longer applies");
    }
    for (const contract of tolerated) {
      if (!routes.has(path) || !declared?.includes(contract) || !contracts.has(contract) || clientLinked(path, [contract])) {
        report("baseline-stale", path, `Client gap no longer applies: ${contract}`);
      }
    }
  }
  return violations.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail));
}
