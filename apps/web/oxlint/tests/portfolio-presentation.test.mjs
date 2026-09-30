import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
applyRuleCheckTimeout();

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const { directory: mirror, lint: lintFixtures, lintWithConfig } = await createOxlintWorkspace("home-portfolio-lint-", {
  rules: ["no-full-portfolio-presentation"],
});
await writeFile(path.join(mirror, ".production.jsonc"), await readFile(path.join(appsWebDir, ".oxlintrc.jsonc")));

async function lint(code, file = "client/home/portfolio-home-experience.tsx") {
  return (await lintFixtures({ fixture: { code, path: file } })).fixture;
}

describe("home/no-full-portfolio-presentation", () => {
  it("rejects full presenters even when imported under aliases or relative paths", async () => {
    expect(await lint(`
      import { presentBalances as summary } from "@/shared/balances/present";
      import { presentBalances as relative } from "../../shared/balances/present.ts";
      import { presentBalances as grouped } from "@/shared/balances/../balances/present";
    `)).toHaveLength(3);
  }, budgetMs);

  it("rejects exports so another module cannot launder the full API", async () => {
    expect(await lint(`
      export { presentBalances as fastSummary } from "./present";
      export * from "./present";
      export * as presenters from "./present";
    `, "shared/balances/bridge.ts")).toHaveLength(3);
  }, budgetMs);

  it("rejects opaque namespace, default, dynamic and require access", async () => {
    expect(await lint(`
      import * as presenters from "@/shared/balances/present";
      import presentersDefault from "@/shared/balances/present";
      import { default as alternate } from "@/shared/balances/present";
      void import("@/shared/balances/present");
      require("@/shared/balances/present");
      import legacy = require("@/shared/balances/present");
    `)).toHaveLength(6);
  }, budgetMs);

  it("normalizes statically composed runtime module paths", async () => {
    expect(await lint(`
      void import(\`@/shared/balances/present\`);
      void import("@/shared/" + "balances/present");
      require(\`../../shared/\${"balances"}/present.ts\`);
      void import(flag ? "@/shared/balances/present" : "./other");
    `)).toHaveLength(4);
  }, budgetMs);

  it("allows named focused presenters and type-only contracts", async () => {
    expect(await lint(`
      import { presentCashTotal, presentHomeBalances, type BalancesPresentation } from "@/shared/balances/present";
      import type * as Contracts from "@/shared/balances/present";
      import type { presentBalances } from "@/shared/balances/present";
      export type { BalancesPresentation } from "@/shared/balances/present";
      export { presentCashTotal } from "@/shared/balances/present";
      export type * from "@/shared/balances/present";
    `)).toHaveLength(0);
  }, budgetMs);

  it("allows only the exact list owner to import the full presenter, never re-export it", async () => {
    const source = 'import { presentBalances } from "@/shared/balances/present";';
    const found = await lintFixtures({
      owner: { code: source, path: "client/home/balances-panel.tsx" },
      cash: { code: source, path: "client/cash/balances-panel.tsx" },
      helper: { code: source, path: "client/home/balances-panel-helper.tsx" },
    });
    expect(found.owner).toHaveLength(0);
    expect(found.cash).toHaveLength(1);
    expect(found.helper).toHaveLength(1);
    expect(await lint('export { presentBalances } from "@/shared/balances/present";', "client/home/balances-panel.tsx")).toHaveLength(1);
  }, budgetMs);

  it("ignores identically named APIs from unrelated modules", async () => {
    expect(await lint(`
      import { presentBalances } from "./local";
      import * as helpers from "@/shared/balances/select";
      const summary = input.presentBalances();
    `)).toHaveLength(0);
  }, budgetMs);

  it("is enabled in production and excludes tests, stories and explorations in the real config", async () => {
    const code = 'import { presentBalances } from "@/shared/balances/present"; export const result = presentBalances(input);';
    const found = await lintWithConfig({
      cash: { code, path: "client/cash/cash-overview.tsx" },
      bridge: { code, path: "shared/balances/bridge.ts" },
      test: { code, path: "client/home/example.test.tsx" },
      story: { code, path: "client/home/example.stories.tsx" },
      exploration: { code, path: "client/home/explorations/example.tsx" },
    }, { config: ".production.jsonc" });
    const diagnostics = (name) => found[name].filter((item) => item.code === "home(no-full-portfolio-presentation)");
    expect(diagnostics("cash")).toHaveLength(1);
    expect(diagnostics("bridge")).toHaveLength(1);
    expect(diagnostics("test")).toHaveLength(0);
    expect(diagnostics("story")).toHaveLength(0);
    expect(diagnostics("exploration")).toHaveLength(0);
  }, budgetMs);
});
