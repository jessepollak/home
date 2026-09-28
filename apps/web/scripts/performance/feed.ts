import { type Page } from "@playwright/test";
import { json } from "../../tests/browser/fixtures/api";
import { sessionBody } from "../../tests/browser/fixtures/bodies";
import { cpuThrottle, flingDistance } from "./config";
import { median } from "./evaluate";
import { twoFrames, type Session } from "./browser";

const section = 'section[aria-label="Activity"]:not(#navigation-panel)';
const rowSelector = `${section} ul > li`;
const recentRowSelector = `${section} ul > li[aria-posinset]`;
const pageSize = 25;
const wallet = sessionBody.smartAccount.address.toLowerCase();
const recipient = "0x2222222222222222222222222222222222222222";
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export async function installFeed(page: Page, rows: number) {
  const transferCount = rows - Math.floor(rows / 10);
  const actionCount = rows - transferCount;
  const anchor = Date.now() - 120_000;
  const timestamp = (index: number) => new Date(anchor - index * 30_000).toISOString();
  const transfers = Array.from({ length: transferCount }, (_, index) => ({
    id: `8453:${token}:budget-${index}`, logId: `budget-${index}`, chainId: 8453, assetId: "usdc", tokenAddress: token,
    tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null, walletAddress: wallet,
    fromAddress: index % 2 ? wallet : recipient, toAddress: index % 2 ? recipient : wallet,
    direction: index % 2 ? "outgoing" : "incoming", amountBaseUnits: String((index + 1) * 1_000_000),
    blockNumber: String(1_000_000 - index), blockHash: `0x${"ef".repeat(32)}`,
    transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`, logIndex: "0", blockTimestamp: timestamp(index + 1),
    valuation: { status: "priced", currency: "USD", amount: { atoms: (BigInt(index + 1) * BigInt(10) ** BigInt(18)).toString(), scale: 18 },
      method: "peg", peg: "USD", close: null, fx: null },
  }));
  const actions = Array.from({ length: actionCount }, (_, index) => {
    const date = timestamp(Math.floor(index * transferCount / Math.max(actionCount, 1)) + 1);
    return {
      id: `11111111-1111-4111-8111-${(index + 1).toString(16).padStart(12, "0")}`, provider: "cdp-embedded", kind: "send",
      summary: { title: "Send USDC", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: [], expiresAt: timestamp(0) },
      status: "confirmed", createdAt: date, confirmedAt: date,
      owner: { subject: sessionBody.user.subject, address: wallet, chainId: 8453, accountProvider: sessionBody.accountProvider },
    };
  });
  const served = new Set<string>();
  let actionsFetched = false;
  const cursors = new Map<string, number>();
  await page.route("**/api/actions*", (route) => {
    if (new URL(route.request().url()).pathname !== "/api/actions") return route.fallback();
    actionsFetched = true;
    return json(route, { actions });
  });
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const cursor = url.searchParams.get("cursor") ?? "initial";
    cursors.set(cursor, (cursors.get(cursor) ?? 0) + 1);
    const offset = cursor === "initial" ? 0 : Number(cursor.replace("page-", "")) * pageSize;
    if (!Number.isInteger(offset) || offset < 0 || offset >= transferCount) throw new Error(`Invalid feed cursor ${cursor}`);
    const to = url.searchParams.get("to")!;
    const slice = transfers.slice(offset, offset + pageSize);
    for (const transfer of slice) served.add(transfer.id);
    return json(route, {
      version: 1, walletAddress: wallet, chainId: 8453, currency: url.searchParams.get("currency") ?? "USD",
      window: { from: new Date(Date.parse(to) - 31 * 86400_000).toISOString(), to }, transfers: slice,
      nextCursor: offset + pageSize < transferCount ? `page-${Math.floor(offset / pageSize) + 1}` : null,
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    });
  });
  return {
    filled: () => served.size + (actionsFetched ? actionCount : 0) === rows,
    verify: () => {
      if (cursors.size !== Math.ceil(transferCount / pageSize) || [...cursors.values()].some((count) => count !== 1))
        throw new Error(`Feed pagination mismatch for ${rows} rows: ${JSON.stringify([...cursors])}`);
    },
  };
}

export async function fillFeed(session: Session, rows: number, filled: () => boolean, feedSection = section) {
  const { page, cdp } = session;
  const main = page.locator("main[data-app-main-authenticated]");
  const end = page.locator(`${feedSection} [role="status"]`).filter({ hasText: "End of activity" });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  try {
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      if (filled() && await end.isVisible()) return;
      await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(65);
    }
    throw new Error(`Feed fill timed out at ${rows} rows`);
  } finally { await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle }); }
}

export type Fling = { p95: number; over33: number; droppedPct: number; blockingMs: number; maxRows: number; settledRows: number; historyWrites: number; frames: number };
export async function fling(session: Session): Promise<Fling> {
  const { page, cdp } = session;
  const main = page.locator("main[data-app-main-authenticated]");
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await main.evaluate((element) => { element.scrollTop = 0; });
  await twoFrames(page);
  await page.evaluate((selector) => {
    const w = window as typeof window & { __perfFling?: { frames: number[]; blocking: number[]; maxRows: number; stop: () => void } };
    const frames: number[] = [], blocking: number[] = [];
    let previous = 0, running = true, maxRows = 0;
    const tick = (now: number) => {
      if (!running) return;
      if (previous) frames.push(now - previous);
      previous = now;
      maxRows = Math.max(maxRows, document.querySelectorAll(selector).length);
      requestAnimationFrame(tick);
    };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) blocking.push((entry as PerformanceEntry & { blockingDuration?: number }).blockingDuration ?? 0);
    });
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) observer.observe({ type: "long-animation-frame", buffered: false });
    requestAnimationFrame(tick);
    w.__perfFling = { frames, blocking, get maxRows() { return maxRows; }, stop: () => { running = false; observer.disconnect(); } };
  }, recentRowSelector);
  const before = await page.evaluate(() => (window as typeof window & { __perfHistory: number }).__perfHistory);
  const bounds = await main.boundingBox();
  if (!bounds) throw new Error("Missing feed scroll host");
  const position = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, gestureSourceType: "mouse" as const, speed: 4000 };
  const height = await main.evaluate((element) => element.scrollHeight);
  const viewport = await main.evaluate((element) => element.clientHeight);
  const distance = Math.min(height, flingDistance);
  const minimumScroll = Math.min(Math.max(64, (height - viewport) / 2), 500);
  const scrollable = height - viewport > 64;
  const browser = page.context().browser()!;
  await browser.startTracing(page, { categories: ["benchmark", "disabled-by-default-devtools.timeline.frame"] });
  await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: -distance });
  if (scrollable) try {
    await page.waitForFunction(({ host, minimum }) => {
      const element = document.querySelector<HTMLElement>(host);
      return element !== null && element.scrollTop >= minimum;
    }, { host: "main[data-app-main-authenticated]", minimum: minimumScroll }, { timeout: 30_000, polling: 100 });
  } catch (error) {
    throw new Error("Fling gesture did not scroll the feed", { cause: error });
  }
  await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: distance });
  if (scrollable) try {
    await page.waitForFunction((host) => {
      const element = document.querySelector<HTMLElement>(host);
      return element !== null && element.scrollTop <= 64;
    }, "main[data-app-main-authenticated]", { timeout: 30_000, polling: 100 });
  } catch (error) {
    throw new Error("Fling did not return to the top of the feed", { cause: error });
  }
  await page.evaluate((selector) => new Promise<void>((done) => {
    let last = -1, stable = 0, frames = 0;
    const tick = () => {
      const count = document.querySelectorAll(selector).length;
      stable = count === last ? stable + 1 : 0;
      last = count;
      if (stable >= 3 || ++frames > 120) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), recentRowSelector);
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: { name: string }[] };
  const dropped = trace.traceEvents.filter((event) => event.name === "DroppedFrame").length;
  const displayed = trace.traceEvents.filter((event) => event.name === "Display::FrameDisplayed").length;
  const droppedPct = dropped / Math.max(dropped + displayed, 1) * 100;
  return page.evaluate(({ before, selector, droppedPct }) => {
    const w = window as typeof window & { __perfHistory: number; __perfFling: { frames: number[]; blocking: number[]; maxRows: number; stop: () => void } };
    const data = w.__perfFling;
    data.stop();
    const sorted = data.frames.slice(1).sort((a, b) => a - b);
    return {
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
      over33: sorted.filter((value) => value > 33.4).length / Math.max(sorted.length, 1) * 100, droppedPct,
      blockingMs: data.blocking.reduce((sum, value) => sum + value, 0), maxRows: data.maxRows,
      settledRows: document.querySelectorAll(selector).length,
      historyWrites: w.__perfHistory - before, frames: sorted.length,
    };
  }, { before, selector: recentRowSelector, droppedPct });
}

export async function detailCycles(page: Page, count: number): Promise<number[]> {
  const main = page.locator("main[data-app-main-authenticated]");
  await main.evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });
  await twoFrames(page);
  const mounted = page.locator(`${section} ul > li[aria-posinset]:not([data-perf-clone])`);
  const first = mounted.nth(Math.floor(await mounted.count() / 2));
  await first.waitFor({ timeout: 15_000 });
  const position = await first.getAttribute("aria-posinset");
  const datetime = await first.locator("time[datetime]").first().getAttribute("datetime");
  if (!position || !datetime) throw new Error("Activity detail row has no identity");
  const button = page.locator(`${section} ul > li[aria-posinset="${position}"]:not([data-perf-clone]) button`).first();
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await button.click();
    try { await page.getByRole("dialog").waitFor({ timeout: 15_000 }); }
    catch (error) { throw new Error(`Detail cycle ${i + 1} row ${position}: ${await button.textContent()} (${page.url()})`, { cause: error }); }
    times.push(performance.now() - start);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15_000 });
    await page.waitForFunction(({ position, datetime }) => {
      const row = document.activeElement?.closest('section[aria-label="Activity"]:not(#navigation-panel) ul > li');
      return row?.getAttribute("aria-posinset") === position && row.querySelector("time[datetime]")?.getAttribute("datetime") === datetime;
    }, { position, datetime }, { timeout: 10_000 });
  }
  return times;
}

export async function runFeed(session: Session, baseUrl: string, rows: number, repetitions: number, includeDetail = true) {
  const fixture = await installFeed(session.page, rows);
  await session.page.goto(`${baseUrl}/activity`, { waitUntil: "domcontentloaded" });
  await session.page.locator(rowSelector).first().waitFor({ timeout: 30_000 });
  await fillFeed(session, rows, fixture.filled);
  fixture.verify();
  const flings: Fling[] = [];
  const opens: number[] = [];
  for (let i = 0; i < repetitions; i++) {
    flings.push(await fling(session));
    if (includeDetail) opens.push(...await detailCycles(session.page, 3));
  }
  if (flings.some((entry) => entry.frames < 3)) throw new Error(`Too few fling frames (${rows} rows)`);
  return {
    flings, opens,
    timing: { p95: median(flings.map((run) => run.p95)), over33: median(flings.map((run) => run.over33)), droppedPct: median(flings.map((run) => run.droppedPct)),
      blockingMs: median(flings.map((run) => run.blockingMs)), detailOpen: median(opens) },
    maxRows: Math.max(...flings.map((entry) => entry.maxRows)),
    settledRows: Math.max(...flings.map((entry) => entry.settledRows)),
    historyWrites: Math.max(...flings.map((entry) => entry.historyWrites)),
  };
}
