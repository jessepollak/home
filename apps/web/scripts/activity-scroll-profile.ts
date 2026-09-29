import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { seedSignedInSession, installApiFixtures, json } from "../tests/browser/fixtures/api";
import { syntheticActivity, activityPage } from "./device-profile/synthetic-activity";

const options = new Map<string, string>();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]!.startsWith("--") || args[i + 1] === undefined) throw new Error(`Unexpected argument: ${args[i]}`);
  options.set(args[i]!.slice(2), args[i + 1]!);
}
const option = (key: string, fallback: string) => options.get(key) ?? fallback;
const integer = (key: string, fallback: number) => {
  const value = Number(option(key, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid --${key}`);
  return value;
};
const rows = integer("rows", 300);
const flingDistance = integer("fling-distance", 0);
const repeat = integer("repeat", 1);
const throttle = integer("cpu-throttle", 1);
const networkDelay = integer("network-delay", 0);
const imageDelay = integer("image-delay", 0);
const routePath = option("route", "/activity");
const viewport = option("viewport", "mobile");
const browserMode = option("browser", "chromium");
const baseUrl = option("base-url", `http://localhost:${process.env.HOME_FIXTURE_PORT ?? "3199"}`);
const cpuProfilePath = options.get("cpu-profile");
if (cpuProfilePath && repeat !== 1) throw new Error("--cpu-profile requires --repeat 1");
if (!rows || !repeat || ![1, 4, 6].includes(throttle) || !["/home", "/activity"].includes(routePath) ||
  !["mobile", "desktop"].includes(viewport) || !["chromium", "chrome", "shell", "headed"].includes(browserMode) ||
  new URL(baseUrl).protocol !== "http:") throw new Error("Invalid profiling options");
const origin = new URL(baseUrl).origin;
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Use a loopback fixture server only");
const { transferCount, actionCount, pageSize, wallet, timestamp, transfers, actions } = syntheticActivity(rows, Date.now() - 120_000);
const selector = routePath === "/home" ? "section[data-activity-feed]" : 'section[aria-label="Activity"]:not([id="navigation-panel"])';
const rowSelector = `${selector} ul > li`;
const metricNames = ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration", "LayoutCount"];
const percentile = (values: number[], p: number) => values.length ? values[Math.ceil(values.length * p) - 1]! : 0;
const round = (value: number) => Math.round(value * 100) / 100;
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function start(page: Page, cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>) {
  const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((entry) => [entry.name, entry.value]));
  await page.evaluate(() => {
    const w = window as typeof window & { __profile?: { frames: number[]; tasks: number[]; loafs: number[]; blocking: number[]; blankFrames: number; maxBlankPx: number; stop: () => void } };
    const frames: number[] = [], tasks: number[] = [], loafs: number[] = [], blocking: number[] = [];
    let previous = 0, running = true, blankFrames = 0, maxBlankPx = 0;
    const tick = (time: number) => {
      if (!running) return;
      if (previous) frames.push(time - previous);
      previous = time;
      const main = document.querySelector<HTMLElement>("main[data-app-main-authenticated]");
      const list = [...(main?.querySelectorAll<HTMLElement>('section[data-activity-feed] ul, section[aria-label="Activity"]:not([id="navigation-panel"]) ul') ?? [])]
        .filter((node) => node.getClientRects().length > 0).at(-1);
      if (main && list) {
        const viewport = main.getBoundingClientRect(), bounds = list.getBoundingClientRect();
        const top = Math.max(viewport.top, bounds.top), bottom = Math.min(viewport.bottom, bounds.bottom);
        if (bottom > top) {
          const intervals = [...list.querySelectorAll("li")].map((row) => row.getBoundingClientRect())
            .filter((rect) => rect.bottom > top && rect.top < bottom).sort((a, b) => a.top - b.top);
          let covered = top, blank = 0;
          for (const rect of intervals) { blank = Math.max(blank, Math.max(0, rect.top - covered)); covered = Math.max(covered, rect.bottom); }
          blank = Math.max(blank, Math.max(0, bottom - covered));
          if (blank > 0.5) { blankFrames += 1; maxBlankPx = Math.max(maxBlankPx, blank); }
        }
      }
      requestAnimationFrame(tick);
    };
    const taskObserver = new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push(entry.duration); });
    const loafObserver = new PerformanceObserver((list) => { for (const entry of list.getEntries()) { loafs.push(entry.duration); blocking.push((entry as PerformanceEntry & { blockingDuration: number }).blockingDuration ?? 0); } });
    taskObserver.observe({ type: "longtask", buffered: false });
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) loafObserver.observe({ type: "long-animation-frame", buffered: false });
    requestAnimationFrame(tick);
    w.__profile = { frames, tasks, loafs, blocking, get blankFrames() { return blankFrames; }, get maxBlankPx() { return maxBlankPx; }, stop: () => { running = false; taskObserver.disconnect(); loafObserver.disconnect(); } };
  });
  return before;
}
async function snapshot(page: Page, cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>, loadedRows: number, blankCheck = { framesWithBlank: 0, maxBlankPx: 0 }) {
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((entry) => [entry.name, entry.value]));
  const dom = await page.evaluate((rowSelector) => ({ elements: document.querySelectorAll("*").length, rows: document.querySelectorAll(rowSelector).length }), rowSelector);
  return { heapBytes: metrics.JSHeapUsedSize ?? 0, nodes: metrics.Nodes ?? 0, listeners: metrics.JSEventListeners ?? 0, loadedRows, mountedRows: dom.rows, blankCheck, ...dom };
}
async function stop(page: Page, cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>, before: Record<string, number>, loadedRows: number) {
  const recorded = await page.evaluate(() => {
    const w = window as typeof window & { __profile?: { frames: number[]; tasks: number[]; loafs: number[]; blocking: number[]; blankFrames: number; maxBlankPx: number; stop: () => void } };
    const data = w.__profile!; data.stop(); return { frames: data.frames, tasks: data.tasks, loafs: data.loafs, blocking: data.blocking, blankCheck: { framesWithBlank: data.blankFrames, maxBlankPx: data.maxBlankPx } };
  });
  const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((entry) => [entry.name, entry.value]));
  const frames = recorded.frames.slice(1).sort((a, b) => a - b);
  return {
    frameCount: frames.length, frameMs: Object.fromEntries([50, 90, 95, 99].map((p) => [`p${p}`, round(percentile(frames, p / 100))]).concat([["max", round(frames.at(-1) ?? 0)]])),
    over16Pct: round(frames.filter((n) => n > 16.7).length / Math.max(frames.length, 1) * 100),
    over33Pct: round(frames.filter((n) => n > 33.4).length / Math.max(frames.length, 1) * 100),
    longTasks: { count: recorded.tasks.length, totalMs: round(recorded.tasks.reduce((a, b) => a + b, 0)), longestMs: round(Math.max(0, ...recorded.tasks)) },
    loaf: { count: recorded.loafs.length, blockingMs: round(recorded.blocking.reduce((a, b) => a + b, 0)), longestMs: round(Math.max(0, ...recorded.loafs)) },
    cdp: Object.fromEntries(metricNames.map((name) => [name, round(((after[name] ?? 0) - (before[name] ?? 0)) * (name === "LayoutCount" ? 1 : 1000))])),
    snapshot: await snapshot(page, cdp, loadedRows, { framesWithBlank: recorded.blankCheck.framesWithBlank, maxBlankPx: round(recorded.blankCheck.maxBlankPx) }),
  };
}
async function fill(page: Page, target: number, loadedRows: () => number) {
  const main = page.locator("main[data-app-main-authenticated]");
  const end = page.locator(`${selector} [role="status"]`).filter({ hasText: "End of activity" });
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    if (loadedRows() === target && await end.isVisible()) return;
    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await delay(150);
  }
  throw new Error(`Fill stopped at ${loadedRows()}/${target} served Activity rows; end visible: ${await end.isVisible()}`);
}
async function runOnce(index: number, video: boolean) {
  const browser = await chromium.launch(browserMode === "headed" ? { headless: false } :
    { headless: true, ...(browserMode !== "shell" ? { channel: browserMode } : {}) });
  const context = await browser.newContext({
    viewport: viewport === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(viewport === "mobile" ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
    ...(video ? { recordVideo: { dir: resolve(options.get("video")!), size: viewport === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 } } } : {}),
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const fetches: Record<string, number> = {};
  const servedTransfers = new Set<string>();
  let actionsFetches = 0;
  const loadedRows = () => servedTransfers.size + (actionsFetches > 0 ? actionCount : 0);
  const finish = (before: Record<string, number>) => stop(page, cdp, before, loadedRows());
  const takeSnapshot = () => snapshot(page, cdp, loadedRows());
  let confirmed = false;
  try {
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.route("**/api/actions*", (request) => {
      if (new URL(request.request().url()).pathname !== "/api/actions") return request.fallback();
      actionsFetches += 1;
      return json(request, { actions: actions.map((action, i) => i === 0 && confirmed ? { ...action, status: "confirmed" } : action) });
    });
    await page.route("**/api/activity*", async (request) => {
      const url = new URL(request.request().url());
      if (url.pathname !== "/api/activity") return request.fallback();
      const cursor = url.searchParams.get("cursor") ?? "initial";
      fetches[cursor] = (fetches[cursor] ?? 0) + 1;
      const to = url.searchParams.get("to")!;
      if (networkDelay) await delay(networkDelay);
      const body = activityPage({ transferCount, actionCount, pageSize, wallet, timestamp, transfers, actions }, cursor, to, url.searchParams.get("currency") ?? "USD");
      for (const transfer of body.transfers) servedTransfers.add(transfer.id);
      return json(request, body);
    });
    await page.route("https://profile.local/token.svg", async (request) => {
      if (imageDelay) await delay(imageDelay);
      await request.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="blue"/></svg>' });
    });
    const loadAt = Date.now();
    await page.goto(`${origin}${routePath}`, { waitUntil: "domcontentloaded" });
    const loadBefore = await start(page, cdp);
    await page.locator(rowSelector).first().waitFor({ timeout: 30_000 });
    const firstRowMs = Date.now() - loadAt;
    const load = await finish(loadBefore);
    const firstPageRows = await page.locator(rowSelector).count();
    const appendBefore = await start(page, cdp);
    let append: ReturnType<typeof stop> extends Promise<infer T> ? T & { responseToRowsMs?: number } : never;
    if (transferCount > pageSize) {
      await page.evaluate(({ rowSelector, firstPageRows }) => {
        const w = window as typeof window & { __append?: { responseAt: number; rowsAt: number } };
        w.__append = { responseAt: 0, rowsAt: 0 };
        const firstMax = Math.max(0, ...[...document.querySelectorAll(rowSelector)].map((row) => Number(row.getAttribute("aria-posinset") ?? 0)));
        const original = window.fetch.bind(window);
        window.fetch = Object.assign(async (...args: Parameters<typeof fetch>) => {
          const response = await original(...args);
          if (String(args[0]).includes("/api/activity?") && String(args[0]).includes("cursor=")) w.__append!.responseAt ||= performance.now();
          return response;
        }, { preconnect: window.fetch.preconnect });
        const observer = new MutationObserver((mutations) => {
          if (!w.__append!.responseAt) return;
          const current = [...document.querySelectorAll(rowSelector)];
          const grew = current.length > firstPageRows || current.some((row) => Number(row.getAttribute("aria-posinset") ?? 0) > firstMax);
          if (grew || mutations.some((mutation) => mutation.type === "childList" && mutation.target instanceof Element && mutation.target.closest("ul"))) {
            w.__append!.rowsAt ||= performance.now(); observer.disconnect();
          }
        });
        observer.observe(document.querySelector(rowSelector)!.parentElement!, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-posinset"] });
      }, { rowSelector, firstPageRows });
      await page.locator("main[data-app-main-authenticated]").evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await page.waitForFunction(() => Boolean((window as typeof window & { __append?: { rowsAt: number } }).__append?.rowsAt), null, { timeout: 30_000 });
      const timing = await page.evaluate(() => (window as typeof window & { __append: { responseAt: number; rowsAt: number } }).__append);
      append = { ...await finish(appendBefore), responseToRowsMs: round(timing.rowsAt - timing.responseAt) };
    } else append = { ...await finish(appendBefore), responseToRowsMs: 0 };
    const fillBefore = await start(page, cdp);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await fill(page, rows, loadedRows);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    const filled = await finish(fillBefore);
    const fillFetches = { ...fetches };
    await page.locator("main[data-app-main-authenticated]").evaluate((element) => { element.scrollTop = 0; });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const beforeFling = await takeSnapshot();
    const flingBefore = await start(page, cdp);
    if (cpuProfilePath && !video) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
    }
    const mainRect = await page.locator("main[data-app-main-authenticated]").boundingBox();
    if (!mainRect) throw new Error("Missing scroll container");
    const position = { x: mainRect.x + mainRect.width / 2, y: mainRect.y + mainRect.height / 2, gestureSourceType: viewport === "mobile" ? "touch" as const : "mouse" as const, speed: 4000 };
    const scrollHeight = await page.locator("main[data-app-main-authenticated]").evaluate((element) => element.scrollHeight);
    const distance = Math.min(flingDistance || scrollHeight, scrollHeight);
    await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: -distance });
    await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: distance });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    if (cpuProfilePath && !video) {
      const { profile } = await cdp.send("Profiler.stop");
      await mkdir(dirname(resolve(cpuProfilePath)), { recursive: true });
      await writeFile(resolve(cpuProfilePath), JSON.stringify(profile));
    }
    const fling = await finish(flingBefore);
    const afterFling = fling.snapshot;
    const detailBefore = await start(page, cdp);
    const middleIndex = Math.floor(rows / 2);
    const virtualized = await page.locator(`${rowSelector}[aria-posinset]`).count() > 0;
    const middleRow = virtualized ? page.locator(`${rowSelector}[aria-posinset="${middleIndex + 1}"]`) : page.locator(rowSelector).nth(middleIndex);
    if (virtualized) {
      await page.locator("main[data-app-main-authenticated]").evaluate((main, { index, total }) => {
        const list = main.querySelector("ul:has(li[aria-posinset])")!;
        main.scrollTop += list.getBoundingClientRect().top - main.getBoundingClientRect().top + list.scrollHeight * index / total - main.clientHeight / 2;
      }, { index: middleIndex, total: rows });
      for (let attempt = 0; attempt < 12 && await middleRow.count() === 0; attempt += 1) {
        await delay(100);
        const nearest = await page.locator(`${rowSelector}[aria-posinset]`).evaluateAll((nodes, index) => nodes.reduce((best, node) => {
          const position = Number(node.getAttribute("aria-posinset")) - 1;
          return Math.abs(position - index) < Math.abs(best - index) ? position : best;
        }, Number(nodes[0]?.getAttribute("aria-posinset")) - 1), middleIndex);
        if (await middleRow.count()) break;
        await page.locator("main[data-app-main-authenticated]").evaluate((main, delta) => { main.scrollTop += delta * 76; }, middleIndex - nearest);
      }
    }
    await middleRow.waitFor({ timeout: 10_000 });
    const middleTime = await middleRow.locator("time[datetime]").first().getAttribute("datetime");
    if (!middleTime) throw new Error("Mid-list row has no timestamp");
    const middle = middleRow.locator("button").first();
    const detailTimes: number[] = [];
    let focusReturned = true;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const t = Date.now();
      await middle.click();
      await page.getByRole("dialog").waitFor({ timeout: 15_000 });
      detailTimes.push(Date.now() - t);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15_000 });
      await page.waitForFunction(({ rowSelector, position, index, datetime }) => {
        const row = [...document.querySelectorAll(rowSelector)].find((element, mountedIndex) =>
          (position === null ? mountedIndex === index : Number(element.getAttribute("aria-posinset")) === position) &&
          element.querySelector("time[datetime]")?.getAttribute("datetime") === datetime);
        return row?.querySelector("button") === document.activeElement;
      }, { rowSelector, position: virtualized ? middleIndex + 1 : null, index: middleIndex, datetime: middleTime }, { timeout: 10_000 });
      focusReturned &&= await middle.evaluate((element) => document.activeElement === element);
    }
    const detail = { ...await finish(detailBefore), openMs: detailTimes, focusReturned };
    const afterCycles = await takeSnapshot();
    confirmed = true;
    const actionsBefore = actionsFetches;
    const statusAt = Date.now();
    const statusBefore = await start(page, cdp);
    await page.locator("main[data-app-main-authenticated]").evaluate((main, rowSelector) => {
      const list = main.querySelector(rowSelector)?.parentElement;
      if (list) main.scrollTop += list.getBoundingClientRect().top - main.getBoundingClientRect().top;
    }, rowSelector);
    const updatedRow = page.locator(rowSelector).filter({ has: page.locator(`time[datetime="${timestamp(1)}"]`), hasText: "Send USDC" });
    for (let attempt = 0; attempt < 80 && await updatedRow.count() === 0; attempt += 1) {
      await page.locator("main[data-app-main-authenticated]").evaluate((main) => { main.scrollTop += main.clientHeight / 2; });
      await delay(70);
    }
    if (await updatedRow.count() === 0) throw new Error("Status row not mounted after scanning from the top of the feed");
    await page.locator("main[data-app-main-authenticated]").evaluate((main) => { main.scrollTop += 200; });
    await page.locator(selector).getByRole("list", { name: "Recent" }).locator("li")
      .filter({ has: page.locator(`time[datetime="${timestamp(1)}"]`), hasText: "Send USDC" })
      .first().waitFor({ timeout: 35_000 });
    const status = { ...await finish(statusBefore), updateToRowsMs: Date.now() - statusAt, method: "in-place actions query polling (15s cash-out refresh)", actionsFetches: actionsFetches - actionsBefore };
    const expectedFetches = Math.ceil(transferCount / pageSize);
    const duplicates = Object.entries(fillFetches).filter(([, count]) => count !== 1);
    return { label: option("label", "baseline"), repetition: index, browser: browserMode, video, route: routePath, viewport, rows, throttle, networkDelay, imageDelay,
      load: { ...load, firstRowMs }, append, fill: filled, fling, detail, status,
      leak: { beforeFling, afterFling, afterCycles, flingNodesDelta: afterFling.nodes - beforeFling.nodes, flingListenersDelta: afterFling.listeners - beforeFling.listeners, cyclesNodesDelta: afterCycles.nodes - afterFling.nodes, cyclesListenersDelta: afterCycles.listeners - afterFling.listeners },
      fetches: { byCursor: fillFetches, includingStatusUpdate: fetches, expected: expectedFetches, duplicates, ok: Object.keys(fillFetches).length === expectedFetches && duplicates.length === 0 },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
const results = [];
for (let i = 1; i <= repeat; i += 1) results.push(await runOnce(i, false));
const out = options.get("out");
if (out) { await mkdir(dirname(resolve(out)), { recursive: true }); await writeFile(resolve(out), JSON.stringify(results, null, 2) + "\n"); }
if (options.has("video")) { await mkdir(resolve(options.get("video")!), { recursive: true }); await runOnce(1, true); }
console.log("| Route | View | Rows | CPU | Fling p50/p95/p99 ms | >16.7% | LoAF block ms | Nodes | Rows mounted | Heap MB | Append LoAF ms | Status LoAF ms | Detail open ms | Fetch OK |");
console.log("|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const run of results) console.log(`| ${run.route} | ${run.viewport} | ${run.rows} | ${run.throttle} | ${run.fling.frameMs.p50}/${run.fling.frameMs.p95}/${run.fling.frameMs.p99} | ${run.fling.over16Pct} | ${run.fling.loaf.blockingMs} | ${run.fling.snapshot.nodes} | ${run.fling.snapshot.rows} | ${round(run.fling.snapshot.heapBytes / 1048576)} | ${run.append.loaf.longestMs} | ${run.status.loaf.longestMs} | ${round(run.detail.openMs.reduce((a, b) => a + b, 0) / run.detail.openMs.length)} | ${run.fetches.ok ? "yes" : "no"} |`);
if (results.some((run) => !run.fetches.ok || !run.detail.focusReturned)) process.exitCode = 1;
