import { expect, type Page } from "@playwright/test";

// Owns both the route-arrival budget and the observed-state readiness budget. A cold Next
// dev route compiles in-process on first visit, and a loaded shared machine stretches
// compilation and readiness past Playwright's 5s default expectation timeout. These budgets
// allow slow-but-real progress while a condition that never arrives still fails.
export const NAVIGATION_BUDGET_MS = 15_000;
export const READINESS_BUDGET_MS = 15_000;

export function expectNavigation(page: Page, url: string | RegExp): Promise<void> {
  return expect(page).toHaveURL(url, { timeout: NAVIGATION_BUDGET_MS });
}

export function expectReady<T>(poll: () => T, message?: string) {
  return expect.poll(poll, { timeout: READINESS_BUDGET_MS, message });
}
