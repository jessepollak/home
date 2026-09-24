import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { liveLogin, loadVerificationEnv } from "./live-login";

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
    expect(argv).not.toContain("bot@example.com");
    expect(argv).not.toContain("HOME_ACCESS_PASSWORD");
    expect(path).not.toContain(password);
    expect(path).not.toContain(otp);
    expect(calls.filter((call) => call.args[0] === "eval" && call.args[1] === "--stdin").map((call) => call.input)).toEqual(gated
      ? [expect.stringContaining(password), expect.stringContaining("bot@example.com"), expect.stringContaining(otp)]
      : [expect.stringContaining("bot@example.com"), expect.stringContaining(otp)]);
    expect(Bun.spawnSync(["ls", "-ld", path]).stdout.toString()).toStartWith("-rw-------");
    expect(Bun.spawnSync(["ls", "-ld", resolve(home, ".home-verify")]).stdout.toString()).toStartWith("drwx------");
    expect(calls.at(-1)?.args).toEqual(["close"]);
  }
});

async function privateEnvFile(contents: string): Promise<{ home: string; path: string }> {
  const home = Bun.spawnSync(["mktemp", "-d", resolve(tmpdir(), "home-env-test-XXXXXX")]).stdout.toString().trim();
  directories.push(home);
  expect(Bun.spawnSync(["mkdir", "-m", "700", resolve(home, ".home-verify")]).exitCode).toBe(0);
  const path = resolve(home, ".home-verify/live.env");
  await Bun.write(path, contents);
  expect(Bun.spawnSync(["chmod", "600", path]).exitCode).toBe(0);
  return { home, path };
}

test("loads only allowed literal values from the private file, splitting on the first equals and honoring environment precedence", async () => {
  const { home, path } = await privateEnvFile([
    "HOME_VERIFY_ACCOUNT_EMAIL=file@example.com",
    "HOME_ACCESS_PASSWORD=file=secret",
    "HOME_VERIFY_GMAIL_CREDENTIALS=/private/gmail.json",
    "HOME_VERIFY_OTP_SENDER=sender@example.com",
    "HOME_VERIFY_CASHOUT_HANDLE=$pinned",
    "HOME_VERIFY_PRODUCTION_URL=https://example.com",
    "",
  ].join("\n"));
  const env = await loadVerificationEnv({ HOME_VERIFY_ACCOUNT_EMAIL: "env@example.com", HOME_VERIFY_ENV_FILE: path }, home);
  expect(env.HOME_VERIFY_ACCOUNT_EMAIL).toBe("env@example.com");
  expect(env.HOME_ACCESS_PASSWORD).toBe("file=secret");
  expect(env.HOME_VERIFY_GMAIL_CREDENTIALS).toBe("/private/gmail.json");
  expect(env.HOME_VERIFY_OTP_SENDER).toBe("sender@example.com");
  expect(env.HOME_VERIFY_CASHOUT_HANDLE).toBe("$pinned");
  expect(env.HOME_VERIFY_PRODUCTION_URL).toBe("https://example.com");
  expect((await loadVerificationEnv({}, home)).HOME_VERIFY_ACCOUNT_EMAIL).toBe("file@example.com");
});

test("empty environment values and an empty env-file override use the private default file", async () => {
  const { home } = await privateEnvFile([
    "HOME_VERIFY_ACCOUNT_EMAIL=file@example.com",
    "HOME_ACCESS_PASSWORD=file=secret",
    "HOME_VERIFY_GMAIL_CREDENTIALS=/private/gmail.json",
    "HOME_VERIFY_OTP_SENDER=sender@example.com",
    "HOME_VERIFY_CASHOUT_HANDLE=$pinned",
    "HOME_VERIFY_PRODUCTION_URL=https://example.com",
  ].join("\n"));
  const empty = {
    HOME_VERIFY_ACCOUNT_EMAIL: "", HOME_ACCESS_PASSWORD: "", HOME_VERIFY_GMAIL_CREDENTIALS: "",
    HOME_VERIFY_OTP_SENDER: "", HOME_VERIFY_CASHOUT_HANDLE: "", HOME_VERIFY_PRODUCTION_URL: "",
    HOME_VERIFY_ENV_FILE: "",
  };
  const loaded = await loadVerificationEnv(empty, home);
  expect(loaded.HOME_VERIFY_ACCOUNT_EMAIL).toBe("file@example.com");
  expect(loaded.HOME_ACCESS_PASSWORD).toBe("file=secret");
  expect(loaded.HOME_VERIFY_GMAIL_CREDENTIALS).toBe("/private/gmail.json");
  expect(loaded.HOME_VERIFY_OTP_SENDER).toBe("sender@example.com");
  expect(loaded.HOME_VERIFY_CASHOUT_HANDLE).toBe("$pinned");
  expect(loaded.HOME_VERIFY_PRODUCTION_URL).toBe("https://example.com");
  expect(loaded.HOME_VERIFY_ENV_FILE).toBeUndefined();
});

