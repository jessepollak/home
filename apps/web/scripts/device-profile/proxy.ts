import { link, mkdir, realpath, unlink, writeFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fixtureRoutes } from "../../tests/browser/feature-map/fixtures";
import { activityPage, syntheticActivity } from "./synthetic-activity";
import { syntheticPriceHistory } from "./synthetic-prices";
import { artifactName, integer, routeFor, validPlan, validResult, workloads, type Plan } from "./model";

export type ProxyOptions = { port: number; host: string; upstream: string; rows: number; outDir: string };
export const defaults = (): ProxyOptions => ({ port: 4199, host: "127.0.0.1", upstream: `http://127.0.0.1:${process.env.HOME_FIXTURE_PORT ?? 3199}`, rows: 300, outDir: resolve(tmpdir(), "home-device-profile") });
export function proxyOptions(flags: Map<string, string>): ProxyOptions {
  for (const flag of flags.keys()) if (!["port", "host", "upstream", "rows", "out-dir"].includes(flag)) throw new Error(`Unknown proxy flag --${flag}`);
  const options = defaults();
  options.port = integer(flags.get("port") ?? String(options.port), 1, 65535) ?? 0;
  options.rows = integer(flags.get("rows") ?? String(options.rows), 1, 2000) ?? 0;
  options.host = flags.get("host") ?? options.host;
  options.upstream = flags.get("upstream") ?? options.upstream;
  options.outDir = resolve(flags.get("out-dir") ?? options.outDir);
  const upstream = new URL(options.upstream);
  if (!options.port || !options.rows || !["127.0.0.1", "0.0.0.0"].includes(options.host) || upstream.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname) || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("Invalid proxy options (upstream must be loopback HTTP)");
  return options;
}
/** True only for a loopback peer, including the IPv4 form Bun reports for an IPv4 connection.
 * The status endpoint exposes the runner's output directory, so a LAN client must never qualify. */
