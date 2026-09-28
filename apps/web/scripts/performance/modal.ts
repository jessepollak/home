import { type Locator } from "@playwright/test";
import { modalCycles } from "./config";
import { installFeed, fillFeed } from "./feed";
import { ready } from "./navigation";
import { leakCycle, resourceSnapshot, twoFrames, type Session } from "./browser";
import { median } from "./evaluate";

export async function runModal(session: Session, baseUrl: string, rows: number, kind: "detail" | "send", seedLeak: boolean) {
  const { page } = session;
  const fixture = await installFeed(page, rows);
  await page.goto(`${baseUrl}/${kind === "detail" ? "activity" : "home"}`, { waitUntil: "domcontentloaded" });
  await ready(page, kind === "detail" ? "/activity" : "/home");
  let button: Locator;
  if (kind === "detail") {
    await fillFeed(session, rows, fixture.filled);
    fixture.verify();
    await page.locator("main[data-app-main-authenticated]").evaluate((element) => { element.scrollTop = 0; });
    await twoFrames(page);
    button = page.locator('section[aria-label="Activity"]:not(#navigation-panel) ul > li[aria-posinset]:not([data-perf-clone]) button').first();
  } else {
    if (rows > 20) {
      await fillFeed(session, rows, fixture.filled, "section[data-activity-feed]");
      fixture.verify();
      await page.locator("main[data-app-main-authenticated]").evaluate((main) => { main.scrollTop = 0; });
      await twoFrames(page);
    }
    button = page.getByRole("button", { name: "Send", exact: true }).first();
  }
  await button.waitFor({ timeout: 15_000 });
  const identity = kind === "detail" ? {
    position: await button.locator("xpath=ancestor::li[1]").getAttribute("aria-posinset"),
    datetime: await button.locator("xpath=ancestor::li[1]").locator("time[datetime]").first().getAttribute("datetime"),
  } : null;
  if (identity && (!identity.position || !identity.datetime)) throw new Error("Activity detail row has no identity");
  if (identity) button = page.locator(`section[aria-label="Activity"]:not(#navigation-panel) ul > li[aria-posinset="${identity.position}"]:not([data-perf-clone]) button`).first();
  const cycle = async () => {
    const start = performance.now();
    await button.click();
    await page.getByRole("dialog").waitFor({ timeout: 15_000 });
    const openMs = performance.now() - start;
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15_000 });
    if (identity) {
      try {
        await page.waitForFunction(({ position, datetime }) => {
          const row = document.activeElement?.closest('section[aria-label="Activity"]:not(#navigation-panel) ul > li');
          return row?.getAttribute("aria-posinset") === position && row.querySelector("time[datetime]")?.getAttribute("datetime") === datetime;
        }, identity, { timeout: 10_000 });
      } catch (error) {
        const actual = await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 280),
          row: document.activeElement?.closest("li")?.getAttribute("aria-posinset"),
          datetime: document.activeElement?.closest("li")?.querySelector("time[datetime]")?.getAttribute("datetime") }));
        throw new Error(`Activity focus did not return to ${JSON.stringify(identity)}: ${JSON.stringify(actual)}`, { cause: error });
      }
    }
    else await page.waitForFunction(() => document.activeElement instanceof HTMLButtonElement &&
      document.activeElement.isConnected && Boolean(document.activeElement.closest('[data-shell-panel]:not([hidden])')),
      null, { timeout: 5_000 });
    await leakCycle(page, seedLeak);
    return openMs;
  };
  await cycle();
  const times: number[] = [];
  let second: Awaited<ReturnType<typeof resourceSnapshot>> | null = null;
  let tenth: Awaited<ReturnType<typeof resourceSnapshot>> | null = null;
  for (let i = 1; i <= modalCycles; i++) {
    times.push(await cycle());
    if (i === 2) second = await resourceSnapshot(session);
    if (i === 10) tenth = await resourceSnapshot(session);
  }
  return { openMs: median(times), samples: times.length,
    growth: second && tenth ? { nodes: tenth.nodes - second.nodes, listeners: tenth.listeners - second.listeners,
      heapBytes: tenth.heapBytes - second.heapBytes, second, tenth } : null };
}
