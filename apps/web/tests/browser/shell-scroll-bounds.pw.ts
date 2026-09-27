import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

const floatingNavigationOffset = 12;

async function waitForHomeMark(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("action:first-interactive", "mark").length), {
    timeout: process.env.CI ? 10_000 : 5_000,
  }).toBeGreaterThan(0);
}

async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]");
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]');
    if (!main || !nav || !main.parentElement) throw new Error("Signed-in shell is missing");
    return {
      innerHeight: window.innerHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      shellTop: main.parentElement.getBoundingClientRect().top,
      navTop: nav.getBoundingClientRect().top,
      navBottom: nav.getBoundingClientRect().bottom,
      contentBottom: main.lastElementChild?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      mainScrollTop: main.scrollTop,
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
    };
  });
}

async function expectDocumentBounded(page: Page) {
  await expect.poll(async () => {
    const { innerHeight, documentScrollHeight, scrollY, navBottom } = await shellGeometry(page);
    return documentScrollHeight <= innerHeight && scrollY === 0 &&
      Math.abs(innerHeight - navBottom - floatingNavigationOffset) <= 1;
  }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await waitForHomeMark(page);
  await expect(page.locator("#home-nav")).toHaveAttribute("aria-current", "page");
});

test("a residual document scroll offset cannot lift the mobile navigation", async ({ page }) => {
  const resting = await shellGeometry(page);
  expect(resting.documentScrollHeight).toBeLessThanOrEqual(resting.innerHeight);
  expect(Math.abs(resting.innerHeight - resting.navBottom - floatingNavigationOffset)).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "1200px";
    document.body.append(spacer);
    window.scrollTo({ top: 400, behavior: "instant" });
  });
  await expect.poll(async () => (await shellGeometry(page)).scrollY).toBeGreaterThan(0);
  const shifted = await shellGeometry(page);
  expect(Math.abs(shifted.shellTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(shifted.innerHeight - shifted.navBottom - floatingNavigationOffset)).toBeLessThanOrEqual(1);
});

test("the document stays unscrollable across sheets and tab changes", async ({ page }) => {
  await page.getByRole("button", { name: "Send" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Send" });
  await expect(dialog).toBeVisible();
  const amount = page.getByRole("textbox", { name: "Amount" });
  await amount.focus();
  await expect(amount).toBeFocused();
  await amount.press("Escape");
  await expect(dialog).toBeHidden();
  await expectDocumentBounded(page);

  await page.locator("#invest-nav").click();
  await expect(page.locator("#invest-nav")).toHaveAttribute("aria-current", "page");
  await expectDocumentBounded(page);

  await page.locator("#home-nav").click();
  await expect(page.locator("#home-nav")).toHaveAttribute("aria-current", "page");
  await expectDocumentBounded(page);

  await page.locator("[data-app-main-authenticated]").evaluate((main) => {
    main.scrollTop = main.scrollHeight;
  });
  await expect.poll(async () => {
    const geometry = await shellGeometry(page);
    return geometry.mainScrollTop + geometry.mainClientHeight >= geometry.mainScrollHeight - 1 &&
      geometry.contentBottom <= geometry.navTop + 1;
  }).toBe(true);
});
