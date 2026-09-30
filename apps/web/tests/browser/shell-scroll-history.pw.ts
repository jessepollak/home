import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";

function longActivityActions(count = 260) {
  const now = FIXED_NOW - 60_000;
  return Array.from({ length: count }, (_, index) => {
    const createdAt = new Date(now - index * 60_000).toISOString();
    return {
      id: `11111111-1111-4111-8111-${(index + 1).toString(16).padStart(12, "0")}`,
      provider: "cdp-embedded",
      kind: "send",
      summary: { title: "Send USDC", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: [], expiresAt: createdAt },
      status: "confirmed",
      createdAt,
      confirmedAt: createdAt,
      owner: { subject: sessionBody.user.subject, address: sessionBody.smartAccount.address, chainId: 8453, accountProvider: sessionBody.accountProvider },
    };
  });
}

async function setupLongActivity(page: Page, actions: ReturnType<typeof longActivityActions> = longActivityActions()) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const counts = { replace: 0, push: 0 };
    Object.defineProperty(window, "__shellHistoryWrites", { value: counts });
    for (const kind of ["replaceState", "pushState"] as const) {
      const original = History.prototype[kind];
      History.prototype[kind] = function (state, unused, url) {
        counts[kind === "replaceState" ? "replace" : "push"]++;
        return original.call(this, state, unused, url);
      };
    }
  });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/actions*", (route) =>
    new URL(route.request().url()).pathname === "/api/actions" ? json(route, { actions }) : route.fallback());
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.locator("#home-nav")).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(4_000);
}

async function scrollToMiddle(page: Page) {
  await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) / 2)));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  return page.evaluate(() => window.scrollY);
}

async function expectRestored(page: Page, target: number) {
  await expect(page).toHaveURL(/\/activity$/);
  await expect.poll(() => page.evaluate((expected) => Math.abs(window.scrollY - expected), target)).toBeLessThanOrEqual(64);
}

async function firstVisibleRowKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>("main[data-app-main-authenticated] ul[id] > li[data-row-key]")];
    return rows
      .map((row) => ({ key: row.dataset.rowKey ?? "", top: row.getBoundingClientRect().top }))
      .filter((row) => row.key !== "" && row.top > -64 && row.top < innerHeight)
      .sort((a, b) => a.top - b.top)[0]?.key ?? null;
  });
}

function historyReplaceCount(page: Page) {
  return page.evaluate(() => {
    const writes: unknown = Reflect.get(window, "__shellHistoryWrites");
    return typeof writes === "object" && writes !== null ? Number(Reflect.get(writes, "replace")) : Number.NaN;
  });
}

test("a long Activity fling keeps the feed bounded without a history write per frame", async ({ page, context }) => {
  await setupLongActivity(page);
  const cdp = await context.newCDPSession(page);
  const before = await historyReplaceCount(page);
  const position = { x: 200, y: 400, gestureSourceType: "mouse" as const, speed: 4000 };
  await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: -4000 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: 4000 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  const after = await historyReplaceCount(page);
  expect(after - before).toBeLessThanOrEqual(5);
});

test("Back and Forward restore document scroll after Activity navigation", async ({ page }) => {
  await setupLongActivity(page);
  const target = await scrollToMiddle(page);
  await page.locator("#home-nav").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await expectRestored(page, target);
  await page.goForward();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await expectRestored(page, target);
});

test("reselecting the active Home tab, the Home mark or the Invest root tab scrolls to the top", async ({ page }) => {
  await setupLongActivity(page);
  await page.locator("#home-nav").click();
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(1_000);
  const historyLength = await page.evaluate(() => history.length);
  for (const reselect of [page.locator("#home-nav"), page.locator("[data-home-mark] button:visible").first()]) {
    await page.evaluate(() => window.scrollTo(0, 800));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await reselect.click();
    await expect(page).toHaveURL(/\/home$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.setViewportSize({ width: 390, height: 360 });
  await page.locator("#invest-nav").click();
  await expect(page).toHaveURL(/\/invest$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(200);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await page.locator("#invest-nav").click();
  await expect(page).toHaveURL(/\/invest$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("a reloaded Activity document restores document scroll on Back", async ({ page }) => {
  await setupLongActivity(page);
  await page.reload();
  await expect(page).toHaveURL(/\/activity$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(4_000);
  const target = await scrollToMiddle(page);
  await page.locator("#home-nav").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await expectRestored(page, target);
});

test("Back restores the same Activity row after newer activity is prepended", async ({ page }) => {
  const actions = longActivityActions();
  await setupLongActivity(page, actions);
  await scrollToMiddle(page);
  await expect.poll(() => firstVisibleRowKey(page)).not.toBeNull();
  const key = (await firstVisibleRowKey(page))!;

  await page.locator("#home-nav").click();
  await expect(page).toHaveURL(/\/home$/);

  const newest = actions[0]!;
  actions.unshift(...longActivityActions(40).map((action, index) => ({
    ...action,
    id: `22222222-2222-4222-8222-${(index + 1).toString(16).padStart(12, "0")}`,
    createdAt: new Date(Date.parse(newest.createdAt) + (index + 1) * 60_000).toISOString(),
  })));
  const refreshButton = page.getByLabel("Refresh Home");
  await refreshButton.waitFor({ state: "attached", timeout: 15_000 });
  await refreshButton.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Refresh Home is not an element");
    element.click();
  });
  await expect(page.locator('li[data-row-key="home-action:22222222-2222-4222-8222-000000000001"]')).toBeVisible({ timeout: 15_000 });

  await page.goBack();
  await expect(page).toHaveURL(/\/activity$/);
  await expect.poll(() => firstVisibleRowKey(page)).toBe(key);
});

test("closing a flow overlay on a scrolled page keeps the document offset", async ({ page }) => {
  await setupLongActivity(page);
  await page.locator("#home-nav").click();
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(1_000);
  await scrollToMiddle(page);
  const savedOffset = () => page.evaluate(() => {
    const state: unknown = window.history.state;
    return Number(typeof state === "object" && state !== null ? Reflect.get(state, "__homeShellScrollY") ?? 0 : 0);
  });
  await expect.poll(() => savedOffset()).toBeGreaterThan(500);
  const target = await savedOffset();
  await page.evaluate(() => {
    const calls: Array<[number, number]> = [];
    Reflect.set(window, "__shellScrollToCalls", calls);
    const original = window.scrollTo.bind(window);
    function recordingScrollTo(options?: ScrollToOptions): void;
    function recordingScrollTo(x: number, y: number): void;
    function recordingScrollTo(x?: number | ScrollToOptions, y = 0) {
      if (typeof x === "number") {
        calls.push([x, y]);
        original(x, y);
      } else original(x);
    }
    window.scrollTo = recordingScrollTo;
  });
  const opened = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll<HTMLButtonElement>("[data-action-trigger]")]
      .find((candidate) => candidate.textContent?.trim() === "Send");
    trigger?.click();
    return Boolean(trigger);
  });
  expect(opened).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Send" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close send dialog" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => page.evaluate((expected) => Math.abs(window.scrollY - expected), target)).toBeLessThanOrEqual(64);
  const topJumps = await page.evaluate(() => {
    const recorded: unknown = Reflect.get(window, "__shellScrollToCalls");
    if (!Array.isArray(recorded)) return null;
    const calls: unknown[] = recorded;
    return calls.filter((call) => {
      if (!Array.isArray(call)) return false;
      const pair: unknown[] = call;
      return pair[0] === 0 && pair[1] === 0;
    });
  });
  expect(topJumps).toEqual([]);
});
