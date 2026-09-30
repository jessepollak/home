import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executedAsScript } from "../worktree/bootstrap.mjs";
import { loadSourceFiles } from "./source-files.mjs";

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
const requestTimeCall = /\b(?:headers|cookies|draftMode|connection|noStore|unstable_noStore)\s*\(/;
// Only a GET handler is statically prerendered, so a file exporting only other methods needs no dynamic
// signal. An unmodeled form still does: a re-exported GET counts as a GET, and a file with no recognized
// method export at all requires a signal, so no export form fails open.
const methods = "GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS";
const methodExport = new RegExp(`\\bexport\\s+(?:(?:async\\s+)?function\\s+(?:${methods})\\s*\\(|(?:const|let|var)\\s+(?:${methods})\\s*[:=])`);
const prerenderableExport = new RegExp(`\\bexport\\s+(?:(?:async\\s+)?function\\s+(?:GET|HEAD)\\s*\\(|(?:const|let|var)\\s+(?:GET|HEAD)\\s*[:=]|\\{[^{}]*\\b(?:GET|HEAD)\\b)`);
const needsDynamicSignal = (content) => prerenderableExport.test(content) || !methodExport.test(content);

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
    if (routeHandler.test(path.basename(file)) && path.basename(file) !== "route.ts") {
      findings.push({ path: file, reason: "unrecognized route handler form; this gate models only route.ts" });
    } else if (forceStatic.test(content)) {
      findings.push({ path: file, reason: 'declares `export const dynamic = "force-static"`' });
    } else if (needsDynamicSignal(content) && ![forceDynamic, zeroRevalidate, requestHandler, requestArrow, requestTimeCall].some((signal) => signal.test(content))) {
      findings.push({ path: file, reason: "no request-time read and no dynamic route segment" });
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
    for (const finding of staticSources) console.error(`${finding.path}: ${finding.reason}; a GET handler here can be prerendered into one shared static response. Read the request argument, headers(), cookies(), connection(), or declare \`export const dynamic = "force-dynamic"\`. See ${guidanceUrl}`);
    for (const route of prerendered) console.error(`${route}: prerendered into the build output (${relativeManifestPath}); every caller would receive the same static response. Its route handler must read the request at run time or declare \`export const dynamic = "force-dynamic"\`. See ${guidanceUrl}`);
    if (staticSources.length || prerendered.length) process.exitCode = 1;
    else console.log(`API routes stay dynamic: ${apiRouteCount} route handlers, 0 prerendered.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
