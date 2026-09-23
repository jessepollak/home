import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readLedger } from "./ledger";
import { encodeFunctionData, erc20Abi } from "viem";
import { BASE_USDC } from "../shared/assets/base";
import {
  buttonPresentPredicate,
  decideConfirmGate,
  enabledButtonPredicate,
  inputPresentPredicate,
  recipientFillValue,
  unexpectedNetworkHosts,
} from "./live";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const home = resolve(tmpdir(), `home-verify-cli-test-${crypto.randomUUID()}`);
Bun.spawnSync(["mkdir", "-p", home]);
const outsideOutput = resolve(home, "evidence");
const addressA = "0x1111111111111111111111111111111111111111";
const addressB = "0x2222222222222222222222222222222222222222";
const pinnedRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";
const stateDirectory = resolve(home, ".home-verify", "example.com", "state");
const statePath = resolve(stateDirectory, "browser-state.json");
const fakeBinDirectory = resolve(home, "fake-bin");
const fakeLogPath = resolve(home, "fake-agent-browser.log");
const actionId = "11111111-1111-4111-8111-111111111111";
function preparedEnv(kind: string, label: string, extra: Record<string, unknown> = {}): Record<string, string> {
  const spend = kind === "send" || kind === "cash-out" || kind === "savings-deposit" || kind === "repay";
  const action = {
    id: actionId, kind, owner: { address: addressA, subject: "fixture", chainId: 8453, accountProvider: "cdp-embedded" },
    expiresAt: "2099-01-01T00:00:00.000Z",
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000", direction: spend ? "spend" : "receive" },
      ...(kind.startsWith("savings-") ? [{ assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "100000000000000000", direction: spend ? "receive" : "spend" }] : [])],
    calls: [{ to: BASE_USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [pinnedRecipient, BigInt(100000)] }), value: "0" }],
    ...(kind === "cash-out" ? { metadata: { product: "cashout", operation: "deposit", canonicalHandle: "zzpayout" } } : {}),
    ...(kind === "cash-out-withdraw" ? { metadata: { product: "cashout", operation: "withdraw" } } : {}),
    ...extra,
  };
  return {
    FAKE_AGENT_BROWSER_CONTROLS: JSON.stringify([{ id: actionId, name: label }]),
    FAKE_AGENT_BROWSER_HAR: JSON.stringify({ log: { entries: [{ request: { method: "POST", url: "https://example.com/api/actions/prepare" }, response: { status: 201, content: { text: JSON.stringify(action) } } }] } }),
  };
}

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
    const present = calls[index - 2];
    expect(present?.slice(0, 3)).toEqual(["wait", "--fn", buttonPresentPredicate(label)]);
    expect(present?.slice(3, 5)).toEqual(["--timeout", "30000"]);
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

function sendLiveJson(): { stoppedBefore: string | null; confirmIntent: unknown } {
  return JSON.parse(latestRunArtifact("send", "live.json")) as { stoppedBefore: string | null; confirmIntent: unknown };
}

function recipientFills(): string[][] {
  return fakeCalls().filter((call) => call[0] === "find" && call[1] === "label" && call[2] === "To");
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
      expect(result.stdout).toContain("cash-out @ example.com: confirm-bounded (rung 3 under caps)");
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

  test("fills a name recipient from the pinned name and reviews its pinned address", () => {
    expect(recipientFillValue({ name: "jesse.base.eth", address: pinnedRecipient })).toBe("jesse.base.eth");
    expect(recipientFillValue({ name: null, address: addressB })).toBe(addressB);
    expect(recipientFillValue(null)).toBeNull();
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

describe("live cash-out handle", () => {
  test("fills the payout handle from HOME_VERIFY_CASHOUT_HANDLE in live mode", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["cash-out", "--live", "--base-url", "https://example.com", "--out", outsideOutput], {
      ...fakeEnv("Account\nShow small balances\nYour money", addressA),
      HOME_VERIFY_CASHOUT_HANDLE: "$example",
    });
    expect(result.exitCode).toBe(0);
    const handleFills = fakeCalls().filter((call) =>
      call[0] === "find" && call[1] === "label" && call[3] === "fill" && (call[2] === "Cash App handle" || call[2] === "Re-enter handle"));
    expect(handleFills.map((call) => call[4])).toEqual(["$example", "example"]);
    expect(fakeCalls().some((call) => call.includes("$alice"))).toBe(false);
  });

  test("redacts the payout handle from text evidence", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["cash-out", "--live", "--base-url", "https://example.com", "--out", outsideOutput], {
      ...fakeEnv("Account\nShow small balances\nConfirm the payout handle exactly: zzpayout\nPayout handle $zzpayout", addressA),
      HOME_VERIFY_CASHOUT_HANDLE: "$zzpayout",
    });
    expect(result.exitCode).toBe(0);
    const dom = latestRunArtifact("cash-out", "dom.txt");
    expect(dom).not.toContain("zzpayout");
    expect(dom).toContain("Confirm the payout handle exactly: <payout-handle>");
  });

  test("refuses a live run without HOME_VERIFY_CASHOUT_HANDLE before any fill", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["cash-out", "--live", "--base-url", "https://example.com", "--out", outsideOutput], {
      ...fakeEnv("Account\nShow small balances\nYour money", addressA),
      HOME_VERIFY_CASHOUT_HANDLE: undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HOME_VERIFY_CASHOUT_HANDLE");
    expect(fakeCalls().some((call) => call[3] === "fill")).toBe(false);
  });
});

