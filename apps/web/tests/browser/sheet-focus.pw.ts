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
    const main = page.locator("[data-app-main-authenticated]");
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
    await main.focus();
    await page.goForward();
    await expect(page.getByRole("dialog", { name: "Send", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(send).not.toBeFocused();
    await expect(unrelated).not.toBeFocused();
    await main.focus();
    await send.evaluate((element: HTMLButtonElement) => element.click());
    await expect(page.getByRole("dialog", { name: "Send", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(send).toBeFocused();
  });
}
