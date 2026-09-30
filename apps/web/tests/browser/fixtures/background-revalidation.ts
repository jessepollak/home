import { expect, type Page } from "@playwright/test";

// One synthetic focus event can land while the first read is still settling, while the page is
// momentarily hidden, or before the focus manager observes it, so a loaded runner can miss it
// entirely. Re-dispatch until the read the tab-visibility path owes arrives.
export function requestBackgroundRevalidation(
  page: Page,
  reads: () => number,
  minimum: number,
  timeoutMs = 15_000,
): Promise<void> {
  return expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    return reads();
  }, { timeout: timeoutMs, message: `a background revalidation read above ${minimum}` }).toBeGreaterThan(minimum);
}
