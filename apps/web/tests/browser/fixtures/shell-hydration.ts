import { expect, type Page } from "@playwright/test";

export async function waitForShellHydration(page: Page): Promise<void> {
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
}
