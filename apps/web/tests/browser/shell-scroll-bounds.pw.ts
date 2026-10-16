import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";
import { expectNavigation } from "./fixtures/navigation-budget";

const floatingNavigationOffset = 12;

async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>("header");
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
    if (!header || !nav) throw new Error("shell header or navigation is missing");
    return {
      scrollY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      headerTop: header.getBoundingClientRect().top,
      navGap: window.innerHeight - nav.getBoundingClientRect().bottom,
      contentBottom: document.querySelector<HTMLElement>("[data-app-main-authenticated]")?.lastElementChild?.getBoundingClientRect().bottom ?? Infinity,
      navTop: nav.getBoundingClientRect().top,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(page.locator("#home-nav")).toHaveAttribute("aria-current", "page");
});

test("document scroll keeps header and bottom navigation anchored", async ({ page }) => {
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await shellGeometry(page)).scrollY).toBeGreaterThan(0);
  const geometry = await shellGeometry(page);
  expect(geometry.headerTop).toBe(0);
  expect(Math.abs(geometry.navGap - floatingNavigationOffset)).toBeLessThanOrEqual(1);
  expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.navTop);
});

test("account flows and tab changes keep the document as the scroll owner", async ({ page }) => {
  await page.getByRole("button", { name: "Send" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Send" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Close send dialog" }).click();
  await expect(dialog).toHaveCount(0);
  await expectNavigation(page, /\/home$/);

  await page.locator("#invest-nav").click();
  await expect(page.locator("#invest-nav")).toHaveAttribute("aria-current", "page");
  await page.locator("#home-nav").click();
  await expect(page.locator("#home-nav")).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const geometry = await shellGeometry(page);
  expect(geometry.documentHeight).toBeGreaterThan(geometry.viewportHeight);
  expect(geometry.scrollY).toBeGreaterThan(0);
  expect(Math.abs(geometry.navGap - floatingNavigationOffset)).toBeLessThanOrEqual(1);
});

for (const width of [320, 390, 1440]) {
  test(`Home stays readable and reachable at 200% text on a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });

    const title = page.locator("[data-shell-header-title]");
    await expect(title).toHaveText("Home");
    const titleFit = await title.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(titleFit.scrollWidth).toBeLessThanOrEqual(titleFit.clientWidth);

    const figure = page.locator('[data-slot="money-ticker"]').first();
    const balance = figure.locator('xpath=ancestor::*[@data-slot="card"][1]');
    await expect(figure).toBeVisible();
    const [cardBox, figureBox] = await Promise.all([balance.boundingBox(), figure.boundingBox()]);
    if (!cardBox || !figureBox) throw new Error("balance card or figure is not rendered");
    expect(figureBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(figureBox.x + figureBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (width >= 1024) return;
    const addMoney = page.getByRole("group", { name: "Money actions" }).locator("a, button").filter({ hasText: "Add money" });
    await addMoney.focus();
    const { bottom, navTop } = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
      const button = document.activeElement;
      if (!nav || !button) throw new Error("navigation or focused action is missing");
      return { bottom: button.getBoundingClientRect().bottom, navTop: nav.getBoundingClientRect().top };
    });
    expect(bottom).toBeLessThanOrEqual(navTop);
  });
}
