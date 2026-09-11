import { describe, expect, test } from "bun:test";
import { classifyEmailCodeError } from "./auth-errors";

describe("email code errors", () => {
  test("distinguishes invalid and expired codes without surfacing provider text", () => {
    expect(classifyEmailCodeError(new Error("invalid otp fixture"))).toBe(
      "invalid",
    );
    expect(classifyEmailCodeError(new Error("flow expired fixture"))).toBe(
      "expired",
    );
    expect(classifyEmailCodeError(new Error("provider detail fixture"))).toBe(
      "unavailable",
    );
  });
});
