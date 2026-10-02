import { expect, test } from "@playwright/test";

test("always fails", () => {
  expect(true).toBe(false);
});
