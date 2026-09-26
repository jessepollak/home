import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";
import { trackHydrationErrors } from "./fixtures/hydration-errors";

type Theme = "light" | "dark";

async function expectTheme(page: Page, theme: Theme) {
  await expect.poll(() => page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
  }))).toEqual({
    colorScheme: theme,
    themeColor: theme === "dark" ? "#171717" : "#ffffff",
  });
}

async function expectSignedInHome(page: Page) {
  await expect(page.getByRole("region", { name: "Your money" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
}

async function observeThemeAtBodyInsertion(page: Page) {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      (window as typeof window & { __themeAtBodyInsertion?: unknown }).__themeAtBodyInsertion = {
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      };
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function expectThemeAtBodyInsertion(page: Page, theme: Theme) {
  expect(await page.evaluate(() =>
    (window as typeof window & { __themeAtBodyInsertion?: unknown }).__themeAtBodyInsertion,
  )).toEqual({
    colorScheme: theme,
    themeColor: theme === "dark" ? "#171717" : "#ffffff",
  });
}

test("a new visitor follows OS appearance in both directions without navigation", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const hydrationErrors = trackHydrationErrors(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/home");
  await expectSignedInHome(page);
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
  expect(hydrationErrors).toEqual([]);
});

for (const [preference, osTheme] of [["dark", "light"], ["light", "dark"]] as const) {
  test(`stored ${preference} wins before hydration and ignores OS changes`, async ({ page }) => {
    await seedSignedInSession(page);
    await page.addInitScript((stored) => localStorage.setItem("home.appearance.v1", stored), preference);
    await observeThemeAtBodyInsertion(page);
    await installApiFixtures(page);
    const hydrationErrors = trackHydrationErrors(page);
    await page.emulateMedia({ colorScheme: osTheme });
    await page.goto("/home");
    await expectThemeAtBodyInsertion(page, preference);
    await expectSignedInHome(page);
    await expectTheme(page, preference);
    await page.emulateMedia({ colorScheme: preference });
    await expectTheme(page, preference);
    await page.emulateMedia({ colorScheme: osTheme });
    await expectTheme(page, preference);
    expect(hydrationErrors).toEqual([]);
  });
}

for (const preference of ["system", "not-a-theme"] as const) {
  test(`${preference} follows OS appearance after hydration`, async ({ page }) => {
    await seedSignedInSession(page);
    await page.addInitScript((stored) => localStorage.setItem("home.appearance.v1", stored), preference);
    await installApiFixtures(page);
    const hydrationErrors = trackHydrationErrors(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/home");
    await expectSignedInHome(page);
    await expectTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "dark");
    expect(hydrationErrors).toEqual([]);
  });
}

test("unavailable localStorage still renders signed-in content and follows OS", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("home:playwright-smoke:signed-in", "1");
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (this === window.localStorage) throw new Error("storage unavailable");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage) throw new Error("storage unavailable");
      return setItem.call(this, key, value);
    };
  });
  await installApiFixtures(page);
  const hydrationErrors = trackHydrationErrors(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/home");
  await expectSignedInHome(page);
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
  expect(hydrationErrors).toEqual([]);
});

test("stored appearance survives reload and direct Account settings navigation", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await observeThemeAtBodyInsertion(page);
  const hydrationErrors = trackHydrationErrors(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/home");
  await expectSignedInHome(page);
  await page.evaluate(() => localStorage.setItem("home.appearance.v1", "dark"));
  await page.reload();
  await expectThemeAtBodyInsertion(page, "dark");
  await expectSignedInHome(page);
  await expectTheme(page, "dark");
  await page.goto("/home?account=settings");
  await expectThemeAtBodyInsertion(page, "dark");
  await expect(page.getByRole("region", { name: "Account settings" })).toBeVisible();
  await expectTheme(page, "dark");
  expect(hydrationErrors).toEqual([]);
});

test("Account appearance applies immediately, overrides the OS, persists and returns to System", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const hydrationErrors = trackHydrationErrors(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/home?account=settings");
  const appearance = page.getByRole("radiogroup", { name: "Appearance" });
  await expect(appearance.getByRole("radio", { name: "System" })).toBeChecked();

  await appearance.getByRole("radio", { name: "Dark" }).click();
  await expect(appearance.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expectTheme(page, "dark");
  await expect(page).toHaveURL(/account=settings/);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "dark");

  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: "Dark" })).toBeChecked();
  await expectTheme(page, "dark");

  await page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: "Dark" }).press("ArrowRight");
  await expect(page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: "System" })).toBeChecked();
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  expect(hydrationErrors).toEqual([]);
});

test("Account appearance options stay fully visible at a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home?account=settings");
  const appearance = page.getByRole("radiogroup", { name: "Appearance" });
  for (const name of ["Light", "Dark", "System"]) {
    await expect(appearance.getByRole("radio", { name })).toBeInViewport({ ratio: 1 });
  }
  await expect(appearance).toBeInViewport({ ratio: 1 });
});
