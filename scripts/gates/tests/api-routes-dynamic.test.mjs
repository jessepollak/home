import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkApiRoutes, prerenderedApiRoutes, readPrerenderManifest, routesWithoutDynamicSignal } from "../api-routes-dynamic.mjs";

const cli = fileURLToPath(new URL("../api-routes-dynamic.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/prerender-manifest.json", import.meta.url));
const emptyManifest = { version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [] };
const runCli = (dir) => spawnSync(process.execPath, [cli, dir], { encoding: "utf8" });
const source = (content, file = "route.ts") => ({ path: `apps/web/app/api/test/${file}`, content });

async function withBuildDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "home-api-dynamic-gate-"));
  try { await run(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

function staticRouteLine(route, dir) {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const manifestPath = path.relative(repoRoot, path.join(dir, "prerender-manifest.json")).split(path.sep).join("/");
  return `${route}: prerendered into the build output (${manifestPath}); every caller would receive the same static response. Its route handler must read the request at run time or declare \`export const dynamic = "force-dynamic"\`. See https://nextjs.org/docs/app/getting-started/route-handlers#with-cache-components\n`;
}

test("API prerenders include routes, dynamic routes and not-found routes, sorted and unique", () => {
  assert.deepEqual(prerenderedApiRoutes({
    routes: { "/api/z": { routeType: "route" }, "/api/a": {}, "/save": {}, "/apiary": {} },
    dynamicRoutes: { "/api/[id]": { routeType: "route" }, "/invest/[id]": {} },
    notFoundRoutes: ["/api/z", "/api", "/api/missing", "/not-found", "/apiary/missing"],
  }), ["/api", "/api/[id]", "/api/a", "/api/missing", "/api/z"]);
});

test("a seeded static API response fails the build-output check and CLI with guidance", async () => {
  await withBuildDir(async (dir) => {
    await writeFile(path.join(dir, "prerender-manifest.json"), JSON.stringify({
      ...emptyManifest, routes: { "/api/savings/vaults": { routeType: "route" } },
    }));
    assert.deepEqual((await checkApiRoutes(dir)).prerendered, ["/api/savings/vaults"]);
    const result = runCli(dir);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, staticRouteLine("/api/savings/vaults", dir));
    assert.equal(result.stdout, "");
  });
});

test("the symlinked CLI rejects a seeded static API response with guidance", async () => {
  await withBuildDir(async (dir) => {
    await writeFile(path.join(dir, "prerender-manifest.json"), JSON.stringify({
      ...emptyManifest, routes: { "/api/savings/vaults": { routeType: "route" } },
    }));
    const link = path.join(dir, "api-routes-dynamic.mjs");
    await symlink(cli, link);
    const result = spawnSync(process.execPath, [link, dir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, staticRouteLine("/api/savings/vaults", dir));
    assert.equal(result.stdout, "");
  });
});

test("the real build manifest shape and repository route sources pass both halves and the CLI", async () => {
  await withBuildDir(async (dir) => {
    await copyFile(fixture, path.join(dir, "prerender-manifest.json"));
    const result = await checkApiRoutes(dir);
    assert.ok(result.apiRouteCount > 0);
    assert.deepEqual(result.prerendered, []);
    assert.deepEqual(result.staticSources, []);
    const command = runCli(dir);
    assert.equal(command.status, 0);
    assert.equal(command.stderr, "");
    assert.equal(command.stdout, `API routes stay dynamic: ${result.apiRouteCount} route handlers, 0 prerendered.\n`);
  });
});

test("a missing prerender manifest fails closed in the reader, check and CLI", async () => {
  await withBuildDir(async (dir) => {
    const message = `No prerender manifest in ${dir}; run bun run build first.`;
    await assert.rejects(readPrerenderManifest(dir), { message });
    await assert.rejects(checkApiRoutes(dir), { message });
    const result = runCli(dir);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `${message}\n`);
  });
});

test("invalid manifest JSON fails closed with the parser error and CLI exit code", async () => {
  await withBuildDir(async (dir) => {
    const content = "{";
    await writeFile(path.join(dir, "prerender-manifest.json"), content);
    let parserMessage;
    try { JSON.parse(content); }
    catch (error) { parserMessage = error.message; }
    const message = `Unreadable prerender manifest at ${path.join(dir, "prerender-manifest.json")}: ${parserMessage}`;
    await assert.rejects(readPrerenderManifest(dir), { message });
    await assert.rejects(checkApiRoutes(dir), { message });
    const result = runCli(dir);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `${message}\n`);
  });
});

test("unrecognized manifest shapes fail closed instead of silently skipping routes", async () => {
  await withBuildDir(async (dir) => {
    const message = `Unrecognized prerender manifest shape in ${path.join(dir, "prerender-manifest.json")}; update the gate for this build output.`;
    for (const manifest of [null, [], {}, { ...emptyManifest, version: "4" },
      { ...emptyManifest, version: 999 },
      { ...emptyManifest, routes: [] }, { ...emptyManifest, dynamicRoutes: null },
      { ...emptyManifest, notFoundRoutes: {} },
      { ...emptyManifest, notFoundRoutes: [{ route: "/api/private" }] },
      { ...emptyManifest, notFoundRoutes: ["api/private"] },
      { ...emptyManifest, routes: { "api/private": null } },
      { ...emptyManifest, dynamicRoutes: { "api/private": {} } }]) {
      await writeFile(path.join(dir, "prerender-manifest.json"), JSON.stringify(manifest));
      await assert.rejects(readPrerenderManifest(dir), { message });
      await assert.rejects(checkApiRoutes(dir), { message });
      const result = runCli(dir);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, `${message}\n`);
    }
  });
});

