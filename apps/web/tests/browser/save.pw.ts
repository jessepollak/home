import { expect, test } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

test("reduced motion stops the Save skeleton pulse", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  const balancesObserved = fixtures.delayNextBalances();
  await page.goto("/save");
  const skeleton = page.locator("[data-slot=skeleton][data-shimmer=savings-hero]");
  await expect(skeleton).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => skeleton.evaluate((element) =>
    getComputedStyle(element).animationName)).toBe("none");
  await balancesObserved;
  fixtures.releaseBalances();
});

test("Save flow dismissal preserves canonical routing and exact opener focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);

  await page.goto("/save?flow=save-deposit");
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "Close deposit dialog" }).click();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeHidden();
  await expect(page).toHaveURL(/\/save$/);

  const deposit = page.getByRole("button", { name: "Deposit", exact: true });
  await deposit.click();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "Close deposit dialog" }).click();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeHidden();
  await expect(page).toHaveURL(/\/save$/);
  await expect(deposit).toBeFocused();

  const withdraw = page.getByRole("button", { name: "Withdraw", exact: true });
  await withdraw.click();
  await expect(page.getByRole("dialog", { name: "Withdraw" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Withdraw" })).toBeHidden();
  await expect(page).toHaveURL(/\/save$/);
  await expect(withdraw).toBeFocused();

  await deposit.click();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeHidden();
  await expect(page).toHaveURL(/\/save$/);
  await expect(deposit).toBeFocused();
});
