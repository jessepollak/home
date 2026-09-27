import { describe, expect, test } from "bun:test";
import { MfaError } from "@coinbase/cdp-core";
import { isUserRejectedWalletError } from "./action-dispatch";
import { BaseAccountConnectorError } from "./base-account-connector";

describe("isUserRejectedWalletError", () => {
  test("recognizes a cancelled CDP MFA error", () => {
    expect(isUserRejectedWalletError(new MfaError("CANCELLED", "cancelled"))).toBe(true);
  });

  test("does not reject another CDP MFA error", () => {
    expect(isUserRejectedWalletError(new MfaError("SUPERSEDED", "superseded"))).toBe(false);
  });

  test("does not reject an MFA-named Error without a cancellation code", () => {
    const error = new Error("not cancelled");
    error.name = "MfaError";
    expect(isUserRejectedWalletError(error)).toBe(false);
  });

  test("recognizes an MFA-named Error with a cancellation code", () => {
    const error = Object.assign(new Error("cancelled"), { name: "MfaError", code: "CANCELLED" });
    expect(isUserRejectedWalletError(error)).toBe(true);
  });

  test("recognizes a cancelled Base Account connector error", () => {
    expect(isUserRejectedWalletError(new BaseAccountConnectorError("cancelled"))).toBe(true);
  });

  test("does not reject an unrelated Error", () => {
    expect(isUserRejectedWalletError(new Error("failure"))).toBe(false);
  });

  test("does not reject a non-Error object with MFA fields", () => {
    expect(isUserRejectedWalletError({ name: "MfaError", code: "CANCELLED" })).toBe(false);
  });
});
