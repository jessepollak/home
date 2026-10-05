// This list is the single source of truth for the shell's deferred flows.
// docs/design-system/product-pieces/deferred-sheet.md is the contract. The performance
// workflow's per-route initial-JS byte budget (apps/web/scripts/performance/baseline.json)
// is complementary measurement this gate does not duplicate. Add a new deferred
// flow's module here when it joins the shell.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executedAsScript } from "../worktree/bootstrap.mjs";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
// Next's resolveConfig.extensions (apps/web/node_modules/next/dist/build/webpack-config.js); update with a Next upgrade.
const resolveExtensions = [".js", ".mjs", ".tsx", ".ts", ".jsx", ".json", ".wasm"];
// Formats Next serves through asset/CSS loaders or JSON; webpack parses every other resolved local file as JavaScript.
// Formats Next serves through CSS, JSON or image loaders for JavaScript importers (nextImageLoaderRegex);
// every other resolved local file is parsed as JavaScript, as webpack does.
const nonCodeExtensions = new Set([".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp"]);

export const shellEntryRoots = [
  "apps/web/app/layout.tsx",
  "apps/web/app/error.tsx",
  "apps/web/app/global-error.tsx",
  "apps/web/instrumentation-client.ts",
  "apps/web/app/(shell)/layout.tsx",
  "apps/web/app/(shell)/[...shell]/page.tsx",
  "apps/web/app/(shell)/activity/page.tsx",
  "apps/web/app/(shell)/borrow/[[...market]]/page.tsx",
  "apps/web/app/(shell)/card/page.tsx",
  "apps/web/app/(shell)/cash/page.tsx",
  "apps/web/app/(shell)/cash/savings/page.tsx",
  "apps/web/app/(shell)/home/page.tsx",
  "apps/web/app/(shell)/invest/[[...slug]]/page.tsx",
  "apps/web/app/(shell)/investments/[[...holding]]/page.tsx",
];

export const deferredShellModules = [
  { path: "apps/web/client/savings/savings-journey-step.tsx", flow: "Save deposit and withdraw" },
  { path: "apps/web/client/transfers/send-dialog.tsx", flow: "Send" },
  { path: "apps/web/client/funding/add-money-dialog.tsx", flow: "Add money" },
  { path: "apps/web/client/borrowing/borrow-money-dialog.tsx", flow: "Borrow" },
];

function exactCasePath(root, file, entryNames) {
  let directory = root;
  for (const segment of file.split("/")) {
    if (!entryNames(directory)?.has(segment)) return false;
    directory = path.join(directory, segment);
  }
  return true;
}

