import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

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
  await expect(page).toHaveURL(/\/home$/);

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