describe("live cash-out confirmation and recovery", () => {
  const depositReview = (handle: string) => `Confirm\n$0.10\nProvider\nPeer\nPayout app\nCash App\nPayout handle\n${handle}\nNetwork\nBase`;
  const cashoutArgs = [
    "cash-out",
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

  async function cashoutEnv(extra: Record<string, string | undefined>) {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    return {
      ...fakeEnv("Account\nShow small balances\nCashed out $0.10\nRecovered $0.10", addressA),
      FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
      FAKE_AGENT_BROWSER_BALANCE: "$26.89",
      HOME_VERIFY_CASHOUT_HANDLE: "$zzpayout",
      ...preparedEnv("cash-out", "Cash out $0.10"),
      ...extra,
    };
  }

  test("confirms the deposit when the review shows the canonical payout handle", async () => {
    const env = await cashoutEnv({ FAKE_AGENT_BROWSER_REVIEW: depositReview("zzpayout") });
    const result = run([...cashoutArgs, "--canary-operation", "cash-out"], env);
    expect(result.exitCode).toBe(0);
    expect(fakeCalls()).toContainEqual(["click", `[data-money-action-id="${actionId}"]`, "--json"]);
    const live = latestRunArtifact("cash-out", "live.json");
    expect(live).toContain("<payout-handle>");
    expect(live).not.toContain("zzpayout");
    expect(live).toContain('"label": "Cash out $0.10"');
  });

  test("refuses the deposit before the click when the prepared payout handle differs", async () => {
    const env = await cashoutEnv(preparedEnv("cash-out", "Cash out $0.10", { metadata: { product: "cashout", operation: "deposit", canonicalHandle: "otherpayout" } }));
    const result = run([...cashoutArgs, "--canary-operation", "cash-out"], env);
    expect(result.exitCode).toBe(1);
    expect(clickCalls().map((call) => call[call.indexOf("--name") + 1])).not.toContain("Cash out $0.10");
    expect(latestRunArtifact("cash-out", "evidence.json")).toContain("prepared payout handle does not match");
  });

  test("ends the withdrawal recovery with a note when nothing is in flight", async () => {
    const env = await cashoutEnv({ FAKE_AGENT_BROWSER_PREFIX_NAMES: "[]" });
    const result = run([...cashoutArgs, "--canary-operation", "withdraw"], env);
    expect(result.exitCode).toBe(0);
    expect(clickCalls().map((call) => call[call.indexOf("--name") + 1])).toEqual(["Send", "Decimal point", "1", "Continue"]);
    expect(latestRunArtifact("cash-out", "live.json")).toContain('"note": "No in-flight Peer cash-out to withdraw."');
    expect(latestRunArtifact("cash-out", "summary.md")).toContain("No in-flight Peer cash-out to withdraw.");
    const entries = await readLedger(resolve(home, ".home-verify", "ledger.jsonl"));
    const recorded = entries.filter((entry) => entry.surface === "cash-out").at(-1);
    expect(recorded?.rungReached).toBe(2);
  });

  const recoveryRowName = "Withdraw $0.10 Peer cash-out · awaiting-buyer";

  test("recovers an in-flight cash-out by resolving both prefix controls", async () => {
    const env = await cashoutEnv({
      FAKE_AGENT_BROWSER_PREFIX_NAMES: JSON.stringify({ "Withdraw ": [recoveryRowName], "Withdraw $": ["Withdraw $0.10"] }),
      ...preparedEnv("cash-out-withdraw", "Withdraw $0.10"),
    });
    const result = run([...cashoutArgs, "--canary-operation", "withdraw"], env);
    expect(result.exitCode).toBe(0);
    expect(clickCalls().map((call) => call[call.indexOf("--name") + 1])).toEqual(["Send", "Decimal point", "1", "Continue", recoveryRowName]);
    expect(fakeCalls()).toContainEqual(["click", `[data-money-action-id="${actionId}"]`, "--json"]);
    expect(latestRunArtifact("cash-out", "live.json")).toContain('"label": "Withdraw $0.10"');
  });

  test("refuses a prefix that matches more than one visible control", async () => {
    const env = await cashoutEnv({
      FAKE_AGENT_BROWSER_PREFIX_NAMES: JSON.stringify([recoveryRowName, "Withdraw $0.20 Peer cash-out · matched"]),
    });
    const result = run([...cashoutArgs, "--canary-operation", "withdraw"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("click-prefix “Withdraw ”");
    expect(result.stderr).toContain(`${recoveryRowName}; Withdraw $0.20 Peer cash-out · matched`);
    expect(clickCalls().map((call) => call[call.indexOf("--name") + 1])).toEqual(["Send", "Decimal point", "1", "Continue"]);
  });
});

describe("live rendered balance", () => {
  function runConfirm(extraEnv: Record<string, string>) {
    return run([
      "send", "--live", "--base-url", "https://example.com", "--out", outsideOutput,
      "--recipient", addressB, "--allow-confirm", "--account", addressA, "--max-usd", "1",
    ], { ...fakeEnv("Home\nTotal balance\n$36.83\nCash\n$21.29\nInvestments\n$15.54\nShow small balances", addressA), ...extraEnv });
  }

  test("reads the hero ticker rather than every amount in the balance card", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = runConfirm({ FAKE_AGENT_BROWSER_BALANCE: "$36.83" });
    expect(result.stderr).not.toContain("not knowable");
    const balanceRead = fakeCalls().find((call) => call[0] === "eval" && call[1]?.includes("Total balance") && !call[1].startsWith("Boolean("));
    expect(balanceRead?.[1]).toContain('[data-slot="money-ticker"]');
    expect(balanceRead?.[1]).toContain("aria-label");
    const calls = fakeCalls();
    const balanceIndex = calls.findIndex((call) => call[0] === "eval" && call[1]?.includes('[data-slot="money-ticker"]'));
    const nextNavigate = calls.findIndex((call, index) => index > balanceIndex && call[0] === "navigate");
    const settled = calls.slice(balanceIndex + 1, nextNavigate).find((call) => call[0] === "wait" && call[1] === "--load");
    expect(settled).toEqual(["wait", "--load", "networkidle", "--timeout", "30000", "--json"]);
    expect(calls.some((call) => call[0] === "eval" && call[1]?.includes('[role="dialog"]'))).toBe(false);
    expect(calls.some((call) => call[0] === "network" && call[1] === "har" && call[2] === "start")).toBe(true);
  });

  test("refuses confirmation when the hero ticker is absent", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = runConfirm({});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The rendered account balance is not knowable; confirmation was refused.");
  });
});

describe("live anonymous surfaces", () => {
  test("runs an anonymous surface without the saved session and clears the access gate after goto", async () => {
    Bun.spawnSync(["rm", "-rf", stateDirectory]);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["coverage", "--live", "--base-url", "https://example.com", "--out", outsideOutput], {
      ...fakeEnv("Local money coverage\nSign in", ""),
      FAKE_AGENT_BROWSER_PATH: "/coverage",
    });
    expect(result.stderr).toContain("[live] ");
    expect(result.stderr).toContain(" goto /coverage");
    expect(result.stderr).not.toContain("expired");
    expect(result.exitCode).toBe(0);
    const calls = fakeCalls();
    expect(calls.some((call) => call[0] === "state")).toBe(false);
    const firstNavigate = calls.findIndex((call) => call[0] === "navigate");
    expect(calls[firstNavigate]?.[1]).toBe("https://example.com/coverage");
    expect(calls[firstNavigate + 1]?.slice(0, 2)).toEqual(["eval", "location.pathname + location.search"]);
    expect(calls.some((call) => call[0] === "wait" && call[1] === "--text" && call[2] === "Local money coverage")).toBe(true);
  });

  test("captures the DOM and a screenshot when a live step fails", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["coverage", "--live", "--base-url", "https://example.com", "--out", outsideOutput], {
      ...fakeEnv("Something else entirely", ""),
      FAKE_AGENT_BROWSER_PATH: "/coverage",
      FAKE_AGENT_BROWSER_FAIL_EXPECT: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(latestRunArtifact("coverage", "dom.txt")).toContain("Something else entirely");
    expect(fakeCalls().some((call) => call[0] === "screenshot")).toBe(true);
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

describe("live send recipient resolution", () => {
  test("fills the pinned name and rejects a prepared transfer to another recipient", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const body = [
      "Account",
      "Show small balances",
      "Confirm",
      "$0.10",
      "You're sending USDC",
      "To",
      pinnedRecipient,
      "Asset",
      "USDC",
      "Network",
      "Base",
      "Send $0.10",
    ].join("\n");

    const result = run([
      "send",
      "--live",
      "--base-url",
      "https://example.com",
      "--out",
      outsideOutput,
      "--recipient",
      "jesse.base.eth",
      "--allow-confirm",
      "--account",
      addressA,
      "--max-usd",
      "1",
    ], {
      ...fakeEnv(body, addressA),
      FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
      FAKE_AGENT_BROWSER_BALANCE: "$26.89",
      ...preparedEnv("send", "Send $0.10", { calls: [{ to: BASE_USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [addressB, BigInt(100000)] }), value: "0" }] }),
    });

    expect(recipientFills().map((call) => call.slice(0, 6)))
      .toEqual([["find", "label", "To", "fill", "jesse.base.eth", "--exact"]]);
    expect(result.exitCode).toBe(1);
    const live = sendLiveJson();
    expect(latestRunArtifact("send", "evidence.json")).toContain("prepared recipient does not match the pinned recipient");
    expect(live.stoppedBefore).toBe("Send $0.10");
    expect(live.confirmIntent).toBeNull();
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
    expect(clickCalls().map((call) => call[call.indexOf("--name") + 1])).toEqual(["Decimal point", "1", "Continue"]);
    expectWaitBeforeEveryClick();
  });

  test("fails a click step whose target never becomes enabled", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["send", "--out", outsideOutput], {
      PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
      FAKE_AGENT_BROWSER_LOG: fakeLogPath,
      FAKE_AGENT_BROWSER_FAIL_WAIT: "enabled",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("still disabled");
    expect(result.stderr).toContain("Send");
    expect(clickCalls()).toEqual([]);
  });

  test("fails a click step whose target never renders without waiting out the enabled budget", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const result = run(["send", "--out", outsideOutput], {
      PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
      FAKE_AGENT_BROWSER_LOG: fakeLogPath,
      FAKE_AGENT_BROWSER_FAIL_WAIT: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The button “Send” did not render within 30 seconds");
    expect(result.stderr).not.toContain("still disabled");
    expect(fakeCalls().some((call) => call[0] === "wait" && call[2] === enabledButtonPredicate("Send"))).toBe(false);
    expect(clickCalls()).toEqual([]);
  });
});

async function readUntil(stream: ReadableStream<Uint8Array>, needle: string, timeoutMs = 10000): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (!buffer.includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${needle}`);
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  return buffer;
}

describe("gmail-auth remote flow", () => {
  test("prints the authorization URL, ignores a stray request, and rejects only a wrong state", async () => {
    const credentialsPath = resolve(home, "gmail-bootstrap.json");
    await Bun.write(credentialsPath, `${JSON.stringify({ client_id: "client-id", client_secret: "client-secret" })}\n`);
    Bun.spawnSync(["chmod", "600", credentialsPath]);
    const process_ = Bun.spawn({
      cmd: ["bun", "apps/web/verify/cli.ts", "gmail-auth", "--no-open"],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        HOME: home,
        CI: undefined,
        GITHUB_ACTIONS: undefined,
        HOME_VERIFY_ACCOUNT_EMAIL: "bot@example.com",
        HOME_VERIFY_GMAIL_CREDENTIALS: credentialsPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await readUntil(process_.stdout, "Open this URL to authorize: ");
    const match = output.match(/Open this URL to authorize: (\S+)/);
    expect(match).not.toBeNull();
    const authorization = new URL(match?.[1] ?? "https://invalid.example");
    expect(authorization.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    const redirectUri = new URL(authorization.searchParams.get("redirect_uri") ?? "https://invalid.example");
    expect(redirectUri.hostname).toBe("127.0.0.1");
    const probe = await fetch(`http://127.0.0.1:${redirectUri.port}/probe`);
    expect(probe.status).toBe(404);
    const wrongState = await fetch(`http://127.0.0.1:${redirectUri.port}/callback?state=wrong&code=abc`);
    expect(wrongState.status).toBe(400);
    expect(await process_.exited).toBe(1);
    expect(await new Response(process_.stderr).text()).toContain("Gmail OAuth state mismatch");
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

  test("waits for the access gate password field before filling it", async () => {
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const gmailPath = await seedGmailCredentials();
    const result = runLiveLogin({
      HOME_VERIFY_GMAIL_CREDENTIALS: gmailPath,
      HOME_ACCESS_PASSWORD: "fake-access-password",
      FAKE_AGENT_BROWSER_PATH: "/access?next=%2F%3Faccount%3Dsignin",
    });
    expect(result.exitCode).toBe(0);
    const calls = fakeCalls();
    const gateWait = calls.findIndex((call) => call[0] === "wait" && call[1] === "--fn" && call[2] === inputPresentPredicate("Access password"));
    expect(gateWait).toBeGreaterThan(-1);
    expect(calls[gateWait + 1]).toEqual(["eval", "--stdin", "--json"]);
    expect(calls.findIndex((call) => call[0] === "eval" && call[1] === "--stdin")).toBe(gateWait + 1);
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

describe("agent-driven session commands", () => {
  test("starts, snapshots, navigates, and finishes a policy-bound session", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const env = { ...fakeEnv("Account\nShow small balances", addressA), FAKE_AGENT_BROWSER_AUTHENTICATED: "1" };
    const start = run(["start", "account-settings", "--live", "--base-url", "https://example.com", "--out", outsideOutput], env);
    expect(start.exitCode).toBe(0);
    expect(run(["snapshot"], env).exitCode).toBe(0);
    expect(run(["goto", "/home"], env).exitCode).toBe(0);
    const finish = run(["finish"], env);
    expect(finish.exitCode).toBe(0);
    expect(finish.stdout).toContain("summary.md");
    expect(fakeCalls().some((call) => call[0] === "close")).toBe(true);
  });

  test("confirms only a pinned prepared action and records its spend", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const env = { ...fakeEnv("Account\nShow small balances", addressA), FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
      FAKE_AGENT_BROWSER_BALANCE: "$26.89", FAKE_AGENT_BROWSER_MARKS: JSON.stringify(["shell:paint", "session:verified", "balances:painted", "action:first-interactive"].map((name) => ({ name, startTime: 100 }))),
      ...preparedEnv("send", "Send $0.10") };
    expect(run(["start", "send", "--live", "--base-url", "https://example.com", "--out", outsideOutput,
      "--allow-confirm", "--account", addressA, "--max-usd", "1"], env).exitCode).toBe(0);
    const result = run(["confirm"], env);
    expect(result.exitCode).toBe(0);
    expect(fakeCalls()).toContainEqual(["click", `[data-money-action-id="${actionId}"]`, "--json"]);
    expect(run(["finish"], env).exitCode).toBe(0);
    const entries = await readLedger(resolve(home, ".home-verify", "ledger.jsonl"));
    expect(entries.some((entry) => entry.surface === "send" && entry.amountsUsd.includes(0.1))).toBe(true);
  });

  test("a plain click refuses an identified money control", async () => {
    await seedLiveState(addressA);
    await installFakeAgentBrowser();
    await Bun.write(fakeLogPath, "");
    const env = { ...fakeEnv("Account\nShow small balances", addressA), FAKE_AGENT_BROWSER_AUTHENTICATED: "1",
      FAKE_AGENT_BROWSER_BALANCE: "$26.89", ...preparedEnv("send", "Send $0.10") };
    const start = run(["start", "send", "--live", "--base-url", "https://example.com", "--out", outsideOutput,
      "--allow-confirm", "--account", addressA, "--max-usd", "1"], env);
    expect(start.exitCode).toBe(0);
    const click = run(["click", "Send $0.10"], env);
    expect(click.exitCode).toBe(1);
    expect(click.stderr).toContain("Plain click refuses a money confirm");
    expect(fakeCalls().some((call) => call[0] === "click")).toBe(false);
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
      FAKE_AGENT_BROWSER_REVIEW: "Deposit\n$0.10",
      ...preparedEnv("savings-deposit", "Deposit $0.10"),
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