export const isLoopbackAddress = (address: string | null) => {
  if (address === null) return false;
  const normalized = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return normalized === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
};
export async function assertOutsideWorktree(path: string) {
  await mkdir(path, { recursive: true });
  const out = await realpath(path);
  const root = await realpath(resolve(import.meta.dir, "../../../.."));
  const rel = relative(root, out);
  if (!rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep))) throw new Error("Output directory must be outside the git worktree");
}
export function matches(pattern: string, url: string) {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "*") { if (pattern[i + 1] === "*") { regex += ".*"; i++; } else regex += "[^/]*"; }
    else regex += pattern[i]!.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
  }
  return new RegExp(`${regex}$`).test(url);
}
export const htmlInjection = `<script>sessionStorage.setItem("home:playwright-smoke:signed-in","1");if(!localStorage.getItem("home.country.v2"))localStorage.setItem("home.country.v2","US");</script><script src="/__device-profile/harness.js" defer></script>`;
export function injectHtml(html: string) { return html.replace(/<head([^>]*)>/i, `<head$1>${htmlInjection}`); }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const bad = (message: string, status = 400) => json({ error: message }, status);
export function fixtureBody(url: URL, rows: number, anchor: number) {
  const path = url.pathname;
  if (path === "/api/market-prices/history") return syntheticPriceHistory(url.searchParams.get("assetId") ?? "", url.searchParams.get("range") ?? "", anchor) ?? undefined;
  const data = syntheticActivity(rows, anchor);
  if (path === "/api/activity") {
    const to = url.searchParams.get("to") ?? new Date(anchor + 120_000).toISOString();
    try {
      const body = activityPage(data, url.searchParams.get("cursor") ?? "initial", to, url.searchParams.get("currency") ?? "USD");
      return { ...body, transfers: body.transfers.map((transfer) => ({ ...transfer, tokenImageUrl: null })) };
    } catch { return null; }
  }
  if (path === "/api/actions") return { actions: data.actions };
  const routes = fixtureRoutes().filter(([pattern]) => matches(pattern, url.href))
    .sort(([a], [b]) => b.replace(/\*/g, "").length - a.replace(/\*/g, "").length);
  return routes[0]?.[1];
}
export function cookieRows(cookie: string | null, fallback: number) { return integer(cookie?.match(/(?:^|;\s*)home-device-profile-rows=([^;]*)/)?.[1], 1, 2000) ?? fallback; }
export function parsePlan(url: URL, fallback: number): Plan | null {
  const p = { workload: url.searchParams.get("workload"), rows: integer(url.searchParams.get("rows") ?? String(fallback), 1, 2000), label: url.searchParams.get("label") ?? "device", repeat: integer(url.searchParams.get("repeat") ?? "1", 1, 20), duration: integer(url.searchParams.get("duration") ?? "10", 1, 120) };
  return validPlan(p) ? p : null;
}
async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); throw new Error("Body over limit"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function createHandler(options: ProxyOptions, harness: string, now = () => Date.now()) {
  const origin = new URL(options.upstream);
  const anchor = now() - 120_000;
  const handle = async (request: Request, clientAddress: string | null): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/__device-profile/harness.js") return new Response(harness, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
    if (path === "/__device-profile/") return new Response(`<html><head><title>Device profile</title></head><body><h1>Device profile</h1>${workloads.map((id) => `<p><a href="/__device-profile/run?workload=${id}">${id}</a></p>`).join("")}</body></html>`, { headers: { "content-type": "text/html" } });
    if (path === "/__device-profile/run") {
      const plan = parsePlan(url, options.rows);
      if (!plan) return bad("Invalid workload, rows, label, repeat or duration");
      const script = `sessionStorage.setItem("home:device-profile:plan",${JSON.stringify(JSON.stringify(plan))});location.replace(${JSON.stringify(routeFor(plan.workload))})`.replace(/</g, "\\u003c");
      return new Response(`<html><head><script>${script}</script></head></html>`, { headers: { "content-type": "text/html", "set-cookie": `home-device-profile-rows=${plan.rows}; Path=/; SameSite=Lax`, "cache-control": "no-store" } });
    }
    if (path === "/__device-profile/results" && request.method === "POST") {
      if (!request.headers.get("content-type")?.match(/^application\/json(?:;|$)/i)) return bad("JSON required", 415);
      if (Number(request.headers.get("content-length")) > 2_000_000) return bad("Result too large", 413);
      let text: string;
      try { text = await boundedBody(request, 2_000_000); } catch { return bad("Result too large", 413); }
      let value: unknown;
      try { value = JSON.parse(text); } catch { return bad("Invalid JSON"); }
      if (!validResult(value)) return bad("Invalid result");
      const filename = `${now()}-${artifactName(value.plan.label, value.plan.workload, ".json")}`;
      const target = resolve(options.outDir, filename);
      const temporary = `${target}.${crypto.randomUUID()}.writing`;
      await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
      try { await link(temporary, target); } finally { await unlink(temporary).catch(() => {}); }
      return json({ filename });
    }
    if (path === "/__device-profile/status") {
      const since = integer(url.searchParams.get("since") ?? "0", 0, Number.MAX_SAFE_INTEGER);
      if (since === null) return bad("Invalid since");
      const files = (await readdir(options.outDir)).filter((file) => /^\d+-[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+\.json$/.test(file) && Number(file.split("-")[0]) >= since).sort();
      return json(isLoopbackAddress(clientAddress) ? { outDir: options.outDir, files } : { files });
    }
    if (path.startsWith("/__device-profile/")) return bad("Not found", 404);
    if (path.startsWith("/api/")) {
      const rows = cookieRows(request.headers.get("cookie"), options.rows);
      const body = fixtureBody(url, rows, anchor);
      if (body !== undefined) return body === null ? bad("Invalid activity query: check the cursor and date") : json(body);
    }
    const upstream = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.delete("host"); headers.set("accept-encoding", "identity");
    const response = await fetch(upstream, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual" });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length"); responseHeaders.delete("content-encoding");
    if (!response.headers.get("content-type")?.includes("text/html")) return new Response(response.body, { status: response.status, headers: responseHeaders });
    return new Response(injectHtml(await response.text()), { status: response.status, headers: responseHeaders });
  };
  return async (request: Request, clientAddress: string | null = null): Promise<Response> => {
    try { return await handle(request, clientAddress); }
    catch (error) { console.error(`Device profile proxy request failed: ${String(error)}`); return bad("Device profile proxy failed", 500); }
  };
}
export async function startProxy(options: ProxyOptions) {
  await assertOutsideWorktree(options.outDir);
  const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "harness.ts")], target: "browser", minify: true });
  if (!build.success) throw new Error(build.logs.map(String).join("\n"));
  const handler = createHandler(options, await build.outputs[0]!.text());
  const server = Bun.serve({ port: options.port, hostname: options.host, development: false, error: () => bad("Device profile proxy failed", 500), fetch: (request, peer) => handler(request, peer.requestIP(request)?.address ?? null) });
  if (options.host === "0.0.0.0") console.warn("Warning: fixture server is LAN-visible; do not expose it to the internet.");
  console.log(`Device profile proxy: http://${options.host}:${server.port}/__device-profile/`);
  return server;
}
