import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { budgetMs } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const web = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-gdp-lint-"));
await cp(path.join(web, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(web, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), await readFile(path.join(web, ".oxlintrc.jsonc")));
afterAll(() => rm(mirror, { recursive: true, force: true }));

async function lint(file, source) {
  await mkdir(path.dirname(path.join(mirror, file)), { recursive: true });
  await writeFile(path.join(mirror, file), source);
  const result = spawnSync(path.join(web, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--deny-warnings", "--disable-nested-config", "-f", "json", file],
    { cwd: mirror, encoding: "utf8" });
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((item) => item.code?.startsWith("gdp-ts("));
}

describe("authorization proof guardrails", () => {
  it("allows private provers in the trusted proof directory", async () => {
    const diagnostics = await lint("server/proofs/private.ts", `import "server-only";
      import { defineProof } from "@gdp-ts/core";
      const OperatorAccess = defineProof("OperatorAccess");`);
    expect(diagnostics).toEqual([]);
  }, budgetMs);

  it("rejects proof definitions outside the trusted proof directory", async () => {
    const diagnostics = await lint("server/operator/invalid.ts", `import "server-only";
      import { defineProof } from "@gdp-ts/core";
      const OperatorAccess = defineProof("OperatorAccess");`);
    expect(diagnostics.map((item) => item.code)).toContain("gdp-ts(no-define-proof)");
  }, budgetMs);

  it("rejects exported provers in the trusted proof directory", async () => {
    const diagnostics = await lint("server/proofs/exported.ts", `import "server-only";
      import { defineProof } from "@gdp-ts/core";
      export const OperatorAccess = defineProof("OperatorAccess");`);
    expect(diagnostics.map((item) => item.code)).toContain("gdp-ts(no-exported-prover)");
  }, budgetMs);

  it("rejects assertions to imported proof types", async () => {
    const diagnostics = await lint("server/operator-settings/forged.ts", `import "server-only";
      import type { OperatorAccess } from "@/server/proofs/operator-access";
      const proof = {} as OperatorAccess<"n">;`);
    expect(diagnostics.map((item) => item.code)).toContain("gdp-ts(no-proof-assertion)");
  }, budgetMs);

  it("allows type-only proof imports and aliases", async () => {
    const diagnostics = await lint("server/operator-settings/clean.ts", `import "server-only";
      import type { OperatorAccess } from "@/server/proofs/operator-access";
      type Access = OperatorAccess<"n">;`);
    expect(diagnostics).toEqual([]);
  }, budgetMs);
});
