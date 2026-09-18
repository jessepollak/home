import { describe, expect, test } from "bun:test";
import { readAccessConfig } from "./config";

const credentialKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;
function environment(required: string | undefined, credential?: string): Record<string, string | undefined> {
  return {
    ...(required === undefined ? {} : { HOME_ACCESS_REQUIRED: required }),
    ...(credential === undefined ? {} : { [credentialKey]: credential }),
  };
}

describe("deployment access configuration", () => {
  test("is disabled unless explicitly required", () => {
    expect(readAccessConfig({})).toEqual({ kind: "disabled" });
    expect(readAccessConfig(environment("0", "a".repeat(32)))).toEqual({ kind: "disabled" });
  });

  test("fails closed when a required credential is absent or shorter than 32 UTF-8 bytes", () => {
    expect(readAccessConfig(environment("1"))).toEqual({ kind: "misconfigured" });
    expect(readAccessConfig(environment("1", "a".repeat(31)))).toEqual({ kind: "misconfigured" });
  });

  test("accepts a required credential with at least 32 UTF-8 bytes", () => {
    expect(readAccessConfig(environment("1", "🔐".repeat(8))))
      .toEqual({ kind: "enabled", credential: "🔐".repeat(8) });
  });
});
