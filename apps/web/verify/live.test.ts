import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "node:path";
import { formatAddress } from "../shared/formatting";
import {
  accountAddressFromDocument,
  accountPinError,
  automationEnvironmentError,
  composeAllowedDomains,
  confirmReviewOrderError,
  decideConfirmGate,
  defaultLiveRecipient,
  enforceAmountCap,
  enforceCumulativeAmountCap,
  hostObservationRefusal,
  isRecipientFillStep,
  liveProviderOrigins,
  liveStepError,
  outputInsideRepository,
  parseBorrowReviewAmounts,
  parseUsdAmount,
  parseUsdAmountFromLabel,
  recipientPlaceholderError,
  recipientRowError,
  resolveLiveRecipient,
  reviewAndLabelAmountError,
  unexpectedNetworkHosts,
  unlistedAmountClickError,
} from "./live";

const address = "0x1111111111111111111111111111111111111111";
const defaultRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";
const recipientReview = (to: string) => `Confirm\n$1.00\nYou're sending USDC\nTo\n${to}\nAsset\nUSDC\nNetwork\nBase`;

describe("live confirm gate", () => {
  test("runs ordinary controls without confirmation authority", () => {
    expect(decideConfirmGate("read-only", "Continue", false)).toEqual({ action: "run" });
    expect(decideConfirmGate(undefined, "Continue", false)).toEqual({ action: "run" });
    expect(decideConfirmGate("up-to-review", "Continue", false)).toEqual({ action: "run" });
    expect(decideConfirmGate("confirm", "Continue", false)).toEqual({ action: "run" });
    expect(decideConfirmGate("read-only", "Sign out", false, false, true)).toEqual({ action: "run" });
  });

  test("stops every listed final-confirm label without authority", () => {
    for (const label of ["Send $1.00", "Deposit $1.00", "Withdraw $1.00", "Cash out $1.00", "Confirm action", "Retry"]) {
      expect(decideConfirmGate("confirm", label, false, true, true).action).toBe("stop");
    }
    expect(decideConfirmGate("up-to-review", "Cash out $1.00", false, true, true).action).toBe("stop");
  });

  test("runs approved final-confirm labels only on a confirm surface", () => {
    for (const label of ["Send $1.00", "Deposit $1.00", "Withdraw $1.00", "Confirm action", "Retry"]) {
      expect(decideConfirmGate("confirm", label, true, true, true)).toEqual({ action: "run" });
    }
  });

  test("refuses amount-bearing clicks unless the label is listed for the surface", () => {
    expect(unlistedAmountClickError("Withdraw $1.00", true)).toBeNull();
    expect(unlistedAmountClickError("Withdraw $1.00", false)).toContain("amount-bearing");
    expect(unlistedAmountClickError("Withdraw 1 USDC", false)).toContain("amount-bearing");
    expect(unlistedAmountClickError("Continue", false)).toBeNull();
  });

  test("stops unknown controls after review on money surfaces", () => {
    expect(decideConfirmGate("confirm", "Pay somehow", false, false, true).action).toBe("stop");
    expect(decideConfirmGate("up-to-review", "Unknown", false, false, true).action).toBe("stop");
    expect(decideConfirmGate("confirm", "Back", false, false, true)).toEqual({ action: "run" });
  });

  test("covers confirmation authority refusals for every non-confirm access cell", () => {
    expect(decideConfirmGate("read-only", "Confirm action", true, true).action).toBe("refuse");
    expect(decideConfirmGate("read-only", "Continue", true).action).toBe("refuse");
    expect(decideConfirmGate("up-to-review", "Continue", true).action).toBe("refuse");
    expect(decideConfirmGate(undefined, "Continue", true).action).toBe("refuse");
  });

  test("requires a review expect immediately before every mapped confirm click", () => {
    const labels = ["Send $<amount>"];
    expect(confirmReviewOrderError([
      { kind: "expect", text: "Confirm" },
      { kind: "click", label: "Send $1.00" },
    ], labels)).toBeNull();
    expect(confirmReviewOrderError([
      { kind: "expect", text: "Confirm" },
      { kind: "expect", text: "Network" },
      { kind: "click", label: "Send $1.00" },
    ], labels)).toContain("immediately precedes");
    expect(confirmReviewOrderError([
      { kind: "click", label: "Send $1.00" },
    ], labels)).toContain("immediately precedes");
  });

  test("refuses press and fills outside both the mapped and fixed live-safe field sets", () => {
    const to = { kind: "fill" as const, label: "To", value: "0x1" };
    expect(liveStepError("confirm", { kind: "press", key: "Enter" }, ["To"])).toContain("press");
    expect(liveStepError("confirm", to, ["To"])).toBeNull();
    expect(liveStepError("confirm", to, [])).toContain("unlisted or unsafe");
    expect(liveStepError("confirm", { kind: "fill", label: "Email", value: "a@example.com" }, ["Email"])).toContain("unlisted or unsafe");
    expect(liveStepError("read-only", { kind: "press", key: "Enter" }, [])).toBeNull();
  });
});

