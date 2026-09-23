import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures } from "./fixtures/api";

async function signIn(page: Page) {
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/home/);
}

async function typeAmount(page: Page, value: string) {
  for (const char of value) {
    await page.getByRole("button", {
      name: char === "." ? "Decimal point" : char,
      exact: true,
    }).click();
  }
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
  await page.getByRole("button", { name: "Confirm deposit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review payment details" })).toBeVisible();
  await page.getByRole("button", { name: "View payment instructions" }).click();
  await expect(page.getByText("123456789012", { exact: true })).toBeVisible();
  await expect(page.getByText("Money received")).toBeVisible({ timeout: 7_000 });
});
