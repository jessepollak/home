import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
applyRuleCheckTimeout();

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "home-oxlint-test-support-"));
const mirror = path.join(root, "testing", "checkout");
await mkdir(mirror, { recursive: true });
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(root, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lintTestFile(filename, code) {
  fixtureIndex += 1;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await mkdir(path.dirname(path.join(mirror, filename)), { recursive: true });
  await writeFile(path.join(mirror, filename), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [], categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-test-support-imports": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", filename],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-test-support-imports)");
}

describe("no-test-support-imports", () => {
  it("ignores checkout ancestry while rejecting test-support paths", async () => {
    expect(await lintTestFile("client/clean-relative.ts", 'export * from "./live";')).toHaveLength(0);
    expect(await lintTestFile("client/leak.ts", 'export * from "../../tests/helper";')).toHaveLength(1);
  });

  it("normalizes alias traversal and backslashes beneath a testing ancestor", async () => {
    expect(await lintTestFile("client/alias-traversal.ts", 'export * from "@/tests/../client/live";')).toHaveLength(0);
    expect(await lintTestFile("client/windows.ts", 'export type Helper = import("..\\\\tests\\\\helper").Helper;')).toHaveLength(1);
  });

  it("rejects test-harness targets beneath a testing ancestor", async () => {
    expect(await lintTestFile("client/harness-consumer.ts", 'export * from "./probe-test-harness";')).toHaveLength(1);
  });
});
