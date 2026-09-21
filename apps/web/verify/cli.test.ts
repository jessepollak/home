import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { decideConfirmGate, unexpectedNetworkHosts } from "./live";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const home = resolve(tmpdir(), `home-verify-cli-test-${crypto.randomUUID()}`);
Bun.spawnSync(["mkdir", "-p", home]);
const outsideOutput = resolve(home, "evidence");
const addressA = "0x1111111111111111111111111111111111111111";
const addressB = "0x2222222222222222222222222222222222222222";
const commentUrl = "https://github.com/jessepollak/home/issues/1#issuecomment-123";
const armHomes: string[] = [];

afterAll(() => {
  Bun.spawnSync(["rm", "-rf", home]);
  for (const path of armHomes.splice(0)) Bun.spawnSync(["rm", "-rf", path]);
});

async function armHome(entries: unknown[] = []) {
  const directory = resolve(tmpdir(), `home-verify-arm-${crypto.randomUUID()}`);
  const binDirectory = resolve(directory, "bin");
  Bun.spawnSync(["mkdir", "-p", resolve(directory, ".home-verify"), binDirectory]);
  if (entries.length > 0) {
    await Bun.write(resolve(directory, ".home-verify", "ledger.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  }
  const gh = resolve(binDirectory, "gh");
  await Bun.write(gh, `#!/bin/sh
if [ "$1" = "api" ]; then
  printf '{"html_url":"%s","body":"%s","user":{"login":"jessepollak"},"created_at":"%s"}' "$FAKE_COMMENT_URL" "$FAKE_COMMENT_BODY" "$FAKE_COMMENT_CREATED_AT"
  exit 0
fi
exit 1
`);
  Bun.spawnSync(["chmod", "+x", gh]);
  armHomes.push(directory);
  return directory;
}

function runArm(homePath: string, extraEnv: Record<string, string | undefined> = {}, comment: { body?: string; created?: string } = {}) {
  return run(["arm", "send", "--by", commentUrl], {
    HOME: homePath,
    PATH: `${resolve(homePath, "bin")}:${process.env.PATH}`,
    FAKE_COMMENT_URL: commentUrl,
    FAKE_COMMENT_BODY: comment.body ?? "/verify arm send",
    FAKE_COMMENT_CREATED_AT: comment.created ?? "2026-09-23T00:00:00.000Z",
    ...extraEnv,
  });
}

async function armSurface(surface: string) {
  const directory = resolve(home, ".home-verify");
  Bun.spawnSync(["mkdir", "-p", directory]);
  await Bun.write(resolve(directory, "ledger.jsonl"), `${JSON.stringify({
    type: "arm",
    timestamp: new Date().toISOString(),
    surface,
    by: "https://github.com/jessepollak/home/issues/1#issuecomment-1",
  })}\n`);
}

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

describe("live CLI policy", () => {
  test("stops an unknown control after review", () => {
    expect(decideConfirmGate("confirm", "Unknown action", false, false, true).action).toBe("stop");
  });

  test("fails host observation outside the configured set", () => {
    expect(unexpectedNetworkHosts(
      ["https://example.com/home", "https://unexpected.example.net/image.png"],
      ["example.com"],
    )).toEqual(["unexpected.example.net"]);
  });
});

describe("live CLI re-arm", () => {
  test("refuses the factory role", async () => {
    const homePath = await armHome();
    const result = runArm(homePath, { HOME_VERIFY_ROLE: "factory" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("operator role");
  });

  test("refuses a comment id that is already recorded", async () => {
    const homePath = await armHome([{
      type: "arm",
      timestamp: "2026-09-22T00:00:00.000Z",
      surface: "send",
      by: commentUrl,
      commentId: "123",
      createdAt: "2026-09-22T00:00:00.000Z",
    }]);
    const result = runArm(homePath, {}, { created: "2026-09-23T00:00:00.000Z" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("already re-armed");
  });

  test("refuses a comment that predates the latest disarm", async () => {
    const homePath = await armHome([{
      type: "disarm",
      timestamp: "2026-09-25T00:00:00.000Z",
      surface: "send",
      incidents: ["ambiguous-result"],
      runId: "run-9",
    }]);
    const result = runArm(homePath, {}, { created: "2026-09-24T00:00:00.000Z" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("predates");
  });

  test("records the comment id and creation time, then refuses the replay", async () => {
    const homePath = await armHome();
    const first = runArm(homePath);
    expect(first.exitCode).toBe(0);
    const lines = (await Bun.file(resolve(homePath, ".home-verify", "ledger.jsonl")).text()).trim().split("\n");
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({ type: "arm", commentId: "123", createdAt: "2026-09-23T00:00:00.000Z" });
    const replay = runArm(homePath);
    expect(replay.exitCode).toBe(2);
    expect(replay.stderr).toContain("already re-armed");
  });
});

describe("live CLI preflight", () => {
  test("refuses CI before browser launch", () => {
    const result = run(["account-settings", "--live", "--base-url", "https://example.com", "--out", outsideOutput], { CI: "1" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cannot run in CI");
  });

  test("refuses output inside the repository before browser launch", () => {
    const result = run(["account-settings", "--live", "--base-url", "https://example.com", "--out", resolve(repositoryRoot, ".verify-test")]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("outside the repository");
  });

  test("defaults the live send recipient before browser launch when --recipient is absent", () => {
    const result = run(["send", "--live", "--base-url", "https://example.com", "--out", outsideOutput]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("No saved live session");
    expect(result.stderr).not.toContain("--recipient");
  });

  test("accepts the pinned name and refuses every other recipient before browser launch", () => {
    const named = run(["send", "--live", "--base-url", "https://example.com", "--out", outsideOutput, "--recipient", "jesse.base.eth"]);
    expect(named.exitCode).toBe(2);
    expect(named.stderr).toContain("No saved live session");
    const refused = run(["send", "--live", "--base-url", "https://example.com", "--out", outsideOutput, "--recipient", "jesse"]);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("--recipient must be a bare 0x address or jesse.base.eth");
  });

  test("refuses the zero address before browser launch", () => {
    const result = run(["send", "--live", "--base-url", "https://example.com", "--out", outsideOutput, "--recipient", "0x0000000000000000000000000000000000000000"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("zero address");
  });

  test("refuses a missing max-usd before browser launch", () => {
    const result = run(["send", "--live", "--base-url", "https://example.com", "--out", outsideOutput, "--recipient", addressB, "--allow-confirm", "--account", addressA]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--max-usd");
  });

  test("refuses account intent that differs from the saved pin before browser launch", async () => {
    await armSurface("send");
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
      "--recipient",
      addressA,
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
