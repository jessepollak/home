import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { liveLogin } from "./live-login";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) Bun.spawnSync(["rm", "-rf", path]); });

async function login(gated: boolean) {
  const home = Bun.spawnSync(["mktemp", "-d", resolve(tmpdir(), "home-login-test-XXXXXX")]).stdout.toString().trim();
  directories.push(home);
  const calls: Array<{ args: string[]; input?: string }> = [];
  const password = "secret-access-password-796";
  const otp = "847291";
  const command = (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === "eval" && args[1] === "location.pathname") return gated ? "/access" : "/";
    if (args[0] === "state") Bun.spawnSync(["touch", args[2]]);
    return "";
  };
  const path = await liveLogin(["--session", "bot-796", "--base-url", "https://example.com"], {
    home, command, getOtp: async () => otp,
    env: { HOME_VERIFY_ACCOUNT_EMAIL: "bot@example.com", ...(gated ? { HOME_ACCESS_PASSWORD: password } : {}) },
  });
  return { path, calls, home, password, otp };
}

test("OTP and gated password are passed only via stdin, never argv or output", async () => {
  for (const gated of [false, true]) {
    const { path, calls, home, password, otp } = await login(gated);
    expect(path).toBe(resolve(home, ".home-verify/bot-796.state.json"));
    const argv = JSON.stringify(calls.map((call) => call.args));
    expect(argv).not.toContain(password);
    expect(argv).not.toContain(otp);
    expect(argv).not.toContain("HOME_ACCESS_PASSWORD");
    expect(path).not.toContain(password);
    expect(path).not.toContain(otp);
    expect(calls.filter((call) => call.args[0] === "eval" && call.args[1] === "--stdin").map((call) => call.input)).toEqual(gated
      ? [expect.stringContaining(password), expect.stringContaining(otp)]
      : [expect.stringContaining(otp)]);
    expect(Bun.spawnSync(["ls", "-ld", path]).stdout.toString()).toStartWith("-rw-------");
    expect(Bun.spawnSync(["ls", "-ld", resolve(home, ".home-verify")]).stdout.toString()).toStartWith("drwx------");
    expect(calls.at(-1)?.args).toEqual(["close"]);
  }
});

test("defaults to headed browser but preserves a provisioned runner's override", async () => {
  const home = Bun.spawnSync(["mktemp", "-d", resolve(tmpdir(), "home-headed-test-XXXXXX")]).stdout.toString().trim();
  directories.push(home);
  const browserPath = resolve(home, "bunx");
  const observedPath = resolve(home, "headed");
  await Bun.write(browserPath, '#!/bin/sh\nprintf "%s" "$AGENT_BROWSER_HEADED" > "$FAKE_HEADED_LOG"\nexit 1\n');
  Bun.spawnSync(["chmod", "755", browserPath]);
  for (const [setting, expected] of [[undefined, "true"], ["false", "false"]] as const) {
    const env = {
      HOME_VERIFY_ACCOUNT_EMAIL: "bot@example.com",
      PATH: home,
      FAKE_HEADED_LOG: observedPath,
      ...(setting === undefined ? {} : { AGENT_BROWSER_HEADED: setting }),
    };
    await expect(liveLogin(["--base-url", "https://example.com"], { home, env })).rejects.toThrow("Browser open failed");
    expect(Bun.spawnSync(["cat", observedPath]).stdout.toString()).toBe(expected);
  }
});

test("refuses missing account, unsafe state name and non-HTTPS origin before browser launch", async () => {
  const calls: string[][] = [];
  const command = (args: string[]) => { calls.push(args); return ""; };
  const env = { HOME_VERIFY_ACCOUNT_EMAIL: "bot@example.com" };
  await expect(liveLogin(["--base-url", "https://example.com"], { command, env: {} })).rejects.toThrow("HOME_VERIFY_ACCOUNT_EMAIL");
  await expect(liveLogin(["--session", "../escape", "--base-url", "https://example.com"], { command, env })).rejects.toThrow("--session");
  await expect(liveLogin(["--base-url", "http://example.com"], { command, env })).rejects.toThrow("HTTPS");
  expect(calls).toEqual([]);
});
