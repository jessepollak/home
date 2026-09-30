import { expect, test } from "@playwright/test";
import { requestBackgroundRevalidation } from "./fixtures/background-revalidation";

test("sequential background revalidations each extend the test timeout by their budget", async ({ page }) => {
  let reads = 0;
  await page.exposeFunction("recordRead", () => { reads++; });
  await page.setContent("<p>idle</p>");
  await page.evaluate(() => window.addEventListener("visibilitychange", () => (window as unknown as { recordRead: () => void }).recordRead()));
  const initial = test.info().timeout;
  await requestBackgroundRevalidation(page, () => reads, 0, 5_000);
  await requestBackgroundRevalidation(page, () => reads, reads, 7_000);
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(test.info().timeout).toBe(initial + 12_000);
});
