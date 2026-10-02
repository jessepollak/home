import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { BOUNDARY_EXTENSIONS_GLOB } from "../exploration-boundary.mjs";
import { PRODUCTION_OVERRIDES, ROOT_CATCH_ALL, evaluateProductionOverrides, loadRootEntryExemptions, rootFencedOverrides, unclaimedRootOverrides } from "../root-entries.mjs";

const ts = createRequire(new URL("../../../apps/web/package.json", import.meta.url))("typescript");
const rootExemptions = loadRootEntryExemptions();
const clean = { missingOwners: [], duplicateOwners: [], missingRules: [], unenforcedRules: [], missing: [], unexpected: [], missingExclusions: [], unexpectedExclusions: [] };
const canonicalOverrides = () => PRODUCTION_OVERRIDES.map((spec) => ({
  files: [...spec.layers.map((layer) => `${layer}/**/*.${BOUNDARY_EXTENSIONS_GLOB}`), ROOT_CATCH_ALL],
  excludeFiles: [...spec.exclusions, ...rootExemptions.map(({ path }) => `./${path}`)],
  rules: Object.fromEntries(spec.rules.map((rule) => [rule, "error"])),
}));
const evaluate = (overrides) => evaluateProductionOverrides({ overrides, rootExemptions });

test("the production override inventory is pinned", () => {
  assert.deepEqual(PRODUCTION_OVERRIDES.map((spec) => spec.id), ["no-storybook-imports", "no-silent-catch", "anti-slop", "exploration-boundary"]);
});

test("canonical production overrides have exactly one owner and the root catch-all", () => {
  assert.equal(ROOT_CATCH_ALL, "./*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}");
  assert.deepEqual(evaluate(canonicalOverrides()), clean);
});

test("the root catch-all keeps its literal ./ anchor for every production override", () => {
  for (const [index, spec] of PRODUCTION_OVERRIDES.entries()) {
    const overrides = canonicalOverrides();
    overrides[index].files[overrides[index].files.length - 1] = ROOT_CATCH_ALL.slice(2);
    assert.deepEqual(evaluate(overrides), {
      ...clean,
      missing: [`${spec.id}: ${ROOT_CATCH_ALL}`],
      unexpected: [`${spec.id}: ${ROOT_CATCH_ALL.slice(2)}`],
    });
  }
});

test("a root exclusion without its ./ anchor is reported for every production override", () => {
  for (const [index, spec] of PRODUCTION_OVERRIDES.entries()) {
    const overrides = canonicalOverrides();
    overrides[index].excludeFiles = overrides[index].excludeFiles.map((pattern) => pattern === "./gmail.ts" ? "gmail.ts" : pattern);
    assert.deepEqual(evaluate(overrides), {
      ...clean,
      missingExclusions: [`${spec.id}: ./gmail.ts`],
      unexpectedExclusions: [`${spec.id}: gmail.ts`],
    });
  }
});

test("an absent production owner is reported", () => {
  assert.deepEqual(evaluate(canonicalOverrides().slice(1)), { ...clean, missingOwners: ["no-storybook-imports"] });
});

test("splitting a spec's rules across owners is reported as duplicate ownership", () => {
  const overrides = canonicalOverrides();
  const rule = "home/no-reflect-indirection";
  delete overrides[2].rules[rule];
  overrides.push({ ...overrides[2], rules: { [rule]: "error" } });
  assert.deepEqual(evaluate(overrides), { ...clean, duplicateOwners: ["anti-slop"] });
});

test("an owner must declare every spec rule", () => {
  const overrides = canonicalOverrides();
  delete overrides[2].rules["home/isolate-instrumentation-calls"];
  assert.deepEqual(evaluate(overrides), { ...clean, missingRules: ["anti-slop: home/isolate-instrumentation-calls"] });
});

test("a production rule with a non-enforcing severity is reported", () => {
  for (const setting of ["off", ["off"], 0]) {
    const overrides = canonicalOverrides();
    overrides[2].rules["home/no-reflect-indirection"] = setting;
    assert.deepEqual(evaluate(overrides), { ...clean, unenforcedRules: ["anti-slop: home/no-reflect-indirection"] });
  }
  const warnings = canonicalOverrides();
  warnings[2].rules["home/no-reflect-indirection"] = "warn";
  assert.deepEqual(evaluate(warnings), clean);
});

