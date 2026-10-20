import { errors, type ConsoleMessage, type Page, type Request } from "@playwright/test";
import { navigationCycles, navigationPaths, navigationSettleMs } from "./config";
import { fillFeed, installFeed } from "./feed";
import { inlineFixtureMark, leakCycle, resourceSnapshot, twoFrames, type Session, type CpuRate } from "./browser";
import { median, percentile } from "./evaluate";
import { clipTail, readinessBudgetMs, redactUrl, runReadiness, serverProbeDeadlineMs, stageDeadlineMs, type ServerResponse } from "./readiness";

export async function ready(page: Page, path: string, options: { baseUrl?: string; leg?: string; cycle?: number } = {}) {
  let consoleTail: string[] = [], failedRequestTail: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "warning" || message.type() === "error") consoleTail = clipTail([...consoleTail, message.text()]);
  };
  const onRequestFailed = (request: Request) => {
    failedRequestTail = clipTail([...failedRequestTail, `${request.method()} ${redactUrl(request.url())} — ${request.failure()?.errorText ?? "request failed"}`]);
  };
  const probe = async (): Promise<ServerResponse | null> => {
    let origin: string;
    try {
      const url = new URL(options.baseUrl ?? page.url());
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      origin = url.origin;
    } catch { return null; }
    const started = performance.now();
    try {
      const response = await fetch(new URL(path, origin), { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(serverProbeDeadlineMs) });
      const ttfbMs = performance.now() - started;
      void response.body?.cancel().catch(() => {});
      return { status: response.status, ttfbMs, error: null };
    } catch (error) {
      return { status: null, ttfbMs: null, error: error instanceof Error ? error.message : String(error) };
    }
  };
  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);
  const started = performance.now();
  const timeout = () => Math.max(1, Math.min(stageDeadlineMs, readinessBudgetMs - serverProbeDeadlineMs - (performance.now() - started)));
  try {
    return await runReadiness({ path, leg: options.leg, cycle: options.cycle, probe, tails: () => ({ consoleTail, failedRequestTail }), stages: [
      { stage: "url", wait: () => page.waitForURL((url) => url.pathname === path, { timeout: timeout() }) },
      { stage: "busy-panel", wait: () => page.locator('#navigation-panel:not([aria-busy="true"])').waitFor({ timeout: timeout() }) },
      { stage: "content", wait: async () => {
        if (path === "/activity") {
          await page.locator('section[aria-label="Activity"]:not(#navigation-panel) ul > li').first().waitFor({ timeout: timeout() });
        } else if (path === "/home") {
          await page.getByRole("button", { name: "Send", exact: true }).first().waitFor({ timeout: timeout() });
        } else {
          const name = path === "/investments" ? "Investments"
            : path === "/invest" ? "Invest" : path === "/borrow" ? "Borrow" : "Cash";
          await page.locator("[data-shell-header-title]").first().getByText(name, { exact: true }).waitFor({ timeout: timeout() });
        }
      } },
    ] });
  } finally {
    page.off("console", onConsole);
    page.off("requestfailed", onRequestFailed);
  }
}

export async function gotoReady(page: Page, baseUrl: string, path: string, options: {
  leg?: string; waitUntil?: NonNullable<Parameters<Page["goto"]>[1]>["waitUntil"];
} = {}) {
  const leg = options.leg ?? "initial";
  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: options.waitUntil ?? "domcontentloaded" });
  } catch (error) {
    const stalled = error instanceof errors.TimeoutError || (error instanceof Error && /net::ERR_|NS_ERROR_/.test(error.message));
    if (stalled) await ready(page, path, { baseUrl, leg });
    throw error;
  }
  await ready(page, path, { baseUrl, leg });
}

function control(page: Page, path: string) {
  if (path === "/invest") return page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Invest", exact: true });
  if (path === "/cash") return page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ });
  if (path === "/investments") return page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Investments/ });
  if (path === "/borrow") return page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Borrow Cash/ });
  throw new Error(`No Home navigation control for ${path}`);
}

