import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readLedger } from "./ledger";
import { decideConfirmGate, enabledButtonPredicate, inputPresentPredicate, unexpectedNetworkHosts } from "./live";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const home = resolve(tmpdir(), `home-verify-cli-test-${crypto.randomUUID()}`);
Bun.spawnSync(["mkdir", "-p", home]);
const outsideOutput = resolve(home, "evidence");
const addressA = "0x1111111111111111111111111111111111111111";
const addressB = "0x2222222222222222222222222222222222222222";
const commentUrl = "https://github.com/fake-owner/home/issues/1#issuecomment-123";
const armHomes: string[] = [];
const stateDirectory = resolve(home, ".home-verify", "example.com", "state");
const statePath = resolve(stateDirectory, "browser-state.json");
const fakeBinDirectory = resolve(home, "fake-bin");
const fakeLogPath = resolve(home, "fake-agent-browser.log");

async function seedLiveState(address: string): Promise<void> {
  Bun.spawnSync(["mkdir", "-p", stateDirectory]);
  await Bun.write(resolve(stateDirectory, "account"), `${address}\n`);
  await Bun.write(statePath, "{}\n");
}

async function installFakeAgentBrowser(): Promise<void> {
  Bun.spawnSync(["mkdir", "-p", fakeBinDirectory]);
  const fakePath = resolve(import.meta.dir, "test-fixtures/fake-agent-browser.ts");
  const bunxPath = resolve(fakeBinDirectory, "bunx");
  await Bun.write(bunxPath, `#!/bin/sh\nexec '${process.execPath}' '${fakePath}' "$@"\n`);
  Bun.spawnSync(["chmod", "755", bunxPath]);
}

async function seedGmailCredentials(): Promise<string> {
  const path = resolve(home, "gmail.json");
  await Bun.write(path, `${JSON.stringify({ client_id: "client-id", client_secret: "client-secret", refresh_token: "refresh-token" })}\n`);
  Bun.spawnSync(["chmod", "600", path]);
  return path;
}

function fakeEnv(body: string, address: string): Record<string, string> {
  return {
    PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
    FAKE_AGENT_BROWSER_LOG: fakeLogPath,
    FAKE_AGENT_BROWSER_BODY: body,
    FAKE_AGENT_BROWSER_ADDRESS: address,
  };
}