test("a named root pattern cannot replace the catch-all", () => {
  const overrides = canonicalOverrides();
  overrides[0].files[overrides[0].files.length - 1] = "./instrumentation*.ts";
  assert.deepEqual(evaluate(overrides), {
    ...clean,
    missing: [`no-storybook-imports: ${ROOT_CATCH_ALL}`],
    unexpected: ["no-storybook-imports: ./instrumentation*.ts"],
  });
});

test("a missing reasoned root exclusion is reported", () => {
  const overrides = canonicalOverrides();
  overrides[1].excludeFiles = overrides[1].excludeFiles.filter((pattern) => pattern !== "./playwright.config.ts");
  assert.deepEqual(evaluate(overrides), { ...clean, missingExclusions: ["no-silent-catch: ./playwright.config.ts"] });
});

test("an unexpected exclusion cannot weaken the production fence", () => {
  const overrides = canonicalOverrides();
  overrides[2].excludeFiles.push("./middleware.ts");
  assert.deepEqual(evaluate(overrides), { ...clean, unexpectedExclusions: ["anti-slop: ./middleware.ts"] });
});

test("every reasoned root exemption is required in every spec's canonical exclusion set", () => {
  assert.ok(rootExemptions.length > 0, "root-exclusion contract must not be vacuous");
  for (const { path, reason } of rootExemptions) {
    assert.ok(reason.trim(), `${path} must have a reason`);
    for (const [index, spec] of PRODUCTION_OVERRIDES.entries()) {
      const overrides = canonicalOverrides();
      assert.ok(overrides[index].excludeFiles.includes(`./${path}`), `${spec.id}: ${path}`);
      overrides[index].excludeFiles = overrides[index].excludeFiles.filter((pattern) => pattern !== `./${path}`);
      assert.deepEqual(evaluate(overrides), { ...clean, missingExclusions: [`${spec.id}: ./${path}`] });
    }
  }
});

test("root-fenced overrides select anchored and slashless patterns and require a claimed rule", () => {
  const claimed = new Set(["home/no-silent-catch"]);
  const overrides = [
    { files: ["./*.ts"], rules: { "home/no-silent-catch": "error" } },
    { files: ["*.ts"], rules: { "home/no-comments": "error" } },
    { excludeFiles: ["gmail.ts"], rules: {} },
    { files: ["server/**/*.ts"], rules: { "home/no-comments": "error" } },
  ];
  assert.deepEqual(rootFencedOverrides(overrides), [overrides[0], overrides[1], overrides[2]]);
  assert.deepEqual(unclaimedRootOverrides(overrides, claimed), [overrides[1], overrides[2]]);
});

test("the real Oxlint config has exactly the canonical production root fences", () => {
  const parsed = ts.parseConfigFileTextToJson("apps/web/.oxlintrc.jsonc",
    readFileSync(new URL("../../../apps/web/.oxlintrc.jsonc", import.meta.url), "utf8"));
  assert.equal(parsed.error, undefined, parsed.error && ts.flattenDiagnosticMessageText(parsed.error.messageText, " "));
  assert.equal(Object.hasOwn(parsed.config, "extends"), false,
    "the root-fence contract reads this config directly; an inherited config can add a second owner or an unanchored root pattern, so resolve extends in this contract before using it");
  assert.ok(Array.isArray(parsed.config.overrides) && parsed.config.overrides.length > 0, "the config must contain overrides");
  assert.deepEqual(evaluateProductionOverrides({ overrides: parsed.config.overrides, rootExemptions: loadRootEntryExemptions() }), clean);
  const claimedRules = new Set(PRODUCTION_OVERRIDES.flatMap((spec) => spec.rules));
  assert.ok(rootFencedOverrides(parsed.config.overrides).length > 0, "the config must contain root-anchored overrides");
  assert.deepEqual(unclaimedRootOverrides(parsed.config.overrides, claimedRules), [], "every root-anchored or slashless override must be claimed by a production root-fence spec");
});
