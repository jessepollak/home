import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures } from "./fixtures/api";
import { typeAmount } from "./fixtures/type-amount";

async function signIn(page: Page) {
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/home/);
}

test("IDRX funding reaches payment instructions and receipt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "ID"));
  await installApiFixtures(page);
  await signIn(page);
  await page.getByRole("button", { name: "Add money" }).click();
  const method = page.getByRole("button", { name: /Deposit IDR/ });
  await expect(method).toContainText("IDRX · Bank transfer · Mandiri");
  await method.click();
  await typeAmount(page, "20000");
  await page.getByRole("button", { name: "Review quote", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review quote" })).toBeVisible();
  await expect(page.getByText("Receive", { exact: true }).locator("..")).toContainText("20.000,00\u00a0IDRX");
  await page.getByRole("button", { name: "Confirm deposit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review payment details" })).toBeVisible();
  await expect(page.getByText("Network", { exact: true }).locator("..")).toContainText("Rp\u00a0100,00");
  await page.getByRole("button", { name: "View payment instructions" }).click();
  await expect(page.getByText("123456789012", { exact: true })).toBeVisible();
  await expect(page.getByText("Money received")).toBeVisible({ timeout: 7_000 });
});
