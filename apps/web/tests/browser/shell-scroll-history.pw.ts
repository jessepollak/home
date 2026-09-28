import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";

const mainSelector = "main[data-app-main-authenticated]";

async function setupLongActivity(page: Page) {
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
  const now = Date.now() - 60_000;
  const actions = Array.from({ length: 260 }, (_, index) => {
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
  await page.route("**/api/actions*", (route) =>
    new URL(route.request().url()).pathname === "/api/actions" ? json(route, { actions }) : route.fallback());
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.locator("#home-nav")).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.locator(mainSelector).evaluate((main) => main.scrollHeight - main.clientHeight)).toBeGreaterThan(4_000);
}

async function historySnapshot(page: Page) {
  return page.evaluate((selector) => {
    const main = document.querySelector<HTMLElement>(selector)!;
    const counts = (window as typeof window & { __shellHistoryWrites: { replace: number; push: number } }).__shellHistoryWrites;
    return { top: main.scrollTop, stateTop: history.state?.__homeShellScrollTop as number | undefined, writes: counts.replace + counts.push };
  }, mainSelector);
}

async function scrollToMiddle(page: Page) {
  const main = page.locator(mainSelector);
  await main.evaluate((element) => { element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) / 2); });
  await expect.poll(async () => {
    const { top, stateTop } = await historySnapshot(page);
    return Math.abs(top - (stateTop ?? -100));
  }).toBeLessThanOrEqual(1);
  const target = (await historySnapshot(page)).top;
  expect(target).toBeGreaterThan(500);
  return target;
}

async function expectRestored(page: Page, target: number) {
  await expect(page).toHaveURL(/\/activity$/);
  await expect.poll(async () => Math.abs((await historySnapshot(page)).top - target)).toBeLessThanOrEqual(64);
}

test("a long Activity fling does not write history on each frame", async ({ page, context }) => {
  await setupLongActivity(page);
  const main = page.locator(mainSelector);
  const cdp = await context.newCDPSession(page);
  const bounds = await main.boundingBox();
  expect(bounds).not.toBeNull();
  const position = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2, gestureSourceType: "mouse" as const, speed: 4000 };
  const distance = await main.evaluate((element) => element.scrollHeight);
  const before = (await historySnapshot(page)).writes;
  await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: -distance });
  await expect.poll(async () => (await historySnapshot(page)).top).toBeGreaterThan(500);
  await cdp.send("Input.synthesizeScrollGesture", { ...position, yDistance: distance });
  await expect.poll(async () => Math.abs((await historySnapshot(page)).top)).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    const { top, stateTop } = await historySnapshot(page);
    return Math.abs(top - (stateTop ?? -100));
  }).toBeLessThanOrEqual(1);
  expect((await historySnapshot(page)).writes - before).toBeLessThanOrEqual(5);
});

test("back and forward restore Activity scroll twice", async ({ page }) => {
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

test("immediate in-app Back preserves an unsettled Savings scroll for Forward", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await expect(page).toHaveURL(/\/cash$/);
  await page.getByRole("region", { name: "Savings" }).getByRole("button", { name: /^US dollar/ }).click();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  const main = page.locator(mainSelector);
  await expect.poll(() => main.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(64);
  await main.evaluate((node) => { node.scrollTop = 0; });
  await expect.poll(() => page.evaluate(() => history.state?.__homeShellScrollTop)).toBe(0);
  const target = await main.evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight;
    node.dispatchEvent(new Event("scroll"));
    const top = node.scrollTop;
    const back = document.querySelector<HTMLButtonElement>("[data-shell-back] button");
    if (!back) throw new Error("Savings Back control is missing");
    back.click();
    return top;
  });
  expect(target).toBeGreaterThan(64);
  await expect(page).toHaveURL(/\/cash$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await expect.poll(() => main.evaluate((node, expected) => Math.abs(node.scrollTop - expected), target)).toBeLessThanOrEqual(64);
});

test("a reloaded Activity document persists and restores scroll on navigation", async ({ page }) => {
  await setupLongActivity(page);
  await page.reload();
  await expect(page).toHaveURL(/\/activity$/);
  await expect.poll(() => page.locator(mainSelector).evaluate((main) => main.scrollHeight - main.clientHeight)).toBeGreaterThan(4_000);
  const target = await scrollToMiddle(page);
  await page.locator("#home-nav").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await expectRestored(page, target);
});
