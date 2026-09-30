import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { budgetMs } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const web = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-memo-lint-"));
await cp(path.join(web, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(web, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), await readFile(path.join(web, ".oxlintrc.jsonc")));
afterAll(() => rm(mirror, { recursive: true, force: true }));

async function lint(source) {
  await writeFile(path.join(mirror, "memo-example.tsx"), source);
  const result = spawnSync(path.join(web, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--deny-warnings", "--disable-nested-config", "-f", "json", "memo-example.tsx"],
    { cwd: mirror, encoding: "utf8" });
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return { status: result.status, diagnostics: JSON.parse(result.stdout).diagnostics };
}

describe("production memoization guardrails", () => {
  it("rejects incomplete memo dependencies", async () => {
    const result = await lint(`import { useMemo } from "react";
      export function Example({ values }: { values: number[] }) {
        const total = useMemo(() => values.reduce((sum, value) => sum + value, 0), []);
        return <span>{total}</span>;
      }`);
    expect(result.status).toBe(1);
    expect(result.diagnostics.some((item) => item.code.includes("exhaustive-deps"))).toBe(true);
  }, budgetMs);

  it("rejects async memo calculations", async () => {
    const result = await lint(`import { useMemo } from "react";
      export function Example({ value }: { value: number }) {
        const total = useMemo(async () => value + 1, [value]);
        return <span>{String(total)}</span>;
      }`);
    expect(result.status).toBe(1);
    expect(result.diagnostics.some((item) => item.code.includes("use-memo"))).toBe(true);
  }, budgetMs);

  it("accepts complete memo dependencies and cheap direct derivations", async () => {
    const result = await lint(`import { useMemo } from "react";
      export function Example({ values }: { values: number[] }) {
        const total = useMemo(() => values.reduce((sum, value) => sum + value, 0), [values]);
        const empty = values.length === 0;
        return <span>{empty ? "Empty" : total}</span>;
      }`);
    expect(result.status).toBe(0);
    expect(result.diagnostics).toEqual([]);
  }, budgetMs);
});
