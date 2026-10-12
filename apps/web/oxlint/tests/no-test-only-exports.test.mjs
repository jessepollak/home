import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import { allowedTestOnlyExports } from "../policy/test-only-exports.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-test-exports-", {
  rules: ["no-test-only-exports"],
});

async function check(path, code) {
  return (await lint({ fixture: { path, code } })).fixture;
}

describe("no-test-only-exports", () => {
  it("rejects declarations, aliases, reexports and exported class members", async () => {
    expect(await check("server/example.ts", `
      export function resetForTests() {}
      export const valueForTests = 1;
      const local = 1;
      export { local as aliasForTests };
      export { reset as otherForTests } from "./other";
      export class Store { clearForTests() {} }
      class Later { seedForTests() {} }
      export { Later };
      export default class { wipeForTests() {} }
    `)).toHaveLength(7);
  }, budgetMs);

  it("allows private members, unexported helpers and public production names", async () => {
    expect(await check("server/example.ts", `
      function resetForTests() {}
      class Local { clearForTests() {} }
      export class Store { private clearForTests() {} #seedForTests() {} read() {} }
      export function read() {}
    `)).toHaveLength(0);
    const code = 'export function resetForTests() {}';
    const found = await lint(Object.fromEntries(["server/example.test.ts", "tests/example.ts", "client/example.stories.tsx", "scripts/example.ts"].map((path) => [path, { path, code }])));
    for (const findings of Object.values(found)) expect(findings).toHaveLength(0);
  }, budgetMs);

  it("grandfathers only exact names at each production path", async () => {
    const fixtures = Object.fromEntries([...allowedTestOnlyExports].map(([path, names]) => [path, {
      path, code: [...names].map((name) => `export function ${name}() {}`).join("\n")
        + '\nexport function unlistedForTests() {}',
    }]));
    const found = await lint(fixtures);
    for (const findings of Object.values(found)) expect(findings).toHaveLength(1);
    expect(await check("server/other.ts", 'export function setActionsStoreForTests() {}')).toHaveLength(1);
    expect(await check("server/balances/memory-snapshot-store.ts", 'export class Store { deleteForTests() {} extraForTests() {} }')).toHaveLength(1);
  }, budgetMs);
});