function fakeCalls(): string[][] {
  const log = Bun.spawnSync(["cat", fakeLogPath], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  return log.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
}

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
printf '%s\n' "$*" >> "$FAKE_GH_LOG"
if [ "$1" = "api" ]; then
  printf '{"html_url":"%s","body":"%s","user":{"login":"%s"},"created_at":"%s"}' "$FAKE_COMMENT_URL" "$FAKE_COMMENT_BODY" "\${FAKE_COMMENT_LOGIN:-fake-owner}" "$FAKE_COMMENT_CREATED_AT"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '%s' "\${FAKE_GH_NAME_WITH_OWNER:-fake-owner/home}"
  exit 0
fi
exit 1
`);
  Bun.spawnSync(["chmod", "+x", gh]);
  armHomes.push(directory);
  return directory;
}

function runArm(homePath: string, extraEnv: Record<string, string | undefined> = {}, comment: { body?: string; created?: string; url?: string } = {}) {
  const by = comment.url ?? commentUrl;
  return run(["arm", "send", "--by", by], {
    HOME: homePath,
    FAKE_GH_LOG: resolve(homePath, "gh.log"),
    FAKE_COMMENT_URL: by,
    FAKE_COMMENT_BODY: comment.body ?? "/verify arm send",
    FAKE_COMMENT_CREATED_AT: comment.created ?? "2026-09-23T00:00:00.000Z",
    ...extraEnv,
  }, resolve(homePath, "bin"));
}

function fakeGhCalls(homePath: string): string[] {
  const log = Bun.spawnSync(["cat", resolve(homePath, "gh.log")], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  return log.trim().split("\n").filter(Boolean);
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

function clickCalls(): string[][] {
  return fakeCalls().filter((call) => call[0] === "find" && call[1] === "role" && call[2] === "button" && call[3] === "click");
}

function expectWaitBeforeEveryClick(): void {
  const calls = fakeCalls();
  for (const [index, call] of calls.entries()) {
    if (!(call[0] === "find" && call[1] === "role" && call[2] === "button" && call[3] === "click")) continue;
    const label = call[call.indexOf("--name") + 1];
    if (label === undefined) throw new Error("A click call is missing --name.");
    const wait = calls[index - 1];
    expect(wait?.[0]).toBe("wait");
    expect(wait?.[1]).toBe("--fn");
    expect(wait?.[2]).toBe(enabledButtonPredicate(label));
    expect(wait?.[2]).toContain(JSON.stringify(label));
  }
}

function latestRunArtifact(surfaceId: string, name: string): string {
  const runDirectory = resolve(outsideOutput, surfaceId);
  const listing = Bun.spawnSync(["ls", "-1", runDirectory], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  const newest = listing.trim().split("\n").filter(Boolean).sort().at(-1);
  expect(newest).toBeDefined();
  const artifact = Bun.spawnSync(["cat", resolve(runDirectory, newest ?? "", name)], { stdout: "pipe", stderr: "pipe" });
  expect(artifact.exitCode).toBe(0);
  return artifact.stdout.toString();
}

function liveJson(surfaceId: string): {
  expectedFailures: string[];
  unexpectedHosts: string[];
} {
  return JSON.parse(latestRunArtifact(surfaceId, "live.json")) as {
    expectedFailures: string[];
    unexpectedHosts: string[];
  };
}

function run(args: string[], extraEnv: Record<string, string | undefined> = {}, pathPrefix?: string, preload?: string) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, CI: undefined, GITHUB_ACTIONS: undefined, ...extraEnv };
  if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH ?? ""}`;
  const command = preload ? ["bun", "--preload", preload, "apps/web/verify/cli.ts", ...args] : ["bun", "apps/web/verify/cli.ts", ...args];
  const result = Bun.spawnSync({
    cmd: command,
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
    const entries = await readLedger(resolve(homePath, ".home-verify", "ledger.jsonl"));
    expect(entries.at(-1)).toMatchObject({ type: "arm", commentId: "123", createdAt: "2026-09-23T00:00:00.000Z" });
    const replay = runArm(homePath);
    expect(replay.exitCode).toBe(2);
    expect(replay.stderr).toContain("already re-armed");
  });

  test("queries the repository named by HOME_VERIFY_REPOSITORY", async () => {
    const homePath = await armHome();
    const result = runArm(homePath, { HOME_VERIFY_REPOSITORY: "other/example-home", FAKE_COMMENT_LOGIN: "other" }, { url: "https://github.com/other/example-home/issues/1#issuecomment-123" });
    expect(result.exitCode).toBe(0);
    expect(fakeGhCalls(homePath)).toContain("api repos/other/example-home/issues/comments/123");
  });

  test("queries the checkout's gh repository when HOME_VERIFY_REPOSITORY is unset", async () => {
    const homePath = await armHome();
    const result = runArm(homePath, { HOME_VERIFY_REPOSITORY: undefined, FAKE_GH_NAME_WITH_OWNER: "fake-owner/home" });
    expect(result.exitCode).toBe(0);
    expect(fakeGhCalls(homePath)).toContain("api repos/fake-owner/home/issues/comments/123");
  });

  test("refuses a --by comment URL from another repository", async () => {
    const homePath = await armHome();
    const result = runArm(homePath, { HOME_VERIFY_REPOSITORY: "other/example-home" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("other/example-home issue or pull-request comment URL");
    expect(fakeGhCalls(homePath).some((call) => call.startsWith("api "))).toBe(false);
  });

  test("accepts only the repository owner unless HOME_VERIFY_OPERATOR_LOGIN names the operator", async () => {
    const homePath = await armHome();
    const refused = runArm(homePath, { FAKE_COMMENT_LOGIN: "another-operator" });
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("Only a comment authored by fake-owner");
    const accepted = runArm(homePath, { FAKE_COMMENT_LOGIN: "another-operator", HOME_VERIFY_OPERATOR_LOGIN: "another-operator" });
    expect(accepted.exitCode).toBe(0);
  });
});

describe("live CLI preflight", () => {
  test("refuses live-login before browser launch when HOME_VERIFY_ACCOUNT_EMAIL is unset", () => {
    const result = run(["live-login", "--base-url", "https://example.com"], { HOME_VERIFY_ACCOUNT_EMAIL: undefined });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("HOME_VERIFY_ACCOUNT_EMAIL");
  });

  test("refuses gmail-auth when HOME_VERIFY_ACCOUNT_EMAIL is unset", () => {
    const result = run(["gmail-auth"], { HOME_VERIFY_ACCOUNT_EMAIL: undefined });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("HOME_VERIFY_ACCOUNT_EMAIL");
  });

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

  test("refuses --allow-console together with --allow-confirm", () => {
    const result = run([
      "send",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
      "--recipient",
      addressA,
      "--allow-console",
      "--allow-confirm",
      "--account",
      addressA,
      "--max-usd",
      "1",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--allow-console cannot be combined with --allow-confirm");
  });

  test("refuses a missing max-usd before browser launch", () => {
    const result = run(["send", "--live", "--base-url", "https://example.com", "--out", outsideOutput, "--recipient", addressB, "--allow-confirm", "--account", addressA]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--max-usd");
  });

  test("refuses account intent that differs from the saved pin before browser launch", async () => {
    await armSurface("send");
    await seedLiveState(addressA);
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

describe("live session state", () => {
  test("waits out a restoring session instead of declaring it expired", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run([
      "account-settings",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
    ], fakeEnv("Sign in to Home\nVerifying your session…", addressA));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("expired");
    const wait = fakeCalls().find((call) => call[0] === "wait" && call[1] === "--fn");
    expect(wait?.[2]).toContain("Show small balances");
    expect(wait?.[2]).toContain("Verifying your session");
    expect(wait?.[2]).toContain("Finishing sign-out");
    expect(wait?.[2]).toContain("Sign in to Home");
    expect(wait?.[2]).not.toContain("account=signin");
  });

  test("re-saves the live session after an authenticated run", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run([
      "account-settings",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
    ], fakeEnv("Account\nShow small balances\nYour money", addressA));
    expect(result.exitCode).toBe(0);
    const saves = fakeCalls().filter((call) => call[0] === "state" && call[1] === "save");
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.every((call) => call[2] === statePath)).toBe(true);
  });

  test("never re-saves a state that detected sign-out", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run([
      "account-settings",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
    ], fakeEnv("Sign in to Home", addressA));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("session expired");
    const saves = fakeCalls().filter((call) => call[0] === "state" && call[1] === "save");
    expect(saves).toEqual([]);
  });

  test("re-saves the live session at the end of an authenticated run whose expectations failed", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run([
      "home-panel",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
    ], {
      ...fakeEnv("Account\nShow small balances\nYour money", addressA),
      FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
      FAKE_AGENT_BROWSER_FAIL_EXPECT: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expectation was not observed");
    const calls = fakeCalls();
    expect(calls.at(-1)?.[0]).toBe("close");
    expect(calls.at(-2)?.slice(0, 3)).toEqual(["state", "save", statePath]);
    expect(calls.filter((call) => call[0] === "state" && call[1] === "save").length).toBeGreaterThanOrEqual(2);
  });
});

describe("click readiness", () => {
  test("waits for every click target to become enabled in fixture mode", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["send", "--out", outsideOutput], {
      PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
      FAKE_AGENT_BROWSER_LOG: fakeLogPath,
      FAKE_AGENT_BROWSER_BODY: "Send",
    });
    expect(result.stderr).not.toContain("still disabled");
    expect(clickCalls().length).toBeGreaterThan(0);
    expectWaitBeforeEveryClick();
  });

  test("waits for every click target to become enabled in live mode", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["save", "--live", "--base-url", "https://example.com", "--out", outsideOutput], {
      ...fakeEnv("Account\nShow small balances\nYour money", addressA),
      FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
    });
    expect(result.exitCode).toBe(0);
    expect(clickCalls().map((call) => call[call.indexOf("--name") + 1])).toEqual(["1", "Continue"]);
    expectWaitBeforeEveryClick();
  });

  test("fails a click step whose target never becomes enabled", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["send", "--out", outsideOutput], {
      PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
      FAKE_AGENT_BROWSER_LOG: fakeLogPath,
      FAKE_AGENT_BROWSER_FAIL_WAIT: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("still disabled");
    expect(result.stderr).toContain("Send");
    expect(clickCalls()).toEqual([]);
  });
});

describe("live login readiness", () => {
  const preloadPath = resolve(import.meta.dir, "test-fixtures/fake-gmail-fetch.ts");

  function runLiveLogin(extraEnv: Record<string, string | undefined>) {
    return run(["live-login", "--base-url", "https://example.com"], {
      PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
      FAKE_AGENT_BROWSER_LOG: fakeLogPath,
      FAKE_AGENT_BROWSER_ADDRESS: addressA,
      FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
      HOME_VERIFY_ACCOUNT_EMAIL: "bot@example.com",
      ...extraEnv,
    }, undefined, preloadPath);
  }

  test("waits for the sign-in sheet and the code entry before filling them", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const gmailPath = await seedGmailCredentials();
    const result = runLiveLogin({ HOME_VERIFY_GMAIL_CREDENTIALS: gmailPath });
    expect(result.exitCode).toBe(0);
    const calls = fakeCalls();
    const emailWait = calls.findIndex((call) => call[0] === "wait" && call[1] === "--fn" && call[2] === inputPresentPredicate("Email address"));
    expect(emailWait).toBeGreaterThan(-1);
    expect(calls[emailWait + 1]).toEqual(["find", "label", "Email address", "fill", "bot@example.com", "--exact", "--json"]);
    const codeWait = calls.findIndex((call) => call[0] === "wait" && call[1] === "--fn" && call[2] === inputPresentPredicate("Verification code"));
    expect(codeWait).toBeGreaterThan(emailWait);
    expect(calls[codeWait + 1]).toEqual(["eval", "--stdin", "--json"]);
  });

  test("fails the sign-in sheet wait before filling the email", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = runLiveLogin({ FAKE_AGENT_BROWSER_FAIL_WAIT: "1" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The sign-in sheet did not render");
    expect(fakeCalls().some((call) => call[0] === "find" && call[1] === "label" && call[2] === "Email address" && call[3] === "fill")).toBe(false);
  });
});

describe("live expected failures", () => {
  test("keeps a declared request failure out of the failing set", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run([
      "account-settings",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
    ], {
      ...fakeEnv("Account\nShow small balances\nYour money", addressA),
      FAKE_AGENT_BROWSER_FAILURES: JSON.stringify([
        { method: "GET", url: "https://example.com/api/session?cache=0", status: 401 },
      ]),
    });
    expect(result.exitCode).toBe(0);
    const expectedFailures = liveJson("account-settings").expectedFailures;
    expect(expectedFailures).toHaveLength(1);
    expect(expectedFailures[0]).toContain("GET https://example.com/api/session?cache=0 (401) — ");
    expect(expectedFailures[0]).toMatch(/#\d+/);
    const summary = latestRunArtifact("account-settings", "summary.md");
    expect(summary).toContain("Expected failures: 1");
    expect(summary).toContain("GET https://example.com/api/session?cache=0 (401)");
  });

  test("still fails an undeclared request failure", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run([
      "account-settings",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
    ], {
      ...fakeEnv("Account\nShow small balances\nYour money", addressA),
      FAKE_AGENT_BROWSER_FAILURES: JSON.stringify([
        { method: "GET", url: "https://example.com/api/balances", status: 500 },
      ]),
    });
    expect(result.exitCode).toBe(1);
    expect(liveJson("account-settings").expectedFailures).toEqual([]);
    expect(latestRunArtifact("account-settings", "summary.md")).toContain("Failed requests: 1");
  });
});
