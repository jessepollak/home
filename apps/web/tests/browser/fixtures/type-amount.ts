import type { Page } from "@playwright/test";

export async function typeAmount(page: Page, value: string) {
  await page.getByRole("textbox", { name: "Amount" }).pressSequentially(value);
}
