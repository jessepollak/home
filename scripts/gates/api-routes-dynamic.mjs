import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executedAsScript } from "../worktree/bootstrap.mjs";
import { loadSourceFiles } from "./source-files.mjs";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");

export const defaultWebDir = fileURLToPath(new URL("../../apps/web/", import.meta.url));
export const defaultBuildDir = path.join(defaultWebDir, ".next");
export const guidanceUrl = "https://nextjs.org/docs/app/getting-started/route-handlers#with-cache-components";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];
const routeHandler = /^route\.(?:ts|tsx|js|jsx|mts|cts)$/;
const privateFolder = /(?:^|\/)_[^/]*(?=\/)/;
const forceDynamic = /\bexport\s+const\s+dynamic\s*(?:\s*:\s*(?:[^=]|=>)*)?=\s*(["'])force-dynamic\1/;
const forceStatic = /\bexport\s+const\s+dynamic\s*(?:\s*:\s*(?:[^=]|=>)*)?=\s*(["'])force-static\1/;
const zeroRevalidate = /\bexport\s+const\s+revalidate\s*(?:\s*:\s*(?:[^=]|=>)*)?=\s*0(?:\s*;|\s*$)/m;
const requestHandler = /\bexport\s+(?:async\s+)?function\s+(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s*\(\s*[^\s)]/;
const requestArrow = /\bexport\s+const\s+(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)(?:\s*:\s*(?:[^=]|=>)+)?\s*=\s*(?:async\s*)?\(\s*[^\s)][^)]*\)\s*=>/;
// Under Cache Components a route cannot declare a dynamic segment, so a GET or HEAD bound to a handler factory call
// or a named handler is trusted to read its request there; the build manifest remains the authority for that claim.
const boundHandler = /\bexport\s+const\s+(?:GET|HEAD)(?:\s*:\s*(?:[^=]|=>)+)?\s*=\s*(?!async\b)[A-Za-z_$][\w$.]*\s*(?:\(|;|$)/m;
const boundHandlers = /\bexport\s+const\s+\{[^}]*\b(?:GET|HEAD)\b[^}]*\}\s*=\s*(?!async\b)[A-Za-z_$][\w$.]*\s*\(/;
const requestTimeCall = /\b(?:headers|cookies|draftMode|connection|noStore|unstable_noStore)\s*\(/;
// Only a GET export is statically prerendered. Parse top-level runtime export names, including binding
// patterns and re-exports; parse errors, unknown export forms and files without a recognized method
// require a dynamic signal. HEAD-only handlers need none.
const runtimeMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function bindingNames(name, names) {
  if (ts.isIdentifier(name)) names.add(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) bindingNames(element.name, names);
    }
  }
}

function hasExportModifier(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function exportedNames(content) {
  const source = ts.createSourceFile("route.ts", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) return null;
  const names = new Set();
  let unknown = false;
  for (const statement of source.statements) {
    if (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Ambient) continue;
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
        unknown = true;
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    } else if (ts.isExportAssignment(statement)) {
      unknown = true;
    } else if (hasExportModifier(statement)) {
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
      if (ts.isImportEqualsDeclaration(statement) && statement.isTypeOnly) continue;
      if (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) {
        unknown = true;
      } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        if (statement.name) names.add(statement.name.text);
        else unknown = true;
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names);
      } else {
        unknown = true;
      }
    }
  }
  return { names, unknown };
}

const dynamicSignals = [forceDynamic, zeroRevalidate, requestHandler, requestArrow, boundHandler, boundHandlers, requestTimeCall];

function staticSourceFinding(content) {
  const exports = exportedNames(content);
  if (!exports) return "no request-time read and no dynamic route segment";
  const needsSignal = exports.unknown || exports.names.has("GET") || ![...exports.names].some((name) => runtimeMethods.has(name));
  if (!needsSignal || dynamicSignals.some((signal) => signal.test(content))) return null;
  return "no request-time read and no dynamic route segment";
}

