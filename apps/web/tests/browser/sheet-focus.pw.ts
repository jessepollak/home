import { expect, test } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`sheet activation and history focus at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("action:first-interactive", "mark").length), {
      timeout: process.env.CI ? 10_000 : 5_000,
    }).toBeGreaterThan(0);
    const stage = page.locator("#navigation-panel");
    const send = page.getByRole("button", { name: "Send", exact: true });
    for (const name of ["Add money", "Send"]) {
      const opener = page.getByRole("button", { name, exact: true });
      await opener.click();
      await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
    await send.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Send", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const unrelated = page.getByRole("button", { name: "Refresh Home", exact: true });
    await unrelated.focus();
    await expect(unrelated).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await stage.focus();
    await page.goForward();
    await expect(page.getByRole("dialog", { name: "Send", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(send).not.toBeFocused();
    await expect(unrelated).not.toBeFocused();
    await stage.focus();
    await send.evaluate((element: HTMLButtonElement) => element.click());
    await expect(page.getByRole("dialog", { name: "Send", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(send).toBeFocused();
  });

  test(`routed Cash sheet sessions restore only their own opener at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
    const homeOpener = page.getByRole("button", { name: "Add money", exact: true });
    await homeOpener.click();
    await expect(page.getByRole("dialog", { name: "Add money", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(homeOpener).toBeFocused();
    await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash / }).click();
    await expect(page).toHaveURL("/cash");
    const opener = page.getByRole("button", { name: "Add money", exact: true });
    const stage = page.locator("#navigation-panel");
    await stage.focus();
    await opener.evaluate((element: HTMLButtonElement) => element.click());
    await expect(page.getByRole("dialog", { name: "Add money", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Add money", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await stage.focus();
    await page.goForward();
    await expect(page.getByRole("dialog", { name: "Add money", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).not.toBeFocused();
    await stage.focus();
    await page.goto("/cash?flow=send");
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
    await expect(page.getByRole("dialog", { name: "Send", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).not.toBeFocused();
    expect(await page.evaluate(() => document.scrollingElement === document.documentElement)).toBe(true);
  });
}
