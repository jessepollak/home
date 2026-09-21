import { describe, expect, test } from "bun:test";
import {
  accountPinError,
  automationEnvironmentError,
  composeAllowedDomains,
  decideConfirmGate,
  enforceAmountCap,
  liveProviderOrigins,
  outputInsideRepository,
  parseBorrowReviewAmounts,
  parseUsdAmount,
} from "./live";

const address = "0x1111111111111111111111111111111111111111";

describe("live confirm gate", () => {
  test("runs non-money steps without confirmation authority", () => {
    expect(decideConfirmGate("read-only", "Continue", false)).toEqual({ action: "run" });
    expect(decideConfirmGate(undefined, "Continue", false)).toEqual({ action: "run" });
  });

  test("stops money steps for missing, read-only, up-to-review, and unapproved confirm access", () => {
    expect(decideConfirmGate(undefined, "Confirm", false).action).toBe("stop");
    expect(decideConfirmGate("read-only", "Deposit", false).action).toBe("stop");
    expect(decideConfirmGate("up-to-review", "Cash out $1.00", false).action).toBe("stop");
    expect(decideConfirmGate("confirm", "Send now", false).action).toBe("stop");
  });

  test("runs approved send, save, and borrow confirms only on a confirm surface", () => {
    expect(decideConfirmGate("confirm", "Send now", true)).toEqual({ action: "run" });
    expect(decideConfirmGate("confirm", "Deposit", true)).toEqual({ action: "run" });
    expect(decideConfirmGate("confirm", "Confirm action", true)).toEqual({ action: "run" });
    expect(decideConfirmGate("confirm", "Continue", true)).toEqual({ action: "run" });
  });

  test("refuses confirmation authority on surfaces that cannot confirm", () => {
    expect(decideConfirmGate("read-only", "Continue", true).action).toBe("refuse");
    expect(decideConfirmGate("up-to-review", "Confirm", true).action).toBe("refuse");
    expect(decideConfirmGate(undefined, "Submit", true).action).toBe("refuse");
  });
});

describe("live amount cap", () => {
  test("parses labelled and prominent USD amounts", () => {
    expect(parseUsdAmount("Amount\n$1,234.50\nNetwork\nBase")).toBe(1234.5);
    expect(parseUsdAmount("You pay\nUS$ 25.50\nReceive\n25 USDC")).toBe(25.5);
    expect(parseUsdAmount("Confirm\n$1.00\nYou're sending USDC")).toBe(1);
    expect(parseUsdAmount("Confirm\n1 USDC\nNetwork\nBase\nFee\n$0.01")).toBeNull();
  });

  test("caps a borrow by the received amount and records collateral separately", () => {
    const amounts = parseBorrowReviewAmounts([
      "Confirm",
      "Borrow USDC",
      "Locked as collateral (cbBTC)",
      "0.0001 cbBTC",
      "You receive (USDC)",
      "25.50 USDC",
    ].join("\n"));
    expect(amounts).toEqual({
      borrowedAmount: "25.50 USDC",
      collateralAmount: "0.0001 cbBTC",
      borrowedAmountUsd: 25.5,
    });
    expect(enforceAmountCap(amounts.borrowedAmountUsd, 25)).toContain("exceeds");
  });

  test("refuses unparseable, invalid-cap, and above-cap amounts", () => {
    expect(enforceAmountCap(parseUsdAmount("1 USDC"), 2)).toContain("could not be parsed");
    expect(enforceAmountCap(1, 0)).toContain("positive number");
    expect(enforceAmountCap(10.01, 10)).toContain("exceeds");
    expect(enforceAmountCap(10, 10)).toBeNull();
  });
});

describe("live browser allowlist", () => {
  test("combines the base host, provider origins, repeated overrides, and fixture loopbacks", () => {
    expect(liveProviderOrigins).toEqual([
      "https://api.cdp.coinbase.com",
      "https://secure-wallet.cdp.coinbase.com",
    ]);
    expect(composeAllowedDomains(
      new URL("https://preview.example.com"),
      ["extra.example.com", "EXTRA.example.com"],
      true,
    )).toEqual([
      "preview.example.com",
      "api.cdp.coinbase.com",
      "secure-wallet.cdp.coinbase.com",
      "extra.example.com",
      "localhost",
      "127.0.0.1",
    ]);
    expect(composeAllowedDomains(new URL("https://preview.example.com"), [], false)).not.toContain("localhost");
  });

  test("rejects allow-domain values that are not bare hostnames", () => {
    for (const value of ["https://extra.example.com", "extra.example.com:443", "extra.example.com/path", "two hosts"]) {
      expect(() => composeAllowedDomains(new URL("https://preview.example.com"), [value], false)).toThrow("bare hostname");
    }
  });
});

describe("live run guards", () => {
  test("refuses account pin mismatch and unreadable pins", () => {
    expect(accountPinError(address, address.toUpperCase().replace("0X", "0x"))).toBeNull();
    expect(accountPinError("0x2222222222222222222222222222222222222222", address)).toContain("does not match");
    expect(accountPinError(null, address)).toContain("could not be read");
  });

  test("refuses CI environments", () => {
    expect(automationEnvironmentError({ CI: "1" })).toContain("operator-only");
    expect(automationEnvironmentError({ GITHUB_ACTIONS: "true" })).toContain("operator-only");
    expect(automationEnvironmentError({})).toBeNull();
  });

  test("refuses evidence output inside the repository", () => {
    expect(outputInsideRepository("/repo/.verify", "/repo")).toBe(true);
    expect(outputInsideRepository("/repo", "/repo")).toBe(true);
    expect(outputInsideRepository("/tmp/home-verify", "/repo")).toBe(false);
  });
});
