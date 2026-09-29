import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { browserSmokeCiPolicy } from "./ci-policy";

const webRoot = resolve(import.meta.dir, "../..");

test("non-CI smoke uses no retries and does not fail on flaky tests", () => {
  const policy = browserSmokeCiPolicy(false);
  expect(policy.retries).toBe(0);
  expect(policy.failOnFlakyTests).toBe(false);
  expect(policy.reporter).toBe("list");
});

test("CI smoke fails on a retry-only pass and retains the failed attempt trace", () => {
  const outputDir = resolve(tmpdir(), `home-browser-smoke-policy-${crypto.randomUUID()}`);
  try {
    const run = spawnSync(resolve(webRoot, "node_modules/.bin/playwright"), [
      "test", "--config", "tests/browser/ci-policy-fixture/playwright.config.ts", "--output", outputDir,
    ], {
      cwd: webRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
      encoding: "utf8",
      timeout: 60_000,
    });
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(1);
    expect(output).toContain("Flaky tests (1):");
    expect(output).toContain("retry-only pass");
    expect(output).toMatch(/retry #0 failed \d+ms/);
    expect(output).toMatch(/retry #1 passed \d+ms/);
    expect([...new Bun.Glob("**/trace.zip").scanSync({ cwd: outputDir })].length).toBeGreaterThan(0);
  } finally {
    Bun.spawnSync(["rm", "-rf", outputDir]);
  }
}, 60_000);
