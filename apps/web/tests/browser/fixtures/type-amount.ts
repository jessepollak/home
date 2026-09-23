import type { Page } from "@playwright/test";

export async function typeAmount(page: Page, value: string) {
  for (const char of value) {
    await page.getByRole("button", {
      name: char === "." ? "Decimal point" : char,
      exact: true,
    }).click();
  }
}
