import { expect, type Page } from "@playwright/test";

// A cold Next dev route compiles in-process on first visit, and a loaded shared machine
// stretches that compile past Playwright's 5s default expectation timeout. Route-arrival
// assertions wait with this budget instead, so a slow-but-real navigation still passes
// while a navigation that never arrives still fails; no case is skipped or retried.
export const NAVIGATION_BUDGET_MS = 15_000;

export function expectNavigation(page: Page, url: string | RegExp): Promise<void> {
  return expect(page).toHaveURL(url, { timeout: NAVIGATION_BUDGET_MS });
}
