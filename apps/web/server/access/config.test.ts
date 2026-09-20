import { describe, expect, test } from "bun:test";
import { readAccessConfig } from "./config";

const credentialKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;
const signingSecretKey = "HOME_ACCESS_SIGNING_SECRET";

function environment(
  required: string | undefined,
  credential?: string,
  signingSecret?: string,
): Record<string, string | undefined> {
  return {
    ...(required === undefined ? {} : { HOME_ACCESS_REQUIRED: required }),
    ...(credential === undefined ? {} : { [credentialKey]: credential }),
    ...(signingSecret === undefined ? {} : { [signingSecretKey]: signingSecret }),
  };
}

describe("deployment access configuration", () => {
  test("is disabled unless explicitly required", () => {
    expect(readAccessConfig({})).toEqual({ kind: "disabled" });
    expect(readAccessConfig(environment("0", "a".repeat(8), "b".repeat(32))))
      .toEqual({ kind: "disabled" });
  });

  test("fails closed when a required credential is absent or shorter than 8 UTF-8 bytes", () => {
    expect(readAccessConfig(environment("1", undefined, "b".repeat(32))))
      .toEqual({ kind: "misconfigured" });
    expect(readAccessConfig(environment("1", `${"🔐"}${"a".repeat(3)}`, "b".repeat(32))))
      .toEqual({ kind: "misconfigured" });
  });

  test("fails closed when a required signing secret is absent or shorter than 32 UTF-8 bytes", () => {
    expect(readAccessConfig(environment("1", "a".repeat(8))))
      .toEqual({ kind: "misconfigured" });
    expect(readAccessConfig(environment("1", "a".repeat(8), "b".repeat(31))))
      .toEqual({ kind: "misconfigured" });
  });

  test("accepts the 8-byte credential and 32-byte signing secret boundaries", () => {
    const credential = "🔐".repeat(2);
    const signingSecret = "b".repeat(32);
    expect(readAccessConfig(environment("1", credential, signingSecret)))
      .toEqual({ kind: "enabled", credential, signingSecret });
  });
});