test("uses the provisioned production URL when --base-url is omitted, preserving flag precedence and HTTPS validation", async () => {
  const { home } = await privateEnvFile("HOME_VERIFY_ACCOUNT_EMAIL=file@example.com\nHOME_VERIFY_PRODUCTION_URL=https://example.com\n");
  const calls: string[][] = [];
  const command = (args: string[]) => {
    calls.push(args);
    if (args[0] === "state") Bun.spawnSync(["touch", args[2]]);
    return "";
  };
  const options = { home, command, getOtp: async () => "123456" };
  await liveLogin(["--session", "file-url"], { ...options, env: { HOME_VERIFY_ACCOUNT_EMAIL: "", HOME_VERIFY_ENV_FILE: "", HOME_VERIFY_PRODUCTION_URL: "" } });
  expect(calls.find((args) => args[0] === "open")?.[1]).toBe("https://example.com/?account=signin");
  calls.length = 0;
  await liveLogin(["--session", "flag-url", "--base-url", "https://override.example"], { ...options, env: {} });
  expect(calls.find((args) => args[0] === "open")?.[1]).toBe("https://override.example/?account=signin");
  calls.length = 0;
  await liveLogin(["--session", "env-url"], { ...options, env: { HOME_VERIFY_PRODUCTION_URL: "https://environment.example" } });
  expect(calls.find((args) => args[0] === "open")?.[1]).toBe("https://environment.example/?account=signin");
  calls.length = 0;
  await expect(liveLogin([], { ...options, env: { HOME_VERIFY_PRODUCTION_URL: "http://example.com" } })).rejects.toThrow("HTTPS origin");
  expect(calls).toEqual([]);
  const withoutHost = await privateEnvFile("HOME_VERIFY_ACCOUNT_EMAIL=file@example.com\n");
  await expect(liveLogin([], { ...options, home: withoutHost.home, env: { HOME_VERIFY_PRODUCTION_URL: "" } })).rejects.toThrow("Specify --base-url");
  expect(calls).toEqual([]);
});

test("live login reads file settings without putting account or access password in browser argv", async () => {
  const { home } = await privateEnvFile("HOME_VERIFY_ACCOUNT_EMAIL=file@example.com\nHOME_ACCESS_PASSWORD=gate=secret\n");
  const calls: Array<{ args: string[]; input?: string }> = [];
  const command = (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === "eval" && args[1] === "location.pathname") return "/access";
    if (args[0] === "state") Bun.spawnSync(["touch", args[2]]);
    return "";
  };
  await liveLogin(["--base-url", "https://example.com"], { home, env: {}, command, getOtp: async () => "123456" });
  const argv = JSON.stringify(calls.map((call) => call.args));
  for (const secret of ["file@example.com", "gate=secret", "123456"]) expect(argv).not.toContain(secret);
  expect(calls.some(({ input }) => input?.includes("gate=secret"))).toBe(true);
  expect(calls.some(({ input }) => input?.includes("file@example.com"))).toBe(true);
});

test("refuses symlinks, permissive permissions, and non-allowlisted or malformed lines without printing values", async () => {
  const { home, path } = await privateEnvFile("HOME_ACCESS_PASSWORD=private-value\n");
  const env = { HOME_VERIFY_ENV_FILE: path };
  expect(Bun.spawnSync(["chmod", "644", path]).exitCode).toBe(0);
  await expect(loadVerificationEnv(env, home)).rejects.toThrow("inaccessible to group and others");
  expect(Bun.spawnSync(["chmod", "600", path]).exitCode).toBe(0);
  for (const contents of ["UNEXPECTED_KEY=private-value", "HOME_ACCESS_PASSWORD=private-value\nexport HOME_VERIFY_ACCOUNT_EMAIL=x", "HOME_ACCESS_PASSWORD=a\nHOME_ACCESS_PASSWORD=b"]) {
    await Bun.write(path, contents);
    await expect(loadVerificationEnv(env, home)).rejects.toThrow("invalid or duplicate key/line");
  }
  await Bun.write(path, "HOME_ACCESS_PASSWORD=private-value");
  const link = resolve(home, "linked.env");
  expect(Bun.spawnSync(["ln", "-s", path, link]).exitCode).toBe(0);
  await expect(loadVerificationEnv({ HOME_VERIFY_ENV_FILE: link }, home)).rejects.toThrow("not a symlink");
  await expect(loadVerificationEnv({ HOME_VERIFY_ENV_FILE: resolve(home, "missing.env") }, home)).rejects.toThrow("Could not read verification env file");
  expect((await loadVerificationEnv({ HOME_VERIFY_ACCOUNT_EMAIL: "env@example.com" }, resolve(home, "missing-home"))).HOME_VERIFY_ACCOUNT_EMAIL).toBe("env@example.com");
});

test("defaults to headed browser but preserves a provisioned runner's override", async () => {
  const home = Bun.spawnSync(["mktemp", "-d", resolve(tmpdir(), "home-headed-test-XXXXXX")]).stdout.toString().trim();
  directories.push(home);
  const browserPath = resolve(home, "bunx");
  const observedPath = resolve(home, "headed");
  await Bun.write(browserPath, '#!/bin/sh\nif [ -n "$HOME_VERIFY_ACCOUNT_EMAIL" ] || [ -n "$HOME_VERIFY_GMAIL_CREDENTIALS" ] || [ -n "$HOME_VERIFY_CASHOUT_HANDLE" ] || [ -n "$HOME_ACCESS_PASSWORD" ]; then printf leaked > "$FAKE_HEADED_LOG"; else printf "%s" "$AGENT_BROWSER_HEADED" > "$FAKE_HEADED_LOG"; fi\nexit 1\n');
  Bun.spawnSync(["chmod", "755", browserPath]);
  for (const [setting, expected] of [[undefined, "true"], ["false", "false"]] as const) {
    const env = {
      HOME_VERIFY_ACCOUNT_EMAIL: "bot@example.com",
      HOME_VERIFY_CASHOUT_HANDLE: "$pinned",
      HOME_ACCESS_PASSWORD: "gate=secret",
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