describe("live recipient policy", () => {
  test("defaults to the pinned jesse.base.eth recipient when the flag is absent", () => {
    expect(defaultLiveRecipient).toEqual({ name: "jesse.base.eth", address: defaultRecipient });
    expect(resolveLiveRecipient(undefined)).toEqual({ action: "use", recipient: defaultLiveRecipient });
  });

  test("maps the jesse.base.eth name to the pinned address", () => {
    expect(resolveLiveRecipient("jesse.base.eth")).toEqual({ action: "use", recipient: defaultLiveRecipient });
    expect(resolveLiveRecipient("JESSE.BASE.ETH")).toEqual({ action: "use", recipient: defaultLiveRecipient });
  });

  test("accepts a bare 0x address and refuses every other value", () => {
    expect(resolveLiveRecipient(address)).toEqual({ action: "use", recipient: { name: null, address } });
    for (const value of ["jesse", "0x1234", "jesse.base.eth.", "https://jesse.base.eth", ""]) {
      const resolution = resolveLiveRecipient(value);
      expect(resolution.action).toBe("refuse");
      if (resolution.action === "refuse") expect(resolution.reason).toContain("bare 0x address or jesse.base.eth");
    }
  });
});

describe("live review recipient row", () => {
  const recipient = defaultLiveRecipient.address;

  test("accepts a rendered To row that equals the effective recipient", () => {
    expect(recipientRowError(recipientReview(recipient), recipient)).toBeNull();
    expect(recipientRowError(recipientReview(recipient.toUpperCase()), recipient)).toBeNull();
    expect(recipientRowError(`Confirm\nTo ${recipient}\nAsset`, recipient)).toBeNull();
  });

  test("refuses the shared-format truncation even of the effective recipient", () => {
    expect(formatAddress(recipient)).toBe("0x2211…d77da9");
    expect(formatAddress(recipient)).not.toBe(recipient);
    expect(recipientRowError(recipientReview(formatAddress(recipient)), recipient)).toContain("instead");
    expect(recipientRowError(`Confirm\nTo\n${formatAddress(recipient)}\nAsset`, recipient)).toContain("instead");
  });

  test("refuses a review with more than one To row", () => {
    expect(recipientRowError(`Confirm\nTo\n${recipient}\nTo ${address}\nAsset`, recipient)).toContain("exactly one");
    expect(recipientRowError(`Confirm\nTo\n${recipient}\nTo\n${recipient}\nAsset`, recipient)).toContain("exactly one");
  });

  test("refuses an absent, empty, or mismatched To row", () => {
    expect(recipientRowError("Confirm\n$1.00\nAsset\nUSDC", recipient)).toContain("no “To” row");
    expect(recipientRowError("Confirm\nTo", recipient)).toContain("“To” row is empty");
    expect(recipientRowError(recipientReview("0x2222222222222222222222222222222222222222"), recipient)).toContain("instead");
    expect(recipientRowError(recipientReview(formatAddress(address)), recipient)).toContain("instead");
  });
});

describe("live recipient placeholder", () => {
  test("substitutes only the To fill step", () => {
    expect(isRecipientFillStep({ kind: "fill", label: "To", value: "<recipient>" })).toBe(true);
    expect(isRecipientFillStep({ kind: "fill", label: "Email", value: "<recipient>" })).toBe(false);
    expect(isRecipientFillStep({ kind: "fill", label: "To", value: address })).toBe(false);
    expect(isRecipientFillStep({ kind: "click", label: "<recipient>" })).toBe(false);
  });

  test("refuses the placeholder in any other step", () => {
    expect(recipientPlaceholderError([
      { kind: "goto", path: "/home" },
      { kind: "fill", label: "To", value: "<recipient>" },
      { kind: "click", label: "Continue" },
    ])).toBeNull();
    expect(recipientPlaceholderError([
      { kind: "fill", label: "Email", value: "<recipient>" },
    ])).toContain("outside");
    expect(recipientPlaceholderError([
      { kind: "fill", label: "To", value: "<recipient> 0x" },
    ])).toContain("outside");
    expect(recipientPlaceholderError([
      { kind: "expect", text: "To <recipient>" },
    ])).toContain("outside");
  });
});

