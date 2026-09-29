import { type Page, type Request } from "@playwright/test";
import { navigationCycles, navigationPaths, navigationSettleMs } from "./config";
import { fillFeed, installFeed } from "./feed";
import { inlineFixtureMark, leakCycle, resourceSnapshot, twoFrames, type Session, type CpuRate } from "./browser";
import { median, percentile } from "./evaluate";

export async function ready(page: Page, path: string) {
  await page.waitForURL((url) => url.pathname === path, { timeout: 20_000 });
  await page.locator('#navigation-panel:not([aria-busy="true"])').waitFor({ timeout: 20_000 });
  if (path === "/activity") {
    await page.locator('section[aria-label="Activity"]:not(#navigation-panel) ul > li').first().waitFor({ timeout: 20_000 });
  } else if (path === "/home") {
    await page.getByRole("button", { name: "Send", exact: true }).first().waitFor({ timeout: 20_000 });
  } else {
    const name = path === "/investments" ? "Investments" : path === "/balances" ? "Your money"
      : path === "/invest" ? "Invest" : path === "/borrow" ? "Borrow" : "Cash";
    await page.locator("[data-shell-header-title]").first().getByText(name, { exact: true }).waitFor({ timeout: 20_000 });
  }
}

function control(page: Page, path: string) {
  if (path === "/invest") return page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Invest", exact: true });
  if (path === "/cash") return page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ });
  if (path === "/investments") return page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Investments/ });
  if (path === "/borrow") return page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Borrow Cash/ });
  throw new Error(`No Home navigation control for ${path}`);
}

export async function navigate(page: Page, path: string, requests?: { method: string; path: string; window: string }[], cycle = 0) {
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    requests?.push({ method: request.method(), path: url.pathname + url.search, window: `${cycle}: ${path}` });
  };
  if (requests) page.on("request", onRequest);
  const start = performance.now();
  try {
    await control(page, path).click();
    await ready(page, path);
    const latency = performance.now() - start;
    await twoFrames(page);
    await page.waitForTimeout(navigationSettleMs);
    return latency;
  } finally { page.off("request", onRequest); }
}

export async function home(page: Page, requests?: { method: string; path: string; window: string }[], cycle = 0) {
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    requests?.push({ method: request.method(), path: url.pathname + url.search, window: `${cycle}: home` });
  };
  if (requests) page.on("request", onRequest);
  const start = performance.now();
  try {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
    await ready(page, "/home");
    const latency = performance.now() - start;
    await twoFrames(page);
    await page.waitForTimeout(navigationSettleMs);
    return latency;
  } finally { page.off("request", onRequest); }
}

export async function runNavigation(session: Session, baseUrl: string, rows: number, collectGrowth: boolean, seedLeak: boolean,
  paths: readonly string[] = navigationPaths) {
  const { page } = session;
  await page.clock.install({ time: new Date() });
  await inlineFixtureMark(page);
  const fixture = await installFeed(page, rows);
  await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" });
  await ready(page, "/home");
  await fillFeed(session, rows, fixture.filled, "section[data-activity-feed]");
  fixture.verify();
  await page.locator("main[data-app-main-authenticated]").evaluate((main) => { main.scrollTop = 0; });
  await twoFrames(page);
  for (const path of paths) {
    await navigate(page, path);
    await home(page);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  await page.clock.setFixedTime(new Date());
  const latencies: number[] = [];
  const cpu: CpuRate[] = [];
  const requests: { method: string; path: string; window: string }[] = [];
  let second: Awaited<ReturnType<typeof resourceSnapshot>> | null = null;
  let tenth: Awaited<ReturnType<typeof resourceSnapshot>> | null = null;
  const started = Date.now();
  for (let cycle = 1; cycle <= navigationCycles; cycle++) {
    for (const path of paths) {
      latencies.push(await navigate(page, path, requests, cycle));
      cpu.push({ ...session.cpu });
      latencies.push(await home(page, requests, cycle));
      cpu.push({ ...session.cpu });
    }
    await leakCycle(page, seedLeak);
    if (collectGrowth && cycle === 2) second = await resourceSnapshot(session);
    if (collectGrowth && cycle === 10) tenth = await resourceSnapshot(session);
  }
  const durationMs = Date.now() - started;
  if (durationMs >= 55_000) throw new Error(`Navigation windows crossed the 60 s savings poll interval (${durationMs} ms)`);
  return { latencies, cpu, p50: median(latencies), p95: percentile(latencies, 0.95), samples: latencies.length,
    requests, durationMs, growth: second && tenth ? {
      nodes: tenth.nodes - second.nodes, listeners: tenth.listeners - second.listeners,
      heapBytes: tenth.heapBytes - second.heapBytes, second, tenth,
    } : null };
}
