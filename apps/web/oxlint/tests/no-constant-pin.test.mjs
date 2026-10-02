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
