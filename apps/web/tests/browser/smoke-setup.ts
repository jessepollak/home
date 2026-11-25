import { connect } from "node:net";
import { request, type APIRequestContext, type FullConfig } from "@playwright/test";
import { homeSessionToken } from "./fixtures/session";

// Readiness waits only for next dev to print "Ready", so every compile happens
// here, serially, before browser workers race over the dev bundler. This time
// counts toward the smoke global/job budgets. Each request gets its own 60s cap,
// so a slow restored-cache compile reports where the time went instead of
// landing on Playwright's 30s default; the CI step matches the
// "Smoke compile ... no response" line to rerun once without the cache.
const warmUpTimeoutMs = 60_000;
const authenticatedPaths = ["/admin", "/admin/settings/funding", "/cash/savings"];

export default async function smokeSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  const cookieKey = ["HOME", "PLAYWRIGHT", "ACCESS", "COOKIE"].join("_");
  const accessCookie = process.env[cookieKey];
  if (!baseURL || !accessCookie) throw new Error("Smoke setup requires fixture baseURL and deployment access.");
  const anonymous = await request.newContext({ baseURL });
  const authenticated = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      cookie: `${accessCookie}; home-session=${homeSessionToken("0x1111111111111111111111111111111111111111")}`,
    },
  });
  const timings: string[] = [];
  try {
    await compile(anonymous, baseURL, "/", 307, timings);
    for (const path of authenticatedPaths) await compile(authenticated, baseURL, path, 200, timings);
  } finally {
    await Promise.all([anonymous.dispose(), authenticated.dispose()]);
  }
}

async function compile(
  context: APIRequestContext,
  baseURL: string,
  path: string,
  expectedStatus: number,
  timings: string[],
) {
  const started = performance.now();
  let status: number;
  try {
    const response = await context.get(path, { maxRedirects: 0, timeout: warmUpTimeoutMs });
    status = response.status();
    await response.dispose();
  } catch (error) {
    const url = new URL(path, baseURL);
    const listening = await listeningAddresses(Number(url.port));
    throw new Error(
      `Smoke compile ${path}: no response in ${Math.round(performance.now() - started)}ms from ${url.href}; ` +
        `listening on ${listening.length ? listening.join(", ") : "no loopback address"}; ` +
        `earlier compiles: ${timings.length ? timings.join(", ") : "none"}; ` +
        `${Math.round(process.uptime())}s since Playwright started. ${String(error)}`,
    );
  }
  const elapsed = Math.round(performance.now() - started);
  if (status !== expectedStatus) throw new Error(`Smoke compile ${path}: HTTP ${status} after ${elapsed}ms`);
  timings.push(`${path} ${elapsed}ms`);
  console.log(`Smoke compile ${path}: ${elapsed}ms`);
}

async function listeningAddresses(port: number): Promise<string[]> {
  const hosts = ["127.0.0.1", "::1"];
  const open = await Promise.all(hosts.map((host) => new Promise<boolean>((resolve) => {
    const socket = connect({ host, port, timeout: 1_000 });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  })));
  return hosts.filter((_, index) => open[index]).map((host) => host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`);
}