export function prerenderedApiRoutes(manifest) {
  return [...new Set([
    ...Object.keys(manifest.routes),
    ...Object.keys(manifest.dynamicRoutes),
    ...manifest.notFoundRoutes,
  ].filter((route) => typeof route === "string" && (route === "/api" || route.startsWith("/api/"))))].sort();
}

export function routesWithoutDynamicSignal(files) {
  const findings = [];
  for (const { path: file, content } of files) {
    if (privateFolder.test(file)) continue;
    const staticSourceReason = staticSourceFinding(content);
    if (routeHandler.test(path.basename(file)) && path.basename(file) !== "route.ts") {
      findings.push({ path: file, reason: "unrecognized route handler form; this gate models only route.ts" });
    } else if (forceStatic.test(content)) {
      findings.push({ path: file, reason: 'declares `export const dynamic = "force-static"`' });
    } else if (staticSourceReason) {
      findings.push({ path: file, reason: staticSourceReason });
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path));
}

function routeKey(route) {
  return typeof route === "string" && route.startsWith("/");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export async function readPrerenderManifest(buildDir) {
  const manifestPath = path.join(buildDir, "prerender-manifest.json");
  let content;
  try { content = await readFile(manifestPath, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`No prerender manifest in ${buildDir}; run bun run build first.`, { cause: error });
    throw error;
  }
  let manifest;
  try { manifest = JSON.parse(content); }
  catch (error) { throw new Error(`Unreadable prerender manifest at ${manifestPath}: ${error.message}`, { cause: error }); }
  if (!isPlainObject(manifest) || manifest.version !== 4 || !isPlainObject(manifest.routes)
    || !isPlainObject(manifest.dynamicRoutes) || !Array.isArray(manifest.notFoundRoutes)
    || !manifest.notFoundRoutes.every(routeKey) || !Object.keys(manifest.routes).every(routeKey)
    || !Object.keys(manifest.dynamicRoutes).every(routeKey)) {
    throw new Error(`Unrecognized prerender manifest shape in ${manifestPath}; update the gate for this build output.`);
  }
  return manifest;
}

export async function checkApiRoutes(buildDir = defaultBuildDir) {
  const manifest = await readPrerenderManifest(buildDir);
  const apiDir = path.join(defaultWebDir, "app/api");
  const files = (await loadSourceFiles(apiDir, { extensions }))
    .filter(({ path: file }) => routeHandler.test(path.basename(file)))
    .filter(({ path: file }) => !privateFolder.test(file))
    .map(({ path: file, content }) => ({ path: `apps/web/app/api/${file}`, content }));
  if (!files.length) throw new Error(`No API route handlers found under ${apiDir}; the gate cannot verify the router.`);
  return { apiRouteCount: files.length, prerendered: prerenderedApiRoutes(manifest), staticSources: routesWithoutDynamicSignal(files) };
}

if (executedAsScript(import.meta.url)) {
  try {
    const buildDir = process.argv[2] ?? defaultBuildDir;
    const { apiRouteCount, prerendered, staticSources } = await checkApiRoutes(buildDir);
    const relativeManifestPath = path.relative(repoRoot, path.join(buildDir, "prerender-manifest.json")).split(path.sep).join("/");
    for (const finding of staticSources) console.error(`${finding.path}: ${finding.reason}; a GET handler here can be prerendered into one shared static response. Read the request argument, headers() or cookies(), call connection(), or bind it from a request-reading handler factory; Cache Components rejects a route segment dynamic export. See ${guidanceUrl}`);
    for (const route of prerendered) console.error(`${route}: prerendered into the build output (${relativeManifestPath}); every caller would receive the same static response. Its route handler must read the request at run time (the request argument, headers() or cookies()) or call connection(); Cache Components rejects a route segment dynamic export. See ${guidanceUrl}`);
    if (staticSources.length || prerendered.length) process.exitCode = 1;
    else console.log(`API routes stay dynamic: ${apiRouteCount} route handlers, 0 prerendered.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
