import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
applyRuleCheckTimeout();

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-portfolio-lint-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.json"), JSON.stringify({
  plugins: [], categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/no-full-portfolio-presentation": "error" },
}));
await writeFile(path.join(mirror, ".production.jsonc"), await readFile(path.join(appsWebDir, ".oxlintrc.jsonc")));
afterAll(() => rm(mirror, { recursive: true, force: true }));

async function lint(code, file = "client/home/portfolio-home-experience.tsx", config = ".oxlintrc.json") {
  await mkdir(path.dirname(path.join(mirror, file)), { recursive: true });
  await writeFile(path.join(mirror, file), code);
  const result = spawnSync(path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", file], { cwd: mirror, encoding: "utf8" });
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((item) => item.code === "home(no-full-portfolio-presentation)");
}

describe("home/no-full-portfolio-presentation", () => {
  it("rejects full presenters even when imported under aliases or relative paths", async () => {
    expect(await lint(`
      import { presentBalances as summary } from "@/shared/balances/present";
      import { presentBalances as relative } from "../../shared/balances/present.ts";
      import { presentBalances as grouped } from "@/shared/balances/../balances/present";
    `)).toHaveLength(3);
  });

  it("rejects exports so another module cannot launder the full API", async () => {
    expect(await lint(`
      export { presentBalances as fastSummary } from "./present";
      export * from "./present";
      export * as presenters from "./present";
    `, "shared/balances/bridge.ts")).toHaveLength(3);
  });

  it("rejects opaque namespace, default, dynamic and require access", async () => {
    expect(await lint(`
      import * as presenters from "@/shared/balances/present";
      import presentersDefault from "@/shared/balances/present";
      import { default as alternate } from "@/shared/balances/present";
      void import("@/shared/balances/present");
      require("@/shared/balances/present");
      import legacy = require("@/shared/balances/present");
    `)).toHaveLength(6);
  });

  it("normalizes statically composed runtime module paths", async () => {
    expect(await lint(`
      void import(\`@/shared/balances/present\`);
      void import("@/shared/" + "balances/present");
      require(\`../../shared/\${"balances"}/present.ts\`);
      void import(flag ? "@/shared/balances/present" : "./other");
    `)).toHaveLength(4);
  });

  it("allows named focused presenters and type-only contracts", async () => {
    expect(await lint(`
      import { presentCashTotal, presentHomeBalances, type BalancesPresentation } from "@/shared/balances/present";
      import type * as Contracts from "@/shared/balances/present";
      import type { presentBalances } from "@/shared/balances/present";
      export type { BalancesPresentation } from "@/shared/balances/present";
      export { presentCashTotal } from "@/shared/balances/present";
      export type * from "@/shared/balances/present";
    `)).toHaveLength(0);
  });

  it("allows only the exact list owner to import the full presenter, never re-export it", async () => {
    const source = 'import { presentBalances } from "@/shared/balances/present";';
    expect(await lint(source, "client/home/balances-panel.tsx")).toHaveLength(0);
    expect(await lint(source, "client/cash/balances-panel.tsx")).toHaveLength(1);
    expect(await lint(source, "client/home/balances-panel-helper.tsx")).toHaveLength(1);
    expect(await lint('export { presentBalances } from "@/shared/balances/present";', "client/home/balances-panel.tsx")).toHaveLength(1);
  });

  it("ignores identically named APIs from unrelated modules", async () => {
    expect(await lint(`
      import { presentBalances } from "./local";
      import * as helpers from "@/shared/balances/select";
      const summary = input.presentBalances();
    `)).toHaveLength(0);
  });

  it("is enabled in production and excludes tests, stories and explorations in the real config", async () => {
    const code = 'import { presentBalances } from "@/shared/balances/present"; export const result = presentBalances(input);';
    expect(await lint(code, "client/cash/cash-overview.tsx", ".production.jsonc")).toHaveLength(1);
    expect(await lint(code, "shared/balances/bridge.ts", ".production.jsonc")).toHaveLength(1);
    expect(await lint(code, "client/home/example.test.tsx", ".production.jsonc")).toHaveLength(0);
    expect(await lint(code, "client/home/example.stories.tsx", ".production.jsonc")).toHaveLength(0);
    expect(await lint(code, "client/home/explorations/example.tsx", ".production.jsonc")).toHaveLength(0);
  });
});
