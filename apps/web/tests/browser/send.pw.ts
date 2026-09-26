import { expect, test, type Locator } from "@playwright/test";
import { installApiFixtures, RECIPIENT, seedSignedInSession } from "./fixtures/api";
import { typeAmount } from "./fixtures/type-amount";

function zeroDurationTransitions(locator: Locator) {
  return locator.evaluate((element) =>
    getComputedStyle(element).transitionDuration
      .split(",")
      .every((duration) => Number.parseFloat(duration) === 0));
}

test("submitted send shows a pending result and clears its review route before reload", async ({ page }) => {
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
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog.getByRole("button", { name: "Send $1.00" }).click();
  await expect(dialog.getByRole("heading", { name: "$1.00 on its way" })).toBeVisible();
  await expect(dialog.getByText("Submitted")).toBeVisible();
  await expect(dialog.getByText("Confirming on Base")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "View in Activity" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /try again|retry/i })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem("home:playwright-smoke:dispatch-count"),
  )).toBe("1");
  await expect(page).not.toHaveURL(/actionId=|action_id=|action=/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Send $1.00" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Confirm" })).toHaveCount(0);
});
