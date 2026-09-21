import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const home = resolve(tmpdir(), `home-verify-cli-test-${crypto.randomUUID()}`);
Bun.spawnSync(["mkdir", "-p", home]);
const outsideOutput = resolve(home, "evidence");
const addressA = "0x1111111111111111111111111111111111111111";
const addressB = "0x2222222222222222222222222222222222222222";

afterAll(() => {
  Bun.spawnSync(["rm", "-rf", home]);
});

function run(args: string[], extraEnv: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, CI: undefined, GITHUB_ACTIONS: undefined, ...extraEnv };
  const result = Bun.spawnSync({
    cmd: ["bun", "apps/web/verify/cli.ts", ...args],
    cwd: repositoryRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

describe("live CLI preflight", () => {
  test("refuses CI before browser launch", () => {
    const result = run(["account-settings", "--live", "--base-url", "https://example.com", "--out", outsideOutput], { CI: "1" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("operator-only");
  });

  test("refuses output inside the repository before browser launch", () => {
    const result = run(["account-settings", "--live", "--base-url", "https://example.com", "--out", resolve(repositoryRoot, ".verify-test")]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("outside the repository");
  });

  test("refuses a missing max-usd before browser launch", () => {
    const result = run(["send", "--live", "--base-url", "https://example.com", "--out", outsideOutput, "--allow-confirm", "--account", addressA]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--max-usd");
  });

  test("refuses account intent that differs from the saved pin before browser launch", async () => {
    const stateDirectory = resolve(home, ".home-verify", "example.com", "state");
    Bun.spawnSync(["mkdir", "-p", stateDirectory]);
    await Bun.write(resolve(stateDirectory, "account"), `${addressA}\n`);
    await Bun.write(resolve(stateDirectory, "browser-state.json"), "{}\n");
    const result = run([
      "send",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
      "--allow-confirm",
      "--account",
      addressB,
      "--max-usd",
      "1",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not match the pinned test account");
  });
});