test("source declarations, request parameters and request-time API calls are dynamic signals", () => {
  for (const content of [
    'export const dynamic = "force-dynamic";',
    "export const dynamic = 'force-dynamic';",
    "export const revalidate = 0;",
    'export const dynamic: "force-dynamic" = "force-dynamic";',
    "export const revalidate: number = 0;",
    "export const revalidate: ReturnType<() => number> = 0;",
    'export const dynamic: "force-dynamic" | "force-static" = "force-dynamic";',
    "export const revalidate = 0\nexport async function GET() {}",
    "export async function GET(request: Request) {}",
    "export function HEAD(\n request: Request) {}",
    "export const POST = async (request: Request) => Response.json({});",
    "export const GET: RequestHandler = (request: Request) => Response.json({});",
    "export const POST: (request: Request) => Promise<Response> = async (request: Request) => Response.json({});",
    "export const DELETE = (request: Request) => Response.json({});",
    ...["headers", "cookies", "connection", "draftMode", "noStore", "unstable_noStore"]
      .map((name) => `export async function GET() { ${name}(); }`),
  ]) {
    assert.deepEqual(routesWithoutDynamicSignal([source(content)]), [], content);
  }
});

test("only a prerenderable GET or HEAD handler needs a dynamic signal", () => {
  for (const content of [
    "export async function POST() {}",
    "export async function DELETE() {}",
    "export const PATCH = async () => Response.json({});",
    "export const OPTIONS: RequestHandler = () => new Response(null);",
    "export async function POST() {}\nexport async function DELETE() {}",
    "export let POST = async () => Response.json({});",
  ]) {
    assert.deepEqual(routesWithoutDynamicSignal([source(content)]), [], content);
  }
  assert.deepEqual(routesWithoutDynamicSignal([
    { path: "apps/web/app/api/reexport/route.ts", content: "export { handler as GET };" },
    { path: "apps/web/app/api/unmodeled/route.ts", content: "export default async function handler() { return Response.json({}); }" },
    { path: "apps/web/app/api/mixed/route.ts", content: "export async function POST() {}\nexport async function GET() {}" },
    { path: "apps/web/app/api/let/route.ts", content: "export let GET = () => Response.json({});" },
    { path: "apps/web/app/api/typed/route.ts", content: "type POST = never; export { type POST }; export let GET = () => Response.json({}); export const revalidate = 60;" },
    { path: "apps/web/app/api/mixed-reexport/route.ts", content: "export function POST() {}; const handler = () => new Response(null); export { handler as GET };" },
  ]), [
    { path: "apps/web/app/api/let/route.ts", reason: "no request-time read and no dynamic route segment" },
    { path: "apps/web/app/api/mixed-reexport/route.ts", reason: "no request-time read and no dynamic route segment" },
    { path: "apps/web/app/api/mixed/route.ts", reason: "no request-time read and no dynamic route segment" },
    { path: "apps/web/app/api/reexport/route.ts", reason: "no request-time read and no dynamic route segment" },
    { path: "apps/web/app/api/typed/route.ts", reason: "no request-time read and no dynamic route segment" },
    { path: "apps/web/app/api/unmodeled/route.ts", reason: "no request-time read and no dynamic route segment" },
  ]);
});

test("after alone does not make a route dynamic", () => {
  assert.deepEqual(routesWithoutDynamicSignal([
    source("export async function GET() { after(() => {}); return Response.json({}); }"),
  ]), [{
    path: "apps/web/app/api/test/route.ts",
    reason: "no request-time read and no dynamic route segment",
  }]);
});

test("static sources retain sorted display paths and force-static or unknown-form reasons", () => {
  assert.deepEqual(routesWithoutDynamicSignal([
    source('export const dynamic = "force-dynamic";', "route.jsx"),
    source('export const dynamic = "force-static"; export async function GET(request: Request) {}'),
    { path: "apps/web/app/api/bare/route.ts", content: "export async function GET( ) { return Response.json({}); }" },
    { path: "apps/web/app/api/arrow/route.ts", content: "export const GET = async () => Response.json({});" },
  ]), [
    { path: "apps/web/app/api/arrow/route.ts", reason: "no request-time read and no dynamic route segment" },
    { path: "apps/web/app/api/bare/route.ts", reason: "no request-time read and no dynamic route segment" },
    { path: "apps/web/app/api/test/route.jsx", reason: "unrecognized route handler form; this gate models only route.ts" },
    { path: "apps/web/app/api/test/route.ts", reason: 'declares `export const dynamic = "force-static"`' },
  ]);
  for (const content of ["export const revalidate = 0.5;", "export const revalidate = 60;", "export const revalidate = 0 + 60;"]) {
    assert.equal(routesWithoutDynamicSignal([source(content)]).length, 1);
  }
  for (const extension of ["tsx", "js", "jsx", "mts", "cts"]) {
    assert.deepEqual(routesWithoutDynamicSignal([source('export const dynamic = "force-dynamic";', `route.${extension}`)]), [
      { path: `apps/web/app/api/test/route.${extension}`, reason: "unrecognized route handler form; this gate models only route.ts" },
    ]);
  }
});

test("route handlers inside private folders are not routes and are skipped", () => {
  assert.deepEqual(routesWithoutDynamicSignal([
    { path: "apps/web/app/api/_fixtures/route.ts", content: "export const fixture = {};" },
    { path: "apps/web/app/api/vaults/_helpers/route.ts", content: "export const helper = {};" },
    source("export async function GET() { return Response.json({}); }"),
  ]), [{
    path: "apps/web/app/api/test/route.ts",
    reason: "no request-time read and no dynamic route segment",
  }]);
});
