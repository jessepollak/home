import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-no-request-only-playwright-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lint(code, suffix = ".pw.ts") {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}${suffix}`;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await writeFile(path.join(mirror, fixture), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-request-only-playwright": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-request-only-playwright)");
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
  });

  it("accepts browser fixtures and opaque fixtures", async () => {
    expect(await lint(`
      test("x", async ({ page, request }) => {});
      test("x", async ({ context, request }) => {});
      test("x", async ({ browser, request }) => {});
      test("x", async ({ page }) => {});
      test("x", async (fixtures) => {});
      test("x", async ({ page, request, ...rest }) => {});
    `)).toHaveLength(0);
  });

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
  });

  it("inspects the final function argument", async () => {
    expect(await lint(`
      test("x", async ({ request }) => {}, () => {});
      test("x", () => {}, function ({ request }) {});
    `)).toHaveLength(1);
  });

  it("does not inspect non-Playwright test files even when directly enabled", async () => {
    expect(await lint('test("x", async ({ request }) => {});', ".test.ts")).toHaveLength(0);
  });

  it("documents aliased and extended test bindings as known non-detections", async () => {
    expect(await lint(`
      import { test as smoke } from "@playwright/test";
      smoke("x", async ({ request }) => {});
      const apiTest = smoke.extend({});
      apiTest("x", async ({ request }) => {});
    `)).toHaveLength(0);
  });

  it("covers Playwright TSX files", async () => {
    expect(await lint('test("x", async ({ request }) => {});', ".pw.tsx")).toHaveLength(1);
  });
});
