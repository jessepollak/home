import { afterEach, describe, expect, test } from "bun:test";
import {
  readCdpCredentials,
  readHomeSessionSecret,
} from "./env";

const keyId = "fixture-cdp-id";
const privatePart = "fixture-cdp-private-part";
const privatePartName = ["CDP", "API", "KEY", "SECRET"].join("_");
const originalId = process.env.CDP_API_KEY_ID;
const originalPrivatePart = process.env[privatePartName];

function malformedEnvironment(values: Readonly<Record<string, unknown>>): Readonly<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(values)) Object.defineProperty(env, name, { value, enumerable: true });
  return env;
}

afterEach(() => {
  if (originalId === undefined) delete process.env.CDP_API_KEY_ID;
  else process.env.CDP_API_KEY_ID = originalId;
  if (originalPrivatePart === undefined) delete process.env[privatePartName];
  else process.env[privatePartName] = originalPrivatePart;
});

describe("CDP server environment", () => {
  test.each([
    [{}, "unset"],
    [{ CDP_API_KEY_ID: "", [privatePartName]: "" }, "unset"],
    [{ CDP_API_KEY_ID: " \t", [privatePartName]: "\n " }, "unset"],
    [{ CDP_API_KEY_ID: keyId }, "partial"],
    [{ [privatePartName]: privatePart }, "partial"],
    [{ CDP_API_KEY_ID: keyId, [privatePartName]: " \t" }, "partial"],
    [{ CDP_API_KEY_ID: "\n", [privatePartName]: privatePart }, "partial"],
  ] as const)("classifies credentials %j as %s", (env, status) => {
    expect(readCdpCredentials(env)).toEqual({ status });
  });

  test("returns complete non-empty credentials with surrounding whitespace trimmed", () => {
    expect(readCdpCredentials({
      CDP_API_KEY_ID: ` \t${keyId}\n`,
      [privatePartName]: `\n${privatePart} \t`,
    })).toEqual({ status: "complete", apiKeyId: keyId, "apiKeySecret": privatePart });
  });

  test("isolates injected environments from the default environment and each other", () => {
    process.env.CDP_API_KEY_ID = "default-cdp-id";
    process.env[privatePartName] = "default-cdp-private-part";
    const env = { CDP_API_KEY_ID: keyId, [privatePartName]: privatePart };
    expect(readCdpCredentials(env)).toEqual({ status: "complete", apiKeyId: keyId, "apiKeySecret": privatePart });
    expect(readCdpCredentials({})).toEqual({ status: "unset" });
    expect(env).toEqual({ CDP_API_KEY_ID: keyId, [privatePartName]: privatePart });
    expect(readCdpCredentials()).toEqual({ status: "complete", apiKeyId: "default-cdp-id", "apiKeySecret": "default-cdp-private-part" });
  });

  test("reads the default environment afresh on each call", () => {
    delete process.env.CDP_API_KEY_ID;
    delete process.env[privatePartName];
    expect(readCdpCredentials()).toEqual({ status: "unset" });
    process.env.CDP_API_KEY_ID = keyId;
    expect(readCdpCredentials()).toEqual({ status: "partial" });
    process.env[privatePartName] = privatePart;
    expect(readCdpCredentials()).toEqual({ status: "complete", apiKeyId: keyId, "apiKeySecret": privatePart });
  });

  test("does not read process.env when importing the module in a fresh process", () => {
    const result = Bun.spawnSync([process.execPath, "--eval", `
      import { mock } from "bun:test";
      import "zod";
      await mock.module("server-only", () => ({}));
      const descriptor = Object.getOwnPropertyDescriptor(process, "env");
      let reads = 0;
      Object.defineProperty(process, "env", { configurable: true, get() { reads += 1; return {}; } });
      await import(${JSON.stringify(new URL("./env.ts", import.meta.url).pathname)});
      Object.defineProperty(process, "env", descriptor);
      if (reads !== 0) throw new Error("Module import read the environment.");
    `], { cwd: new URL("../../", import.meta.url).pathname });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
  });

  test.each([
    { CDP_API_KEY_ID: keyId },
    { [privatePartName]: privatePart },
    malformedEnvironment({ CDP_API_KEY_ID: keyId, [privatePartName]: 123 }),
    malformedEnvironment({ CDP_API_KEY_ID: null, [privatePartName]: privatePart }),
  ])("returns only secret-safe statuses for incomplete or invalid credentials %j", (env) => {
    const result = readCdpCredentials(env);
    expect(result).toEqual({ status: "partial" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(keyId);
    expect(serialized).not.toContain(privatePart);
    expect(result).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("message");
  });
});

describe("Home session server environment", () => {
  const name = "HOME_SESSION_SECRET";
  const read = readHomeSessionSecret;
  test("treats missing, empty, and whitespace-only values as unset", () => {
    expect(read({})).toBeUndefined();
    expect(read({ [name]: "" })).toBeUndefined();
    expect(read({ [name]: " \t\n" })).toBeUndefined();
  });

  test("trims configured values", () => {
    expect(read({ [name]: " \tconfigured-value\n" })).toBe("configured-value");
  });

  test("isolates injected environments and reads the default lazily and afresh", () => {
    const original = process.env[name];
    try {
      process.env[name] = "default-value";
      const env = { [name]: "injected-value" };
      expect(read(env)).toBe("injected-value");
      expect(read({})).toBeUndefined();
      expect(env).toEqual({ [name]: "injected-value" });
      expect(read()).toBe("default-value");
      process.env[name] = "changed-value";
      expect(read()).toBe("changed-value");
      delete process.env[name];
      expect(read()).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });
});
