import { describe, expect, test } from "bun:test";
import { ACCESS_CONTRACT_VERSION, parseSafeAccessDestination } from "./contract";

describe("access contract", () => {
  test("is versioned and preserves bounded same-origin paths", () => {
    expect(ACCESS_CONTRACT_VERSION).toBe(1);
    expect(parseSafeAccessDestination("/borrow?asset=usdc#review")).toBe("/borrow?asset=usdc#review");
    expect(parseSafeAccessDestination("/" + "a".repeat(2047))).toHaveLength(2048);
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
