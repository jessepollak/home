import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { browserSmokeCiPolicy } from "./ci-policy";
import { retryOnlyPassWarnings } from "./attempt-timing-reporter";

const webRoot = resolve(import.meta.dir, "../..");
const repoRoot = resolve(webRoot, "../..");

function runFixture(title: string, outputDir: string, env: Partial<NodeJS.ProcessEnv> = {}) {
  const run = spawnSync(resolve(webRoot, "node_modules/.bin/playwright"), [
    "test", "--config", "tests/browser/ci-policy-fixture/playwright.config.ts", "--output", outputDir, "-g", title,
  ], {
    cwd: webRoot,
    env: { ...process.env, SMOKE_POLICY_REJECT_RETRY_ONLY_PASS: "0", GITHUB_ACTIONS: "false", ...env, FORCE_COLOR: "0" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { run, output: `${run.stdout}\n${run.stderr}` };
}

test("non-CI smoke uses no retries and does not fail on flaky tests", () => {
  const policy = browserSmokeCiPolicy(false);
  expect(policy.retries).toBe(0);
  expect(policy.failOnFlakyTests).toBe(false);
  expect(policy.reporter).toBe("list");
});

test("CI smoke retries without rejecting retry-only passes", () => {
  const policy = browserSmokeCiPolicy(true);
  expect(policy.retries).toBe(1);
  expect(policy.failOnFlakyTests).toBe(false);
});

test("CI regression rejects retry-only passes", () => {
  expect(browserSmokeCiPolicy(true, { rejectRetryOnlyPass: true }).failOnFlakyTests).toBe(true);
});

test("CI smoke warns on a retry-only pass and retains the failed attempt trace", () => {
  const outputDir = resolve(tmpdir(), `home-browser-smoke-policy-${crypto.randomUUID()}`);
  try {
    const { run, output } = runFixture("retry-only pass", outputDir, { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: repoRoot });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    expect(output).toContain("Flaky tests (1):");
    expect(output).toContain("retry-only pass");
    expect(output).toMatch(/retry #0 failed \d+ms/);
    expect(output).toMatch(/retry #1 passed \d+ms/);
    expect(output).toContain("1 flaky, 0 unexpected");
    expect(output).toContain("::warning file=apps/web/tests/browser/ci-policy-fixture/flaky.fixture.ts,line=");
    expect([...new Bun.Glob("**/trace.zip").scanSync({ cwd: outputDir })].length).toBeGreaterThan(0);
  } finally {
    Bun.spawnSync(["rm", "-rf", outputDir]);
  }
}, 60_000);

test("CI smoke caps warning annotations at ten and keeps an overflow summary", () => {
  const flaky = Array.from({ length: 11 }, (_, index) => ({
    location: { file: `${repoRoot}/apps/web/tests/browser/ci-policy-fixture/flaky.fixture.ts`, line: index + 1 },
    titlePath: () => ["chromium-smoke", "flaky.fixture.ts", `retry-only pass ${index + 1}`],
    results: [{ error: { message: "Error: expect(received).toBeGreaterThan(expected)" } }],
  }));
  const atLimit = retryOnlyPassWarnings(flaky.slice(0, 10));
  expect(atLimit).toHaveLength(10);
  expect(atLimit.join("\n")).not.toContain("additional retry-only passes");
  const overflow = retryOnlyPassWarnings(flaky);
  expect(overflow).toHaveLength(10);
  expect(overflow.filter((warning) => warning.includes("file="))).toHaveLength(9);
  expect(overflow.at(-1)).toContain("2 additional retry-only passes");
  expect(retryOnlyPassWarnings([])).toEqual([]);
});

test("CI regression fails on a retry-only pass", () => {
  const outputDir = resolve(tmpdir(), `home-browser-regression-policy-${crypto.randomUUID()}`);
  try {
    const { run, output } = runFixture("retry-only pass", outputDir, { SMOKE_POLICY_REJECT_RETRY_ONLY_PASS: "1" });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(1);
    expect(output).toContain("Flaky tests (1):");
  } finally {
    Bun.spawnSync(["rm", "-rf", outputDir]);
  }
}, 60_000);

test("CI smoke fails when both attempts fail", () => {
  const outputDir = resolve(tmpdir(), `home-browser-failure-policy-${crypto.randomUUID()}`);
  try {
    const { run, output } = runFixture("always fails", outputDir);
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(1);
    expect(output).toContain("1 unexpected");
    expect(output).not.toContain("::warning");
  } finally {
    Bun.spawnSync(["rm", "-rf", outputDir]);
  }
}, 60_000);