export async function navigate(page: Page, path: string, requests?: { method: string; path: string; window: string }[], cycle = 0, baseUrl?: string) {
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    requests?.push({ method: request.method(), path: url.pathname + url.search, window: `${cycle}: ${path}` });
  };
  if (requests) page.on("request", onRequest);
  const start = performance.now();
  try {
    await control(page, path).click();
    await ready(page, path, { baseUrl, leg: "outbound", cycle });
    const latency = performance.now() - start;
    await twoFrames(page);
    await page.waitForTimeout(navigationSettleMs);
    return latency;
  } finally { page.off("request", onRequest); }
}

export async function home(page: Page, requests?: { method: string; path: string; window: string }[], cycle = 0, baseUrl?: string) {
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    requests?.push({ method: request.method(), path: url.pathname + url.search, window: `${cycle}: home` });
  };
  if (requests) page.on("request", onRequest);
  const start = performance.now();
  try {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
    await ready(page, "/home", { baseUrl, leg: "home", cycle });
    const latency = performance.now() - start;
    await twoFrames(page);
    await page.waitForTimeout(navigationSettleMs);
    return latency;
  } finally { page.off("request", onRequest); }
}

export async function browserBack(page: Page, cycle = 0, baseUrl?: string) {
  const start = performance.now();
  await page.goBack();
  await ready(page, "/home", { baseUrl, leg: "back", cycle });
  const latency = performance.now() - start;
  await twoFrames(page);
  await page.waitForTimeout(navigationSettleMs);
  return latency;
}

export async function runNavigation(session: Session, baseUrl: string, rows: number, collectGrowth: boolean, seedLeak: boolean,
  paths: readonly string[] = navigationPaths) {
  const { page } = session;
  await page.clock.install({ time: new Date() });
  await inlineFixtureMark(page);
  const fixture = await installFeed(page, rows);
  await gotoReady(page, baseUrl, "/home");
  await fillFeed(session, rows, fixture.filled, "section[data-activity-feed]");
  fixture.verify();
  await page.evaluate(() => window.scrollTo(0, 0));
  await twoFrames(page);
  await warmNavigation(page, paths, { baseUrl });
  const latencies: number[] = [];
  const latenciesByPath: Record<string, number[]> = Object.fromEntries(paths.map((path) => [path, []]));
  const cpu: CpuRate[] = [];
  const requests: { method: string; path: string; window: string }[] = [];
  let second: Awaited<ReturnType<typeof resourceSnapshot>> | null = null;
  let tenth: Awaited<ReturnType<typeof resourceSnapshot>> | null = null;
  const started = Date.now();
  for (let cycle = 1; cycle <= navigationCycles; cycle++) {
    for (const path of paths) {
      const outbound = await navigate(page, path, requests, cycle, baseUrl);
      latencies.push(outbound);
      latenciesByPath[path]!.push(outbound);
      cpu.push({ ...session.cpu });
      const inbound = await home(page, requests, cycle, baseUrl);
      latencies.push(inbound);
      latenciesByPath[path]!.push(inbound);
      cpu.push({ ...session.cpu });
    }
    await leakCycle(page, seedLeak);
    if (collectGrowth && cycle === 2) second = await resourceSnapshot(session);
    if (collectGrowth && cycle === 10) tenth = await resourceSnapshot(session);
  }
  const durationMs = Date.now() - started;
  if (durationMs >= 55_000) throw new Error(`Navigation windows crossed the 60 s savings poll interval (${durationMs} ms)`);
  return { latencies, latenciesByPath, cpu, p50: median(latencies), p95: percentile(latencies, 0.95), samples: latencies.length,
    requests, durationMs, growth: second && tenth ? {
      nodes: tenth.nodes - second.nodes, listeners: tenth.listeners - second.listeners,
      heapBytes: tenth.heapBytes - second.heapBytes, second, tenth,
    } : null };
}

export async function warmNavigation(page: Page, paths: readonly string[], options: { freezeTime?: boolean; baseUrl?: string } = {}) {
  for (const path of paths) {
    await navigate(page, path, undefined, 0, options.baseUrl);
    await home(page, undefined, 0, options.baseUrl);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  if (options.freezeTime !== false) await page.clock.setFixedTime(new Date());
}