function isFile(root, file, realRoot, entryNames, packageScope) {
  const absolute = path.join(root, file);
  try {
    if (!statSync(absolute).isFile()) return false;
    if (entryNames && !exactCasePath(root, file, entryNames)) return false;
    if (packageScope) {
      const appPackage = path.join(root, "apps", "web");
      for (let directory = path.dirname(absolute); directory !== root && directory.startsWith(root + path.sep); directory = path.dirname(directory)) {
        if (directory !== appPackage && packageScope(directory)) throw new Error(`${file}: the nested package at ${path.relative(root, directory)} is not modeled by the shell deferral gate; remove its package.json or import the file explicitly.`);
      }
    }
    if (realpathSync(absolute) !== path.join(realRoot(), file)) {
      throw new Error(`${file}: symlinked modules are not supported because module identity cannot be proven.`);
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function fileChecker(root) {
  const rootPath = path.resolve(root);
  let realRoot;
  const directories = new Map();
  const entryNames = (directory) => {
    if (!directories.has(directory)) {
      try { directories.set(directory, new Set(readdirSync(directory))); }
      catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") directories.set(directory, null);
        else throw error;
      }
    }
    return directories.get(directory);
  };
  const manifests = new Map();
  const packageScope = (directory) => {
    if (!manifests.has(directory)) manifests.set(directory, existsSync(path.join(directory, "package.json")));
    return manifests.get(directory);
  };
  return (file) => isFile(rootPath, file, () => realRoot ??= realpathSync(rootPath), entryNames, packageScope);
}

export function discoverShellEntryRoots(root) {
  const entries = [];
  const has = fileChecker(root);
  function walk(dir, convention, recursive = false) {
    let items;
    try { items = readdirSync(path.join(root, dir), { withFileTypes: true }); }
    catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
      throw error;
    }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${dir}/${item.name}`;
      if (item.isSymbolicLink()) {
        throw new Error(`${file}: symlinked shell entries are not supported because module identity cannot be proven.`);
      }
      if (item.isDirectory()) {
        if (recursive) walk(file, convention, true);
      } else if (convention.test(item.name) && has(file)) entries.push(file);
    }
  }
  walk("apps/web/app", /^(?:layout|template|default|loading|error|global-error|not-found|forbidden|unauthorized)\.(?:ts|tsx|js|jsx)$/);
  walk("apps/web/app/(shell)", /^(?:page|layout|template|default|route|loading|error|global-error|not-found|forbidden|unauthorized)\.(?:ts|tsx|js|jsx)$/, true);
  for (const extension of ["ts", "tsx", "js", "jsx"]) {
    const file = `apps/web/instrumentation-client.${extension}`;
    if (has(file)) entries.push(file);
  }
  return entries;
}

function unwrapExpression(expression) {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isExpressionWithTypeArguments(expression)) expression = expression.expression;
  return expression;
}

function staticString(expression) {
  expression = unwrapExpression(expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(expression.left);
    const right = staticString(expression.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

function requireMember(node, objects) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const object = unwrapExpression(node.expression);
  return ts.isIdentifier(object) && objects.includes(object.text)
    && (ts.isPropertyAccessExpression(node) ? node.name.text === "require"
      : staticString(node.argumentExpression) === "require");
}

function outerExpression(node) {
  while (node.parent) {
    const parent = node.parent;
    if ((ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)
      || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent)
      || ts.isTypeAssertionExpression(parent) || ts.isPropertyAccessExpression(parent)
      || ts.isElementAccessExpression(parent) || ts.isCallExpression(parent)) && parent.expression === node
      || ts.isBinaryExpression(parent) && (parent.left === node || parent.right === node)) node = parent;
    else break;
  }
  return node;
}

function isRequireCallReference(node) {
  let expression = node;
  while (expression.parent && unwrapExpression(expression.parent) === node) expression = expression.parent;
  return ts.isCallExpression(expression.parent) && expression.parent.expression === expression;
}

export function staticImportSpecifiers(content, file) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`${file}: cannot parse static imports; fix the source before checking shell deferrals.`);
  for (const pragma of content.matchAll(/@jsxImportSource\s+([^\s*]+)/g)) {
    if (pragma[1] !== "react") {
      throw new Error(`${file}: the @jsxImportSource pragma ${pragma[1]} is not modeled by the shell deferral gate.`);
    }
  }
  const specifiers = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const bindings = clause?.namedBindings;
      if (!clause?.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length && bindings.elements.every((element) => element.isTypeOnly)) continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause) && clause.elements.length
        && clause.elements.every((element) => element.isTypeOnly)) continue;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly
      && ts.isExternalModuleReference(statement.moduleReference)
      && statement.moduleReference.expression && ts.isStringLiteral(statement.moduleReference.expression)) {
      specifiers.push(statement.moduleReference.expression.text);
    }
  }
  function unsupported(node) {
    throw new Error(`${file}: unsupported require expression ${outerExpression(node).getText(source)}; use a statically evaluable string argument.`);
  }
  function visit(node) {
    if (ts.isTypeNode(node)) {
      if (ts.isExpressionWithTypeArguments(node) && (!ts.isHeritageClause(node.parent)
        || node.parent.token === ts.SyntaxKind.ExtendsKeyword
        && (ts.isClassDeclaration(node.parent.parent) || ts.isClassExpression(node.parent.parent)))) visit(node.expression);
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const callText = source.text.slice(node.getStart(source), node.end);
      for (const comment of callText.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
        if (/webpack/i.test(comment[0])) {
          throw new Error(`${file}: a webpack magic comment on import() is not modeled by the shell deferral gate.`);
        }
      }
    }
    const metaMember = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) ? staticString(node.argumentExpression) : null;
    if (metaMember?.startsWith("webpack") && ts.isMetaProperty(unwrapExpression(node.expression))) {
      throw new Error(`${file}: import.meta.${metaMember} is not modeled by the shell deferral gate.`);
    }
    if ((ts.isPropertyAccessExpression(node) && node.name.text === "context"
      || ts.isElementAccessExpression(node) && staticString(node.argumentExpression) === "context")
      && ts.isIdentifier(unwrapExpression(node.expression)) && unwrapExpression(node.expression).text === "require") {
      throw new Error(`${file}: require.context is not modeled by the shell deferral gate.`);
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isIdentifier(callee) && callee.text === "define") {
        throw new Error(`${file}: AMD define(...) is not modeled by the shell deferral gate.`);
      }
      if (ts.isIdentifier(callee) && callee.text === "require" || requireMember(callee, ["module"])) {
        const specifier = node.arguments.length === 1 ? staticString(node.arguments[0]) : null;
        if (specifier === null) unsupported(node);
        specifiers.push(specifier);
      }
    }
    if (requireMember(node, ["module"]) && !isRequireCallReference(node)
      || requireMember(node, ["globalThis", "window"])) unsupported(node);
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)
      && ts.isVariableDeclaration(node.parent.parent) && node.parent.parent.initializer) {
      const property = node.propertyName ?? node.name;
      const object = unwrapExpression(node.parent.parent.initializer);
      if ((ts.isIdentifier(property) || ts.isStringLiteral(property)) && property.text === "require"
        && ts.isIdentifier(object) && ["module", "globalThis", "window"].includes(object.text)) unsupported(node);
    }
    const exportDeclaration = ts.isExportSpecifier(node.parent) ? node.parent.parent.parent : null;
    const localExport = exportDeclaration !== null && !exportDeclaration.moduleSpecifier
      && !exportDeclaration.isTypeOnly && !node.parent.isTypeOnly
      && (node.parent.propertyName ?? node.parent.name) === node;
    if (ts.isIdentifier(node) && node.text === "require"
      && (!ts.isDeclarationName(node) || ts.isShorthandPropertyAssignment(node.parent) || localExport)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && !(ts.isBindingElement(node.parent) && node.parent.propertyName === node)
      && !isRequireCallReference(node)) unsupported(node);
    ts.forEachChild(node, visit);
  }
  for (const statement of source.statements) visit(statement);
  return [...new Set(specifiers)];
}

function resolveStaticImport(importer, specifier, has) {
  if (specifier.startsWith("#")) {
    throw new Error(`${importer}: the ${JSON.stringify(specifier)} imports-map specifier is not modeled by the shell deferral gate.`);
  }
  if (/^(?:data|https?|file|blob):/i.test(specifier)) {
    throw new Error(`${importer}: the URL-scheme specifier ${JSON.stringify(specifier)} is not modeled by the shell deferral gate.`);
  }
  if (specifier.includes("?")) {
    throw new Error(`${importer}: the resource query in ${JSON.stringify(specifier)} is not modeled by the shell deferral gate.`);
  }
  if (specifier.includes("#")) {
    throw new Error(`${importer}: the fragment in ${JSON.stringify(specifier)} is not modeled by the shell deferral gate.`);
  }
  if (specifier.startsWith("/")) {
    throw new Error(`${importer}: the ${JSON.stringify(specifier)} server-relative request is not modeled by the shell deferral gate.`);
  }
  if (specifier.includes("!")) {
    throw new Error(`${importer}: inline loader request ${JSON.stringify(specifier)} is not modeled by the shell deferral gate.`);
  }
  let base;
  if (specifier.startsWith("@/")) base = path.posix.normalize(`apps/web/${specifier.slice(2)}`);
  else if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")) base = path.posix.join(path.posix.dirname(importer), specifier);
  else return { external: true };
  const fileCandidates = [base, ...resolveExtensions.map((extension) => `${base}${extension}`)];
  const indexCandidates = resolveExtensions.map((extension) => `${base}/index${extension}`);
  const candidates = [...fileCandidates, ...indexCandidates];
  const paths = candidates.filter(has);
  if (paths.some((candidate) => indexCandidates.includes(candidate)) && has(`${base}/package.json`)) {
    throw new Error(`${base}/package.json: directory manifests are not modeled by the shell deferral gate; import the file explicitly.`);
  }
  return paths.length ? { paths } : { unresolved: true };
}

export function analyzeStaticReachability({ roots, deferred, has, read }) {
  const violations = [];
  const unresolved = [];
  const missingDeferred = deferred.filter((module) => !has(module.path));
  const deferredByPath = new Map(deferred.map((module) => [module.path, module]));
  const reachable = new Set();
  const queue = [];
  function enqueue(file, chain, importer = null, specifier = null) {
    if (reachable.has(file)) return;
    reachable.add(file);
    const module = deferredByPath.get(file);
    if (module) violations.push({ ...module, path: file, chain, importer, specifier });
    if (!nonCodeExtensions.has(path.posix.extname(file).toLowerCase())) queue.push({ file, chain });
  }
  for (const root of roots) {
    if (!has(root)) unresolved.push({ importer: null, specifier: root, chain: [root] });
    else enqueue(root, [root]);
  }
  for (let index = 0; index < queue.length; index++) {
    const { file, chain } = queue[index];
    for (const specifier of staticImportSpecifiers(read(file), file)) {
      const resolved = resolveStaticImport(file, specifier, has);
      if (resolved.unresolved) unresolved.push({ importer: file, specifier, chain });
      else if (resolved.paths) for (const path of resolved.paths) enqueue(path, [...chain, path], file, specifier);
    }
  }
  return { violations, unresolved, missingDeferred, reachable };
}

function readManifest(root, file) {
  try { return JSON.parse(readFileSync(path.join(root, file), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function assertModeledResolution(root) {
  for (const file of ["package.json", "apps/web/package.json"]) {
    const manifest = readManifest(root, file);
    for (const field of ["browser", "imports", "exports"]) {
      if (manifest && typeof manifest === "object" && Object.hasOwn(manifest, field)) {
        throw new Error(`${file} declares \"${field}\", a resolution feature the shell deferral gate does not model.`);
      }
    }
  }
  const tsconfig = readManifest(root, "apps/web/tsconfig.json");
  if (tsconfig && Object.hasOwn(tsconfig, "extends")) {
    throw new Error('apps/web/tsconfig.json declares "extends", a resolution inheritance the shell deferral gate does not model.');
  }
  if (tsconfig?.compilerOptions && Object.hasOwn(tsconfig.compilerOptions, "baseUrl")) {
    throw new Error('apps/web/tsconfig.json declares "baseUrl", a resolution feature the shell deferral gate does not model.');
  }
  if (tsconfig?.compilerOptions && Object.hasOwn(tsconfig.compilerOptions, "moduleSuffixes")) {
    throw new Error('apps/web/tsconfig.json declares "moduleSuffixes", a resolution feature the shell deferral gate does not model.');
  }
  if (tsconfig?.compilerOptions?.jsxImportSource !== undefined && tsconfig.compilerOptions.jsxImportSource !== "react") {
    throw new Error('apps/web/tsconfig.json declares a non-default "jsxImportSource", a synthesized import the shell deferral gate does not model.');
  }
  for (const babelFile of ["apps/web/.babelrc", "apps/web/.babelrc.js", "apps/web/.babelrc.cjs", "apps/web/.babelrc.mjs", "apps/web/.babelrc.json", "apps/web/babel.config.js", "apps/web/babel.config.cjs", "apps/web/babel.config.mjs", "apps/web/babel.config.json"]) {
    if (existsSync(path.join(root, babelFile))) throw new Error(`${babelFile} changes import transforms the shell deferral gate does not model.`);
  }
  const paths = tsconfig?.compilerOptions?.paths ?? {};
  for (const [alias, targets] of Object.entries(paths)) {
    if (alias !== "@/*" || JSON.stringify(targets) !== JSON.stringify(["./*"])) {
      throw new Error(`apps/web/tsconfig.json declares the path alias \"${alias}\" with targets ${JSON.stringify(targets)}; the shell deferral gate models only \"@/*\" -> [\"./*\"].`);
    }
  }
  for (const configFile of ["apps/web/next.config.ts", "apps/web/next.config.js", "apps/web/next.config.mjs", "apps/web/next.config.cjs"]) {
    let source = null;
    try { source = readFileSync(path.join(root, configFile), "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    if (source !== null) {
      const parsed = ts.createSourceFile(configFile, source, ts.ScriptTarget.Latest, true);
      for (const statement of parsed.statements) {
        if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly
          || ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly
          || ts.isImportEqualsDeclaration(statement)) {
          throw new Error(`${configFile} loads another module at runtime; the shell deferral gate models only a self-contained config.`);
        }
      }
      const forbidden = /^(?:webpack|turbopack|turbo|modularizeImports|optimizePackageImports|resolveAlias|resolveExtensions|extensionAlias|resolveFallback|tsconfigPath|swcPlugins|pageExtensions|relay|emotion)$/;
      function configLoad(node) {
        if (ts.isCallExpression(node)) {
          const callee = unwrapExpression(node.expression);
          if (ts.isIdentifier(callee) && callee.text === "require" || requireMember(callee, ["module"]) || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            throw new Error(`${configFile} loads another module at runtime; the shell deferral gate models only a self-contained config.`);
          }
          const objectReceiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee) ? unwrapExpression(callee.expression) : null;
          if (objectReceiver && ts.isIdentifier(objectReceiver) && objectReceiver.text === "Object") {
            throw new Error(`${configFile} constructs configuration dynamically; the shell deferral gate models only a literal configuration object.`);
          }
        }
        const name = ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isShorthandPropertyAssignment(node)
          || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
          ? node.name : null;
        if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) && forbidden.test(name.text)) {
          throw new Error(`${configFile} declares a resolver or import transform the shell deferral gate does not model.`);
        }
        if (ts.isComputedPropertyName(node)) {
          throw new Error(`${configFile} uses a computed configuration key; the shell deferral gate models only literal configuration.`);
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
          throw new Error(`${configFile} mutates its configuration; the shell deferral gate models only a literal configuration object.`);
        }
        ts.forEachChild(node, configLoad);
      }
      configLoad(parsed);
      if (/(webpack|turbopack|turbo|modularizeImports|optimizePackageImports|resolveAlias|resolveExtensions|extensionAlias|resolveFallback|tsconfigPath|swcPlugins|pageExtensions|relay|emotion)/.test(source)) {
        throw new Error(`${configFile} declares a resolver or import transform the shell deferral gate does not model.`);
      }
    }
  }
}

