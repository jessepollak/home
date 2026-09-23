import { expect, test, type Locator } from "@playwright/test";
import { installApiFixtures, RECIPIENT, seedSignedInSession } from "./fixtures/api";
import { typeAmount } from "./fixtures/type-amount";

function zeroDurationTransitions(locator: Locator) {
  return locator.evaluate((element) =>
    getComputedStyle(element).transitionDuration
      .split(",")
      .every((duration) => Number.parseFloat(duration) === 0));
}

test("ambiguous handle response retries without a second wallet dispatch and honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("button", { name: "Send" }).click();
  expect(await zeroDurationTransitions(page.locator("[data-slot=drawer-popup]"))).toBe(true);
  await typeAmount(page, "1");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send $1.00" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm" });
  await expect(confirm.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem("home:playwright-smoke:dispatch-count"),
  )).toBe("1");
  await confirm.getByRole("button", { name: "Try again" }).click();
  await confirm.getByRole("button", { name: "Send $1.00" }).click();
  await expect(confirm).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem("home:playwright-smoke:dispatch-count"),
  )).toBe("1");
  const toast = page.locator('[data-slot="toast"]');
  await expect(toast.getByText("Sent $1.00 to 0x2222…222222", { exact: true })).toBeVisible();
  expect(await zeroDurationTransitions(toast)).toBe(true);
});
