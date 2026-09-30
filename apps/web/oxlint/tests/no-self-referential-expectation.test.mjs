import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-self-referential-", {
  rules: ["no-self-referential-expectation"],
});

async function lintTestFile(filename, code) {
  return (await lint({ fixture: { code, path: filename } })).fixture;
}

describe("no-self-referential-expectation", () => {
  it("rejects expected values imported from the module the test names", async () => {
    expect(await lintTestFile("policy.test.ts", `
      import { expect } from "bun:test";
      import { policy } from "./policy";
      expect(readHeader()).toBe(policy);
    `)).toHaveLength(1);
  }, budgetMs);

  it("rejects expected values imported from a same-directory subject by normalized name", async () => {
    expect(await lintTestFile("next-config.test.ts", `
      import { expect } from "bun:test";
      import { contentSecurityPolicy } from "./next.config";
      expect(readHeader()).toBe(contentSecurityPolicy);
    `)).toHaveLength(1);
  }, budgetMs);

  it("resolves relative and alias imports to the subject file without same-stem cross-directory matches", async () => {
    expect(await lintTestFile("feature/config.test.ts", `
      import { expect } from "bun:test";
      import { localConfig } from "./config";
      import { aliasedConfig } from "@/feature/config";
      import { otherConfig } from "../other-dir/config";
      expect(readLocal()).toBe(localConfig);
      expect(readAlias()).toBe(aliasedConfig);
      expect(readOther()).toBe(otherConfig);
    `)).toHaveLength(2);
  }, budgetMs);

  it("rejects imported aliases and every tracked matcher argument", async () => {
    expect(await lintTestFile("limit.test.ts", `
      import { expect } from "bun:test";
      import { maxPages as pages } from "./limit";
      expect(read()).toEqual(pages);
      expect(read()).toHaveLength(pages);
      expect(read()).not.toBe(pages);
    `)).toHaveLength(3);
  }, budgetMs);

  it("unwraps typed, non-null, collection, template, and namespace expected values", async () => {
    expect(await lintTestFile("limit.test.ts", `
      import { expect } from "bun:test";
      import { maxPages } from "./limit";
      import * as limits from "./limit";
      const key = "maxPages";
      expect(read()).toBe(maxPages as number);
      expect(read()).toBe(maxPages!);
      expect(read()).toEqual([maxPages]);
      expect(read()).toMatchObject({ max: maxPages });
      expect(read()).toBe(\`\${maxPages}\`);
      expect(read()).toBe(limits.maxPages);
      expect(read()).toBe(limits["maxPages"]);
      expect(read()).toBe(limits[key]);
    `)).toHaveLength(7);
  }, budgetMs);

  it("treats the current-directory barrel as the index subject", async () => {
    expect(await lintTestFile("feature/index.test.ts", `
      import { expect } from "bun:test";
      import { maxPages } from ".";
      expect(read()).toBe(maxPages);
    `)).toHaveLength(1);
  }, budgetMs);

  it("accepts literals, derived members, and locally defined expectations", async () => {
    expect(await lintTestFile("behavior.test.ts", `
      import { expect } from "bun:test";
      import { readHeader, expectedHeader } from "./behavior";
      const local = "local";
      expect(readHeader()).toBe("frame-ancestors 'none'");
      expect(readHeader()).toBe(expectedHeader.name);
      expect(readHeader()).toBe(local);
      expect(readHeader()).not.toBeDefined();
    `)).toHaveLength(0);
  }, budgetMs);

  it("accepts same-named constants imported from another module alias", async () => {
    expect(await lintTestFile("registry.test.ts", `
      import { expect } from "bun:test";
      import { DEFAULT_MARKET } from "@/shared/registry/registry";
      import { readMarket } from "./registry";
      expect(readMarket()).toBe(DEFAULT_MARKET);
    `)).toHaveLength(0);
  }, budgetMs);

  it("stays off for files that are not tests", async () => {
    expect(await lintTestFile("policy.ts", `
      import { expect } from "bun:test";
      import { policy } from "./policy";
      expect(readHeader()).toBe(policy);
    `)).toHaveLength(0);
  }, budgetMs);
});
