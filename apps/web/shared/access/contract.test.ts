import { describe, expect, test } from "bun:test";
import {
  ACCESS_CONTRACT_VERSION,
  ACCESS_CREDENTIAL_FIELD,
  accessErrorCode,
  accessSuccessDestination,
  parseSafeAccessDestination,
  readAccessRequest,
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

  test("rejects contradictory and extra response fields", () => {
    const contradictory = { version: 1, destination: "/save", error: { code: "ACCESS_REQUIRED" } };
    expect(accessSuccessDestination(contradictory)).toBeNull();
    expect(accessErrorCode(contradictory)).toBeNull();
    expect(accessSuccessDestination({ version: 1, destination: "/save", extra: true })).toBeNull();
    expect(accessErrorCode({ version: 1, error: { code: "ACCESS_REQUIRED", extra: true } })).toBeNull();
  });

  test("parses single credential forms and leaves destinations untouched", () => {
    const form = new URLSearchParams([[ACCESS_CREDENTIAL_FIELD, "secret"]]);
    expect(readAccessRequest(form)).toEqual({ credential: "secret" });
    form.set("next", "/access");
    expect(readAccessRequest(form)).toEqual({ credential: "secret", destination: "/access" });
    form.set(ACCESS_CREDENTIAL_FIELD, "");
    expect(readAccessRequest(form)).toEqual({ credential: "", destination: "/access" });
  });

  test("rejects missing, duplicate, and unknown form fields", () => {
    const valid = new URLSearchParams([[ACCESS_CREDENTIAL_FIELD, "secret"], ["next", "/save"]]);
    expect(readAccessRequest(new URLSearchParams("next=%2Fsave"))).toBeNull();
    for (const [name, value] of [[ACCESS_CREDENTIAL_FIELD, "extra"], ["next", "/borrow"], ["unexpected", "value"]]) {
      const form = new URLSearchParams(valid);
      form.append(name, value);
      expect(readAccessRequest(form)).toBeNull();
    }
  });

  test("bounds credential length by UTF-8 bytes", () => {
    expect(readAccessRequest(new URLSearchParams([[ACCESS_CREDENTIAL_FIELD, "é".repeat(512)]])))
      .toEqual({ credential: "é".repeat(512) });
    expect(readAccessRequest(new URLSearchParams([[ACCESS_CREDENTIAL_FIELD, "é".repeat(513)]]))).toBeNull();
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
