import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addressLiteralExceptions } from "../policy/address-literals.mjs";
applyRuleCheckTimeout();

const { directory, lint: lintFixtures, lintWithConfig } = await createOxlintWorkspace("home-oxlint-address-literals-", {
  rules: ["no-address-literal-regex"],
});

let fixtureIndex = 0;
async function lint(code, fixturePath = `fixture-${++fixtureIndex}.ts`, options) {
  const request = options === undefined ? {} : { rule: "no-address-literal-regex", options };
  return (await lintFixtures({ fixture: { code, path: fixturePath } }, request)).fixture;
}

const rejectedMessage = "Use the canonical hex parser in shared/chain/hex.ts instead of a handwritten address regex.";

// Batch real legacy files with an empty allow list so every exception stays pinned to its finding count.
describe("no-address-literal-regex", () => {
  it("rejects every required handwritten validator form", async () => {
    const cases = {
      constant: "const addressPattern = /^0x[0-9a-fA-F]{40}$/;",
      insensitive: "/^0x[0-9a-f]{40}$/i.test(segment);",
      inline: "function validate(address) { if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null; }",
      constructor: 'const pattern = new RegExp("^0x[0-9a-fA-F]{40}$");',
      template: "const pattern = new RegExp(`^0x[0-9a-f]{40}$`);",
      call: 'const pattern = RegExp("^0x[0-9a-fA-F]{40}$");',
      upper: "/^0x[0-9A-F]{40}$/;",
      letters: "/^0x[a-f]{40}$/;",
      enumerated: "/^0x[0123456789abcdef]{40}$/;",
      distinct: "/^0x[abc]{40}$/;",
      mixedDistinct: "/^0x[aAbBcC]{40}$/i;",
    };
    const findings = await lintFixtures(cases);
    for (const [name, diagnostics] of Object.entries(findings)) {
      expect(diagnostics, name).toHaveLength(1);
      expect(diagnostics[0].message, name).toBe(rejectedMessage);
    }
  }, budgetMs);

  it("accepts canonical parsers, sentinels, extraction, hashes, and nonexact shapes", async () => {
    expect(await lint(`
      parseAddress(value);
      requireAddress(value);
      isAddress(value, { strict: true });
      /^0x(?:0{40}|f{40})$/i.test(entry);
      /^0x0{40}$/i.test(address);
      /^0x[f]{40}$/i.test(address);
      /^0x[fF]{40}$/i.test(address);
      /^0x[ffff]{40}$/i.test(address);
      /^0x[af]{40}$/i.test(address);
      /^0x[aAfF]{40}$/i.test(address);
      new RegExp("^0x[aAfF]{40}$", "i");
      RegExp("^0x[aAfF]{40}$", "i");
      new RegExp("^0x[f]{40}$", "i");
      RegExp("^0x[fF]{40}$", "i");
      /erc20:(0x[0-9a-fA-F]{40})$/i;
      /^0x[0-9a-fA-F]{64}$/;
      /^0x[0-9a-fA-F]{1,40}$/;
      /0x[0-9a-fA-F]{40}/;
      /^[0-9a-fA-F]{40}$/;
      const re = new RegExp(dynamicPattern);
      /^0x[0-9-]{40}$/;
      new RegExp("^0x[0-9-]{40}$");
    `)).toHaveLength(0);
  }, budgetMs);

  it("accepts non-RegExp callees and nonliteral constructor arguments", async () => {
    expect(await lint(`
      new OtherPattern("^0x[0-9a-fA-F]{40}$");
      new globalThis.RegExp("^0x[0-9a-fA-F]{40}$");
      new RegExp("^0x[0-9a-fA-F]" + "{40}$");
      new RegExp(\`^0x[0-9a-fA-F]{\${length}}$\`);
      new RegExp();
    `)).toHaveLength(0);
  }, budgetMs);

  it("accepts shadowed RegExp parameters, variables, declarations, and imports", async () => {
    const pattern = '"^0x[0-9a-fA-F]{40}$"';
    const findings = await lintFixtures({
      parameter: `function run(RegExp) { return RegExp(${pattern}); }`,
      localConst: `const RegExp = OtherPattern; new RegExp(${pattern});`,
      localLet: `let RegExp = OtherPattern; RegExp(${pattern});`,
      localVar: `var RegExp = OtherPattern; new RegExp(${pattern});`,
      declaration: `function RegExp(pattern) { return pattern; } RegExp(${pattern});`,
      imported: `import { RegExp } from "patterns"; RegExp(${pattern});`,
      aliasedImport: `import { CustomPattern as RegExp } from "./patterns"; new RegExp(${pattern}); RegExp(${pattern});`,
    });
    for (const diagnostics of Object.values(findings)) expect(diagnostics).toHaveLength(0);
  }, budgetMs);

  it("recognizes global RegExp variables with zero definitions", async () => {
    const config = ".oxlintrc-platform.json";
    await writeFile(path.join(directory, config), JSON.stringify({
      plugins: [], categories: { correctness: "off" },
      env: { browser: true, node: true, es2024: true },
      jsPlugins: ["./oxlint/home-plugin.mjs"],
      rules: { "home/no-address-literal-regex": "error" },
    }));
    const findings = await lintWithConfig({
      global: 'RegExp("^0x[0-9a-fA-F]{40}$"); new RegExp("^0x[0-9a-fA-F]{40}$");',
    }, { config });
    expect(findings.global).toHaveLength(2);
  }, budgetMs);

  it("unwraps typed constructor expressions and accepts any flags and trimmed pattern text", async () => {
    expect(await lint(`
      /^0x[0-9A-F]{40}$/gimu;
      new (RegExp as typeof RegExp)(("^0x[0-9a-fA-F]{40}$" as string), "i");
      new (RegExp!)(\`^0x[0-9a-f]{40}$\`!);
      new (RegExp satisfies typeof RegExp)(("^0x[0-9a-fA-F]{40}$" satisfies string));
      new (<typeof RegExp>RegExp)(<string>"^0x[0-9a-fA-F]{40}$");
      new RegExp("  ^0x[0-9a-fA-F]{40}$  ", "g");
      (RegExp as typeof RegExp)(("^0x[0-9a-fA-F]{40}$" as string));
    `)).toHaveLength(7);
  }, budgetMs);

  it("replaces the default registry with an explicit allow list, including an empty array", async () => {
    const code = "const addressPattern = /^0x[0-9a-fA-F]{40}$/;";
    const grandfatheredPath = [...addressLiteralExceptions.keys()][0];
    expect(grandfatheredPath).toBeDefined();
    expect(await lint(code, grandfatheredPath)).toHaveLength(0);
    expect(await lint(code, grandfatheredPath, { allow: [] })).toHaveLength(1);
    expect(await lint(code, "shared/probe.ts", { allow: ["shared/probe.ts"] })).toHaveLength(0);
    expect(await lint(code, grandfatheredPath, { allow: ["shared/probe.ts"] })).toHaveLength(1);
  }, budgetMs);

  it("does not exempt neighboring paths or the canonical helper by default", async () => {
    const code = "const addressPattern = /^0x[0-9a-fA-F]{40}$/;";
    expect(await lint(code, "shared/probe.tsx", { allow: ["shared/probe.ts"] })).toHaveLength(1);
    expect(await lint(code, "shared/chain/hex.ts")).toHaveLength(1);
    expect(await lint(code, "nested/shared/formatting/address.ts", { allow: ["shared/formatting/address.ts"] })).toHaveLength(1);
    expect(await lint(code, "shared/nested/shared/formatting/address.ts", { allow: ["shared/formatting/address.ts"] })).toHaveLength(1);
    expect(await lint(code, "shared/nested/apps/web/shared/formatting/address.ts", { allow: ["shared/formatting/address.ts"] })).toHaveLength(1);
    expect(await lint(code, "nested/live-login.ts", { allow: ["live-login.ts"] })).toHaveLength(1);
    expect(await lint(code, "./shared/probe.ts", { allow: ["shared/probe.ts"] })).toHaveLength(0);
    expect(addressLiteralExceptions.has("shared/chain/hex.ts")).toBe(false);
  }, budgetMs);

  it("pins the registry size and every grandfathered file's exact finding count", async () => {
    const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
    const fixtures = Object.fromEntries(await Promise.all([...addressLiteralExceptions.keys()].map(async (entry) => [
      entry,
      { code: await readFile(path.join(appsWebDir, entry), "utf8"), path: entry },
    ])));
    // This count may only go down; lower it in the same change that deletes an entry.
    expect(addressLiteralExceptions.size).toBe(47);
    const findings = await lintFixtures(fixtures, { rule: "no-address-literal-regex", options: { allow: [] } });
    for (const [entry, count] of addressLiteralExceptions) {
      expect(findings[entry], `Update or delete the address-literal exception for ${entry}`).toHaveLength(count);
    }
  }, budgetMs);
});
