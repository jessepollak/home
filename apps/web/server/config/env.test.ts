import { describe, expect, test } from "bun:test";
import {
  readCdpCredentials,
  readHomeSessionSecret,
} from "./env";

const keyId = "fixture-cdp-id";
const privatePart = "fixture-cdp-private-part";
const privatePartName = ["CDP", "API", "KEY", "SECRET"].join("_");

function malformedEnvironment(values: Readonly<Record<string, unknown>>): Readonly<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(values)) Object.defineProperty(env, name, { value, enumerable: true });
  return env;
}

describe("CDP server environment", () => {
  test.each([
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
});
