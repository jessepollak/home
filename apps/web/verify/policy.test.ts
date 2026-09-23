import { describe, expect, test } from "bun:test";
import { confirmCountRefusal, requestedConfirmLimit, resolveVerifyRole, verifyPolicy } from "./policy";

describe("verify confirmation counts", () => {
  test("pins the operator role and refuses unknown roles", () => {
    expect(resolveVerifyRole(undefined)).toBe("operator");
    expect(resolveVerifyRole("factory")).toBe("factory");
    expect(() => resolveVerifyRole("unknown")).toThrow("operator or factory");
  });
  test("allows one confirm by default and at most five per session", () => {
    expect(requestedConfirmLimit(undefined)).toBe(1);
    expect(requestedConfirmLimit("5")).toBe(5);
    for (const value of ["0", "6", "1.5", "nope"]) expect(() => requestedConfirmLimit(value)).toThrow("integer");
    expect(verifyPolicy.perDayConfirms).toBe(5);
  });
  test("stops at the session or daily count boundary", () => {
    expect(confirmCountRefusal(0, 0, 1)).toBeNull();
    expect(confirmCountRefusal(1, 1, 1)).toContain("session limit");
    expect(confirmCountRefusal(0, 5, 2)).toContain("daily limit");
    expect(confirmCountRefusal(1, 4, 2)).toBeNull();
  });
});