export function shellDeferredViolations({ root = repoRoot } = {}) {
  const discovered = discoverShellEntryRoots(root);
  assertModeledResolution(root);
  const result = analyzeStaticReachability({
    roots: [...new Set([...shellEntryRoots, ...discovered])],
    deferred: deferredShellModules,
    has: fileChecker(root),
    read: (file) => readFileSync(path.join(root, file), "utf8"),
  });
  return { ...result, unlistedRoots: discovered.filter((file) => !shellEntryRoots.includes(file)) };
}

export function formatShellDeferredFindings({ violations, unresolved, missingDeferred, unlistedRoots = [] }) {
  return [
    ...violations.map(({ path: file, flow, chain, importer, specifier }) =>
      `${file} (${flow}) is statically reachable from the authenticated shell.\n  Import chain: ${chain.join(" -> ")}\n  ${importer ? `${importer} imports ${JSON.stringify(specifier)}` : `${file} is a shell entry root`}`),
    ...unresolved.map(({ importer, specifier, chain }) =>
      `Unresolved static import: ${importer ? `${importer} imports ${JSON.stringify(specifier)}` : `missing shell entry root ${specifier}`}\n  Import chain: ${chain.join(" -> ")}`),
    ...missingDeferred.map(({ path: file, flow }) => `Missing listed deferred module: ${file} (${flow}); update the stale defer list.`),
    ...unlistedRoots.map((file) => `${file} is a shell entry file not listed in shellEntryRoots; add it so the walk covers it.`),
  ];
}

if (executedAsScript(import.meta.url)) {
  try {
    const result = shellDeferredViolations();
    const findings = formatShellDeferredFindings(result);
    if (findings.length) {
      for (const finding of findings) console.error(finding);
      process.exitCode = 1;
    } else console.log(`Shell flows stay deferred: ${shellEntryRoots.length} entry roots, ${result.reachable.size} reachable files, 0 violations.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
