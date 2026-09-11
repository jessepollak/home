import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { normalizeAccountResourcePath } from "./cdp-authenticated-transport";
import {
  BaseAccountLoginError,
  embeddedSelection,
  initialAccountSelection,
  writeAccountProviderHint,
} from "./cdp-wallet-provider-capabilities";
import { TransferExecutionError } from "@/features/transfers/types";

const providerHintKey = "home:account-provider";

afterEach(() => {
  window.sessionStorage.clear();
});

describe("authenticated transport path boundary", () => {
  test.each([
    "/api/actions",
    "/api/actions/operations?limit=10",
    "/api/savings/actions/prepare",
    "/api/trades/quote",
    "/api/borrow/positions",
    "/api/funding/prepare",
  ])("admits the bounded same-origin path %s", (path) => {
    expect(normalizeAccountResourcePath(path)).toBe(path);
  });

  test.each([
    "https://evil.example/api/actions",
    "//evil.example/api/actions",
    "/api/portfolio",
    "/api/actions/../portfolio",
    "/api/actions/%2e%2e/portfolio",
    "/api/actions\\prepare",
    "/api/actions#fragment",
  ])("rejects the untrusted path %s", (path) => {
    expect(() => normalizeAccountResourcePath(path)).toThrow(TransferExecutionError);
  });
});

describe("wallet-provider restoration evidence", () => {
  test.each(["cdp-embedded", "base-account"] as const)(
    "restores a durable %s provider hint",
    (provider) => {
      window.sessionStorage.setItem(providerHintKey, provider);
      expect(initialAccountSelection()).toEqual({ provider: "restoring", hint: provider });
    },
  );

  test.each(["pending:cdp-embedded", "pending:base-account"] as const)(
    "keeps unfinished %s authentication blocked after remount",
    (hint) => {
      window.sessionStorage.setItem(providerHintKey, hint);
      expect(initialAccountSelection()).toEqual({
        provider: "blocked-authentication",
        authentication: null,
        restoredPendingHint: true,
      });
    },
  );

  test("journals and clears provider hints without changing the embedded selection shape", () => {
    writeAccountProviderHint("base-account");
    expect(window.sessionStorage.getItem(providerHintKey)).toBe("base-account");
    writeAccountProviderHint(null);
    expect(window.sessionStorage.getItem(providerHintKey)).toBeNull();
    expect(embeddedSelection()).toEqual({ provider: "cdp-embedded" });
  });

  test("preserves the public Base login error reason", () => {
    expect(new BaseAccountLoginError("verification-unsupported").reason).toBe(
      "verification-unsupported",
    );
  });
});
