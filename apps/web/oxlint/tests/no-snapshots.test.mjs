import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-snapshots-", {
  rules: ["no-snapshots"],
});

describe("no-snapshots", () => {
  it("rejects all snapshot matchers including modifiers and computed spellings", async () => {
    const found = await lint({ fixture: { path: "shared/example.test.ts", code: `
      expect(result).toMatchSnapshot();
      expect(result).toMatchInlineSnapshot("value");
      expect(run).not.toThrowErrorMatchingSnapshot();
      expect(run).toThrowErrorMatchingInlineSnapshot("error");
      expect(result)["toMatchSnapshot"]();
    ` } });
    expect(found.fixture).toHaveLength(5);
  }, budgetMs);

  it("allows behavioral assertions and stays off for production and stories", async () => {
    const found = await lint({
      behavior: { path: "shared/example.test.ts", code: 'expect(result).toEqual({ amount: "10" });' },
      production: { path: "shared/example.ts", code: 'expect(result).toMatchSnapshot();' },
      story: { path: "tests/example.stories.tsx", code: 'expect(result).toMatchSnapshot();' },
      support: { path: "tests/helper.ts", code: 'expect(result).toMatchSnapshot();' },
    });
    expect(found.behavior).toHaveLength(0);
    expect(found.production).toHaveLength(0);
    expect(found.story).toHaveLength(0);
    expect(found.support).toHaveLength(1);
  }, budgetMs);
});
