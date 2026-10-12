import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import { noConstantPin } from "../rules/tests.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-constant-pin-", {
  rules: ["no-constant-pin"],
});

async function lintTestFile(filename, code) {
  return (await lint({ fixture: { code, path: filename } })).fixture;
}

describe("no-constant-pin", () => {
  it("rejects all three direct matchers on imported tuning constants", async () => {
    expect(await lintTestFile("client/limits.test.ts", `
      import { TUNING_LIMIT, RETRY_DELAY_MS, MAX_QUEUE_DEPTH } from "./limits";
      expect(TUNING_LIMIT).toBe(10);
      expect(RETRY_DELAY_MS).toEqual(1000);
      expect(MAX_QUEUE_DEPTH).toStrictEqual(5);
    `)).toHaveLength(3);
  }, budgetMs);

  it("rejects folded numeric arithmetic", async () => {
    expect(await lintTestFile("client/backoff.test.ts", `
      import { CODEX_BACKOFF_MS } from "./backoff";
      expect(CODEX_BACKOFF_MS).toBe(24 * 60 * 60 * 1_000);
    `)).toHaveLength(1);
  }, budgetMs);

  it("rejects unary positive numbers and negative bigints", async () => {
    expect(await lintTestFile("client/unary.test.ts", `
      import { TUNING_LIMIT } from "./limits";
      expect(TUNING_LIMIT).toBe(+10);
      expect(TUNING_LIMIT).toBe(-1n);
    `)).toHaveLength(2);
  }, budgetMs);

  it("allows identity pins by name and value", async () => {
    expect(await lintTestFile("client/identity.test.ts", `
      import { BASE_CHAIN_ID, USDC_ADDRESS, AGENTATION_ENDPOINT, CDP_WEBHOOK_PATH,
        ACCESS_CONTRACT_VERSION, OTHER_CHAIN, EXTERNAL_ORIGIN, ASSET_ADDRESS_HEX } from "./identity";
      expect(BASE_CHAIN_ID).toBe(8453);
      expect(BASE_CHAIN_ID).toBe(-1);
      expect(USDC_ADDRESS).toEqual("0x1111111111111111111111111111111111111111");
      expect(AGENTATION_ENDPOINT).toBe("http://localhost:4747");
      expect(CDP_WEBHOOK_PATH).toBe("/platform/v2/data/webhooks/subscriptions");
      expect(ACCESS_CONTRACT_VERSION).toBe(1);
      expect(OTHER_CHAIN).toBe(84532);
      expect(EXTERNAL_ORIGIN).toBe("wss://example.com");
      expect(ASSET_ADDRESS_HEX).toBe("0x1111111111111111111111111111111111111111");
    `)).toHaveLength(0);
  }, budgetMs);

  it("accepts behavior, local constants, matcher modifiers, and nonbinding subjects", async () => {
    expect(await lintTestFile("client/behavior.test.ts", `
      import { TUNING_LIMIT, lowerCaseLimit } from "./limits";
      const LOCAL_LIMIT = 10;
      expect(readLimit()).toBe(10);
      expect(LOCAL_LIMIT).toBe(10);
      expect(TUNING_LIMIT).toBe(null);
      expect(TUNING_LIMIT).not.toBe(10);
      expect(Promise.resolve(TUNING_LIMIT)).resolves.toBe(10);
      expect(lowerCaseLimit).toBe(10);
      expect(limits.TUNING_LIMIT).toBe(10);
      expect(TUNING_LIMIT).toBe([10]);
    `)).toHaveLength(0);
  }, budgetMs);

  it("rejects subject-imported expectation tables in every iteration form", async () => {
    expect(await lintTestFile("client/limits.test.ts", `
      import { cases as rows } from "@/client/limits";
      import * as limits from "./limits";
      for (const row of rows) expect(read(row)).toBe(row);
      rows.forEach((row) => expect(read(row)).toEqual(row));
      rows.map(({ input }) => expect(read(input)).not.toBeNull());
      test.each(rows)("case", (row) => expect(read(row)).toBe(row));
      describe.each(rows)("case", (row) => { test("read", () => expect(read(row)).toBe(row)); });
      for (const row of Object.values(limits.cases)) expect(read(row)).toBe(row);
    `)).toHaveLength(6);
  }, budgetMs);

  it("keeps literal cases, other modules, type imports, shadowed bindings and nonasserting loops", async () => {
    expect(await lintTestFile("client/limits.test.ts", `
      import { cases, read } from "./limits";
      import { fixtures } from "../other/limits";
      import type { TypeCases } from "./limits";
      for (const row of [1, 2]) expect(read(row)).toBe(row);
      fixtures.forEach((row) => expect(read(row)).toBe(row));
      for (const row of TypeCases) expect(read(row)).toBe(row);
      cases.forEach((row) => consume(row));
      cases.map((row) => row.input);
      for (const row of cases) expect(unrelated).toBe(1);
      function scenario(cases) { for (const row of cases) expect(read(row)).toBe(row); }
      for (const [fn, input] of [[read, 1]]) expect(fn(input)).toBe(2);
    `)).toHaveLength(0);
  }, budgetMs);

  it("shares normalized subject and index resolution with self-referential expectations", async () => {
    expect(await lintTestFile("feature/next-config.test.ts", 'import { cases } from "./next.config"; cases.forEach(row => expect(read(row)).toBe(1));')).toHaveLength(1);
    expect(await lintTestFile("feature/index.test.ts", 'import { cases } from "."; test.each(cases)("case", row => expect(read(row)).toBe(1));')).toHaveLength(1);
  }, budgetMs);

  it("grandfathers only an exact table import name and file", async () => {
    expect(await lintTestFile("config/invest-assets.test.ts", `
      import { investAssets as allowed, stockAssets } from "./invest-assets";
      allowed.forEach(row => expect(read(row)).toBe(1));
      stockAssets.forEach(row => expect(read(row)).toBe(1));
    `)).toHaveLength(1);
    expect(await lintTestFile("config/other/invest-assets.test.ts", 'import { investAssets } from "./invest-assets"; investAssets.forEach(row => expect(read(row)).toBe(1));')).toHaveLength(1);
  }, budgetMs);

  it("covers support files and skips production files", async () => {
    const pin = 'import { TUNING_LIMIT } from "./limits"; expect(TUNING_LIMIT).toBe(10);';
    const filenames = ["tests/helpers/limit.ts", "testing/limit.ts", "client/limit.test-harness.ts", "client/limit-smoke-fixture.ts", "client/limit.pw.ts"];
    const found = await lint(Object.fromEntries([...filenames, "client/retry.ts", "tests/example.stories.tsx"].map((filename) =>
      [filename, { code: pin, path: filename }])));
    for (const filename of filenames) {
      expect(found[filename]).toHaveLength(1);
    }
    expect(noConstantPin.create({ filename: "tests/helpers/limit.ts" })).toHaveProperty("CallExpression");
    expect(found["client/retry.ts"]).toHaveLength(0);
    expect(found["tests/example.stories.tsx"]).toHaveLength(0);
  }, budgetMs);
});
