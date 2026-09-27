import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { nonTrendingAddress, searchFixture } from "./feature-map/search-fixtures";

test("Invest search keeps identity, query and scroll when returning from a reloaded detail", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/invest");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);

  const input = page.getByRole("textbox", { name: "Search assets" });
  await expect(input).toBeVisible();
  await expect(input).not.toBeFocused();
  expect(await input.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await input.fill("ORB");
  const rows = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ });
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("0x1111…1111");
  await page.setViewportSize({ width: 390, height: 320 });
  const main = page.locator("[data-app-main-authenticated]");
  expect(await main.evaluate((node) => { node.scrollTop = 80; return node.scrollTop; })).toBeGreaterThan(0);
  await rows.first().click();
  await expect(page).toHaveURL(new RegExp(`/invest/base:${nonTrendingAddress}$`));
  await expect(page.locator("[data-shell-header-title]")).toContainText("Orbit");
  expect(await page.evaluate(() => history.state.investSearchQuery)).toBe("ORB");
  expect(await page.evaluate(() => history.state.investSearchScrollTop)).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator("[data-shell-header-title]").filter({ hasText: "Orbit" }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/invest$/);
  await expect(input).toHaveValue("ORB");
  await expect(rows).toHaveCount(3);
  await expect.poll(() => main.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Stocks" })).toBeVisible();
});

test("Invest search keeps mobile focus on clear and dismisses keyboard on submit or Escape", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/invest");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
  const input = page.getByRole("textbox", { name: "Search assets" });
  await input.fill("BTC");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Bitcoin/ })).toBeVisible();
  const clear = page.getByRole("button", { name: "Clear search" });
  expect(await clear.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await clear.click();
  await expect(input).toBeFocused();
  await input.fill("Apple");
  await input.press("Enter");
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue("Apple");
  await input.focus();
  await input.press("Escape");
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue("Apple");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Invest search edits and Clear survive leaving the panel and returning with Back", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/invest");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const input = page.getByRole("textbox", { name: "Search assets" });

  await input.fill("BTC");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Bitcoin/ })).toBeVisible();
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/invest$/);
  await expect(input).toHaveValue("BTC");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Bitcoin/ })).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(input).toHaveValue("");
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/invest$/);
  await expect(input).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Stocks" })).toBeVisible();
});
