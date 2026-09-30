import { expect, test, type Page } from "@playwright/test";

// One synthetic focus event can land while the first read is still settling, while the page is
// momentarily hidden, or before the focus manager observes it, so a loaded runner can miss it
// entirely. Re-dispatch until the read the tab-visibility path owes arrives. Each call adds its
// budget to the test timeout so sequential calls cannot outlast the test that makes them.
export function requestBackgroundRevalidation(
  page: Page,
  reads: () => number,
  minimum: number,
  timeoutMs = 15_000,
): Promise<void> {
  const info = test.info();
  if (info.timeout > 0) info.setTimeout(info.timeout + timeoutMs);
  return expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    return reads();
  }, { timeout: timeoutMs, message: `a background revalidation read above ${minimum}` }).toBeGreaterThan(minimum);
}
