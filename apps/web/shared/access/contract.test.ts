import { describe, expect, test } from "bun:test";
import {
  ACCESS_CONTRACT_VERSION,
  accessErrorCode,
  accessSuccessDestination,
  parseSafeAccessDestination,
} from "./contract";

describe("access contract", () => {
  test("is versioned and preserves bounded same-origin paths", () => {
    expect(ACCESS_CONTRACT_VERSION).toBe(1);
    expect(parseSafeAccessDestination("/borrow?asset=usdc#review")).toBe("/borrow?asset=usdc#review");
    expect(parseSafeAccessDestination("/" + "a".repeat(2047))).toHaveLength(2048);
  });

  test("accepts only versioned, already-safe success destinations", () => {
    expect(accessSuccessDestination({ version: 1, destination: "/save?asset=usdc" }))
      .toBe("/save?asset=usdc");
    expect(accessSuccessDestination({ version: 1, destination: "/access" })).toBeNull();
    expect(accessSuccessDestination({ version: 2, destination: "/save" })).toBeNull();
  });

  test("rejects malformed access error and success payloads", () => {
    for (const value of [null, [], "x", { code: 1 }, { version: 1, error: { code: 1 } }, { version: 2, error: { code: "ACCESS_REQUIRED" } }]) {
      expect(accessErrorCode(value)).toBeNull();
      expect(accessSuccessDestination(value)).toBeNull();
    }
    expect(accessErrorCode({ version: 1, error: { code: "ACCESS_REQUIRED" } })).toBe("ACCESS_REQUIRED");
  });

  test("falls back for external, ambiguous, access-loop, control, and oversized destinations", () => {
    for (const value of [
      undefined,
      "",
      "https://attacker.test/",
      "//attacker.test/",
      "/\\attacker.test/",
      "/access",
      "/api/access/logout",
      "/safe\nunsafe",
      "/" + "a".repeat(2048),
    ]) expect(parseSafeAccessDestination(value)).toBe("/");
  });
});
