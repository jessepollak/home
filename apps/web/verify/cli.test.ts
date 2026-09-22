import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readLedger } from "./ledger";
import { decideConfirmGate, enabledButtonPredicate, unexpectedNetworkHosts } from "./live";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const home = resolve(tmpdir(), `home-verify-cli-test-${crypto.randomUUID()}`);
Bun.spawnSync(["mkdir", "-p", home]);
const outsideOutput = resolve(home, "evidence");
const addressA = "0x1111111111111111111111111111111111111111";
const addressB = "0x2222222222222222222222222222222222222222";
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
});

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

function run(args: string[], extraEnv: Record<string, string | undefined> = {}, pathPrefix?: string) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, CI: undefined, GITHUB_ACTIONS: undefined, ...extraEnv };
  if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH ?? ""}`;
  const result = Bun.spawnSync({
    cmd: ["bun", "apps/web/verify/cli.ts", ...args],
    cwd: repositoryRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("verify status", () => {
  test("labels every surface by rung and reports spend, caps, and recent incidents", async () => {
    const statusHome = resolve(tmpdir(), `home-verify-status-${crypto.randomUUID()}`);
    Bun.spawnSync(["mkdir", "-p", resolve(statusHome, ".home-verify")]);
    try {
      await Bun.write(resolve(statusHome, ".home-verify", "ledger.jsonl"), `${JSON.stringify({
        type: "run",
        timestamp: "2026-09-23T00:00:00.000Z",
        runId: "run-1",
        host: "example.com",
        surface: "send",
        role: "factory",
        mainRevision: "abc123",
        rungReached: 2,
        amountsUsd: [],
        incidents: ["unexpected-host"],
        clean: false,
      })}\n`);
      const result = run(["status", "--base-url", "https://example.com"], { HOME: statusHome });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("send @ example.com: confirm-bounded (rung 3 under caps)");
      expect(result.stdout).toContain("save @ example.com: confirm-bounded (rung 3 under caps)");
      expect(result.stdout).toContain("borrow @ example.com: confirm-bounded (rung 3 under caps)");
      expect(result.stdout).toContain("landing @ example.com: read-only (rung 1)");
      expect(result.stdout).toContain("cash-out @ example.com: review-bounded (rung 2)");
      expect(result.stdout).toContain("caps: $1.00 click; $2.00 run; $5.00 day");
      expect(result.stdout).toContain("recent incidents:");
      expect(result.stdout).toContain("send @ example.com: unexpected-host");
      expect(result.stdout).not.toContain("disarmed");
    } finally {
      Bun.spawnSync(["rm", "-rf", statusHome]);
    }
  });
});

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

describe("live CLI confirmation bounds", () => {
  const confirmArgs = [
    "save",
    "--live",
    "--base-url",
    "https://example.com",
    "--out",
    outsideOutput,
    "--allow-confirm",
    "--account",
    addressA,
    "--max-usd",
    "1",
  ];

  async function confirmEnv(address: string, failures?: unknown[]): Promise<Record<string, string>> {
    await seedLiveState(address);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    return {
      ...fakeEnv("Account\nShow small balances\nYour money", address),
      FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
      FAKE_AGENT_BROWSER_BALANCE: "$26.89",
      FAKE_AGENT_BROWSER_REVIEW: "Deposit\n$1.00",
      ...(failures ? { FAKE_AGENT_BROWSER_FAILURES: JSON.stringify(failures) } : {}),
    };
  }

  test("proceeds to a capped confirmation with no prior clean runs", async () => {
    const env = await confirmEnv(addressA);
    Bun.spawnSync(["rm", "-rf", resolve(home, ".home-verify", "ledger.jsonl")]);
    const result = run(confirmArgs, env);
    expect(result.stderr).not.toContain("disarmed");
    expect(result.stderr).not.toContain("clean current-main");
    expect(result.exitCode).toBe(0);
  });

  test("records an incident without gating a later confirmation", async () => {
    const incidentEnv = await confirmEnv(addressA, [
      { method: "GET", url: "https://unexpected.example.net/probe", status: 500 },
    ]);
    const incident = run(confirmArgs, incidentEnv);
    expect(incident.exitCode).toBe(1);
    const entries = await readLedger(resolve(home, ".home-verify", "ledger.jsonl"));
    const recorded = entries.find((entry) => entry.incidents.includes("unexpected-host"));
    expect(recorded?.surface).toBe("save");

    const followUpEnv = await confirmEnv(addressA);
    const followUp = run(confirmArgs, followUpEnv);
    expect(followUp.stderr).not.toContain("disarmed");
    expect(followUp.exitCode).toBe(0);
  });
});
