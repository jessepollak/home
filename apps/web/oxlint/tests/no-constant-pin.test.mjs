import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { noConstantPin } from "../rules/tests.mjs";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-constant-pin-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lintTestFile(filename, code) {
  fixtureIndex += 1;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await mkdir(path.dirname(path.join(mirror, filename)), { recursive: true });
  await writeFile(path.join(mirror, filename), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [], categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-constant-pin": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", filename],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-constant-pin)");
}

describe("no-constant-pin", () => {
  it("rejects all three direct matchers on imported tuning constants", async () => {
    expect(await lintTestFile("client/limits.test.ts", `
      import { TUNING_LIMIT, RETRY_DELAY_MS, MAX_QUEUE_DEPTH } from "./limits";
      expect(TUNING_LIMIT).toBe(10);
      expect(RETRY_DELAY_MS).toEqual(1000);
      expect(MAX_QUEUE_DEPTH).toStrictEqual(5);
    `)).toHaveLength(3);
  });

  it("rejects folded numeric arithmetic", async () => {
    expect(await lintTestFile("client/backoff.test.ts", `
      import { CODEX_BACKOFF_MS } from "./backoff";
      expect(CODEX_BACKOFF_MS).toBe(24 * 60 * 60 * 1_000);
    `)).toHaveLength(1);
  });

  it("rejects unary positive numbers and negative bigints", async () => {
    expect(await lintTestFile("client/unary.test.ts", `
      import { TUNING_LIMIT } from "./limits";
      expect(TUNING_LIMIT).toBe(+10);
      expect(TUNING_LIMIT).toBe(-1n);
    `)).toHaveLength(2);
  });

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
  });

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
  });

  it("covers support files and skips production files", async () => {
    const pin = 'import { TUNING_LIMIT } from "./limits"; expect(TUNING_LIMIT).toBe(10);';
    for (const filename of ["tests/helpers/limit.ts", "testing/limit.ts", "client/limit.test-harness.ts", "client/limit-smoke-fixture.ts", "client/limit.pw.ts"]) {
      expect(await lintTestFile(filename, pin)).toHaveLength(1);
    }
    expect(noConstantPin.create({ filename: "tests/helpers/limit.ts" })).toHaveProperty("CallExpression");
    expect(await lintTestFile("client/retry.ts", pin)).toHaveLength(0);
    expect(await lintTestFile("tests/example.stories.tsx", pin)).toHaveLength(0);
  });
});