describe("live amount cap", () => {
  test("parses exactly one distinct rendered USD amount", () => {
    expect(parseUsdAmount("Amount\n$1,234.50\nNetwork\nBase")).toBe(1234.5);
    expect(parseUsdAmount("You pay\nUS$ 25.50\nReceive\n25 USDC")).toBe(25.5);
    expect(parseUsdAmount("Confirm\n$1.00\nYou're sending USDC")).toBe(1);
    expect(parseUsdAmount("Confirm\n1 USDC\nNetwork\nBase\nFee\n$0.01")).toBe(0.01);
  });

  test("refuses fee-row-first and two-candidate reviews", () => {
    expect(parseUsdAmount("Fee\n$0.01\nAmount\n$1.00")).toBeNull();
    expect(parseUsdAmount("Amount\n$1.00\nTotal\n$2.00")).toBeNull();
    expect(reviewAndLabelAmountError(parseUsdAmount("Fee\n$0.01\nAmount\n$1.00"), 1)).toContain("exactly one");
  });

  test("refuses a mismatch between review and clicked label", () => {
    expect(parseUsdAmountFromLabel("Send $1.00")).toBe(1);
    expect(parseUsdAmountFromLabel("Confirm action")).toBeNull();
    expect(reviewAndLabelAmountError(1, 2)).toContain("does not match");
    expect(reviewAndLabelAmountError(1, 1)).toBeNull();
  });

  test("caps a borrow by its labelled received amount and records collateral separately", () => {
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

  test("refuses borrow reviews without a labelled received amount", () => {
    expect(parseBorrowReviewAmounts("Locked as collateral (cbBTC)\n0.0001 cbBTC\nLiquidation price\n$45,000.00")).toEqual({
      borrowedAmount: null,
      collateralAmount: "0.0001 cbBTC",
      borrowedAmountUsd: null,
    });
  });

  test("refuses unparseable, invalid-cap, and above-cap amounts", () => {
    expect(enforceAmountCap(parseUsdAmount("1 USDC"), 2)).toContain("could not be parsed");
    expect(enforceAmountCap(1, 0)).toContain("positive number");
    expect(enforceAmountCap(10.01, 10)).toContain("exceeds");
    expect(enforceAmountCap(10, 10)).toBeNull();
    expect(enforceCumulativeAmountCap(6, 5, 10)).toContain("run cap");
    expect(enforceCumulativeAmountCap(5, 5, 10)).toBeNull();
  });
});

describe("live browser origin observation", () => {
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
    for (const value of ["https://extra.example.com", "extra.example.com:443", "extra.example.com/path", "two hosts", "*.example.com"]) {
      expect(() => composeAllowedDomains(new URL("https://preview.example.com"), [value], false)).toThrow("bare hostname");
    }
  });

  test("refuses before confirmation when an observed hostname is not approved", () => {
    expect(hostObservationRefusal(["images.example.net"])).toContain("images.example.net");
    expect(hostObservationRefusal([])).toBeNull();
  });

  test("detects every observed hostname outside the approved set", () => {
    expect(unexpectedNetworkHosts([
      "https://preview.example.com/home",
      "https://api.cdp.coinbase.com/session",
      "https://images.example.net/a.png",
      "not a url",
      "https://images.example.net/b.png",
    ], ["preview.example.com", "api.cdp.coinbase.com"])).toEqual(["images.example.net"]);
  });
});

describe("live run guards", () => {
  test("reads the address only from the labelled Account section", async () => {
    await GlobalRegistrator.register();
    document.body.innerHTML = `<button title="0x2222222222222222222222222222222222222222">decoy</button><section aria-labelledby="account-heading"><h2 id="account-heading">Account</h2><button title="${address}">copy</button></section>`;
    expect(accountAddressFromDocument(document)).toBe(address);
    await GlobalRegistrator.unregister();
  });

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

  test("parses the text shape rendered by MoneyTicker", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "apps/web/verify/test-fixtures/money-ticker.ts"],
      cwd: resolve(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const rendered = JSON.parse(result.stdout.toString()) as { renderedText: string; parsedAmount: number | null };
    expect(rendered.renderedText).toContain("$1.00");
    expect(rendered.parsedAmount).toBe(1);
  });

  test("matches the recipient text rendered by the send review row components", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "apps/web/verify/test-fixtures/send-review-row.ts"],
      cwd: resolve(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const rendered = JSON.parse(result.stdout.toString()) as {
      rows: Array<{ label: string; value: string }>;
      renderedMatch: string | null;
      truncatedValue: string;
      truncatedMatch: string | null;
    };
    expect(rendered.rows).toContainEqual({ label: "To", value: defaultRecipient });
    expect(rendered.renderedMatch).toBeNull();
    expect(rendered.truncatedValue).toBe(formatAddress(defaultRecipient));
    expect(rendered.truncatedMatch).toContain("instead");
  });
});
