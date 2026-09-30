import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint: lintFixtures } = await createOxlintWorkspace("home-oxlint-no-request-only-playwright-", {
  rules: ["no-request-only-playwright"],
});

let fixtureIndex = 0;
async function lint(code, suffix = ".pw.ts") {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}${suffix}`;
  return (await lintFixtures({ fixture: { code, path: fixture } })).fixture;
}

describe("no-request-only-playwright", () => {
  it("rejects request-only tests, supported modifiers, and option arguments", async () => {
    expect(await lint(`
      test("x", async ({ request }) => {});
      test.only("x", async ({ request }) => {});
      test.skip("x", async ({ request }) => {});
      test.fixme("x", async ({ request }) => {});
      test.fail("x", async ({ request }) => {});
      test.slow("x", async ({ request }) => {});
      test("x", { tag: "@a" }, async ({ request, baseURL }) => {});
      test("x", function ({ request }) {});
      test("x", async ({ request } = {}) => {});
      test("x", async ({ "request": api }) => {});
      test("x", async ({ request, ...fixtures }) => {});
    `)).toHaveLength(11);
  }, budgetMs);

  it("accepts browser fixtures and opaque fixtures", async () => {
    expect(await lint(`
      test("x", async ({ page, request }) => {});
      test("x", async ({ context, request }) => {});
      test("x", async ({ browser, request }) => {});
      test("x", async ({ page }) => {});
      test("x", async (fixtures) => {});
      test("x", async ({ page, request, ...rest }) => {});
    `)).toHaveLength(0);
  }, budgetMs);

  it("ignores hooks, suites, steps, computed properties, and unrelated callees", async () => {
    expect(await lint(`
      test.beforeEach(async ({ request }) => {});
      test.describe("x", () => {});
      test.step("x", async ({ request }) => {});
      test.other("x", async ({ request }) => {});
      test["only"]("x", async ({ request }) => {});
      other.test("x", async ({ request }) => {});
      test("x", async ({ ["request"]: api }) => {});
      test("x", async ({ page, ["request"]: api }) => {});
    `)).toHaveLength(0);
  }, budgetMs);

  it("inspects the final function argument", async () => {
    expect(await lint(`
      test("x", async ({ request }) => {}, () => {});
      test("x", () => {}, function ({ request }) {});
    `)).toHaveLength(1);
  }, budgetMs);

  it("does not inspect non-Playwright test files even when directly enabled", async () => {
    expect(await lint('test("x", async ({ request }) => {});', ".test.ts")).toHaveLength(0);
  }, budgetMs);

  it("documents aliased and extended test bindings as known non-detections", async () => {
    expect(await lint(`
      import { test as smoke } from "@playwright/test";
      smoke("x", async ({ request }) => {});
      const apiTest = smoke.extend({});
      apiTest("x", async ({ request }) => {});
    `)).toHaveLength(0);
  }, budgetMs);

  it("covers Playwright TSX files", async () => {
    expect(await lint('test("x", async ({ request }) => {});', ".pw.tsx")).toHaveLength(1);
  }, budgetMs);
});
