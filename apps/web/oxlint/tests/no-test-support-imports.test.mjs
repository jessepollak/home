import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { budgetMs } from "./helpers/oxlint-workspace.mjs";
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

function conditionalSpecifier(count) {
  const prefixes = Array.from({ length: count - 1 }, (_, index) => `./prefix${index}/zz`)
    .reduceRight((tail, prefix, index) => `(prefixFlag${index} ? ${JSON.stringify(prefix)} : ${tail})`, '"./te"');
  const suffixes = Array.from({ length: count - 1 }, (_, index) => `zz${index}`)
    .reduceRight((tail, suffix, index) => `(suffixFlag${index} ? ${JSON.stringify(suffix)} : ${tail})`, '"sts/helper"');
  return `export const load = import("" + ${prefixes} + ${suffixes});`;
}

describe("no-test-support-imports", () => {
  it("ignores checkout ancestry while rejecting test-support paths", async () => {
    expect(await lintTestFile("client/clean-relative.ts", 'export * from "./live";')).toHaveLength(0);
    expect(await lintTestFile("client/leak.ts", 'export * from "../../tests/helper";')).toHaveLength(1);
  }, budgetMs);

  it("normalizes alias traversal and backslashes beneath a testing ancestor", async () => {
    expect(await lintTestFile("client/alias-traversal.ts", 'export * from "@/tests/../client/live";')).toHaveLength(0);
    expect(await lintTestFile("client/windows.ts", 'export type Helper = import("..\\\\tests\\\\helper").Helper;')).toHaveLength(1);
  }, budgetMs);

  it("rejects test-harness targets beneath a testing ancestor", async () => {
    expect(await lintTestFile("client/harness-consumer.ts", 'export * from "./probe-test-harness";')).toHaveLength(1);
  }, budgetMs);

  it("rejects cross-operand test-support joins beyond the analysis bounds", async () => {
    expect(await lintTestFile("client/bounded-specifier.ts", conditionalSpecifier(65))).toHaveLength(1);
  }, budgetMs);

  it("bounds work across repeated binary conditional fragments", async () => {
    const prefixes = Array.from({ length: 20 }, (_, index) => `(prefixFlag${index} ? "./te" : "./zz")`).join(" + ");
    const suffixes = Array.from({ length: 20 }, (_, index) => `(suffixFlag${index} ? "sts/helper" : "zz")`).join(" + ");
    expect(await lintTestFile("client/repeated-specifier.ts", `export const load = import(${prefixes} + ${suffixes});`)).toHaveLength(1);
  }, budgetMs);

  it("bounds segment work without conditional alternatives or known test-support fragments", async () => {
    const specifier = (count) => `export const load = import(\`${Array.from({ length: count }, (_, index) => `\${part${index}}`).join("")}\`);`;
    expect(await lintTestFile("client/work-only-specifier.ts", specifier(80))).toHaveLength(1);
    expect(await lintTestFile("client/work-control-specifier.ts", specifier(8))).toHaveLength(0);
  }, budgetMs);

  it("bounds segment work across a long template chain", async () => {
    const parts = Array.from({ length: 24000 }, (_, index) => `p${index}\${part${index}}`).join("");
    const start = performance.now();
    const diagnostics = await lintTestFile("client/long-template-specifier.ts", `export const load = import(\`${parts}\`);`);
    const elapsed = performance.now() - start;
    console.info(`long template lint: ${elapsed.toFixed(3)} ms`);
    expect(diagnostics).toHaveLength(1);
    expect(elapsed).toBeLessThan(5000);
  }, budgetMs);

  it("re-forms cross-operand test-support joins within the analysis bounds", async () => {
    expect(await lintTestFile("client/joined-specifier.ts", conditionalSpecifier(10))).toHaveLength(1);
  }, budgetMs);

  it("keeps bounded conditional fragments without test-support joins clean", async () => {
    expect(await lintTestFile("client/conditional-clean.ts", 'export const load = import("" + (flag0 ? "./live/" : "./other/") + (flag1 ? "row" : "item") + (flag2 ? ".js" : ".ts"));')).toHaveLength(0);
  }, budgetMs);
});
