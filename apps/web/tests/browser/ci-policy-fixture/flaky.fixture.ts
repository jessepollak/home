import { expect, test } from "@playwright/test";

test("retry-only pass", ({}, testInfo) => {
  expect(testInfo.retry).toBeGreaterThan(0);
});
