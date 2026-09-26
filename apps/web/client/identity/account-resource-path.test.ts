import { describe, expect, test } from "bun:test";
import {
  accountResourceRequiresSmartAccount,
  normalizeAccountResourcePath,
} from "@/client/account/cdp-authenticated-transport";

describe("identity account resources", () => {
  test.each([
    "/api/identity/verification",
    "/api/identity/verification/session",
    "/api/identity/verification/link",
  ])("the authenticated transport accepts %s", (path) => {
    expect(normalizeAccountResourcePath(path)).toBe(path);
  });

  test("identity requests do not wait for the smart account; money resources still do", () => {
    expect(accountResourceRequiresSmartAccount("/api/identity/verification")).toBe(false);
    expect(accountResourceRequiresSmartAccount("/api/identity/verification/session")).toBe(false);
    expect(accountResourceRequiresSmartAccount("/api/balances?region=us")).toBe(true);
    expect(accountResourceRequiresSmartAccount("/api/actions")).toBe(true);
  });

  test("rejects traversal and look-alike identity prefixes", () => {
    expect(() => normalizeAccountResourcePath("/api/identity/../session")).toThrow();
    expect(() => normalizeAccountResourcePath("/api/identityx")).toThrow();
  });
});
