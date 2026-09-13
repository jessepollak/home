import { describe, expect, test } from "bun:test";
import {
  encodeErc20Transfer,
  encodeUsdcTransfer,
  formatSendConfirmAmount,
  formatTransferAmount,
  normalizeTransferRecipient,
  parseTransferAmount,
} from "./transfer-helpers";
import { TransferExecutionError } from "./types";

const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;

describe("transfer amount helpers", () => {
  test("parses human amounts into exact integer base units without floating point", () => {
    expect(parseTransferAmount("1.000001", 6)).toBe("1000001");
    expect(parseTransferAmount("0.000000000000000001", 18)).toBe("1");
    expect(formatTransferAmount("1000001", 6)).toBe("1.000001");
    expect(formatSendConfirmAmount("25000000", "usdc")).toBe("$25.00");
    expect(formatSendConfirmAmount("1000001", "usdc")).toBe("$1.000001");
    expect(formatSendConfirmAmount("1234560000", "usdc")).toBe("$1,234.56");
    expect(formatSendConfirmAmount("1", "eth")).toBe("0.000000000000000001\u00A0ETH");
    expect(formatSendConfirmAmount("100000", "cbbtc")).toBe("0.001\u00A0cbBTC");
  });

  test("rejects exponent notation, excess precision, zero, and malformed addresses", () => {
    for (const value of ["1e-6", "1.0000001", "0", "-1", ".5", "01"]) {
      expect(() => parseTransferAmount(value, 6)).toThrow(TransferExecutionError);
    }
    expect(() => normalizeTransferRecipient("0x1234")).toThrow(TransferExecutionError);
    expect(() => normalizeTransferRecipient("0x0000000000000000000000000000000000000000")).toThrow(TransferExecutionError);
  });

  test("encodes catalog ERC-20 transfers with the token as target", () => {
    expect(encodeUsdcTransfer(RECIPIENT, BigInt(1))).toBe(
      `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}`,
    );
    expect(encodeErc20Transfer(
      "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      RECIPIENT,
      BigInt(100_000),
    )).toEqual({
      to: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
      data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(100_000).toString(16).padStart(64, "0")}`,
      value: BigInt(0),
    });
  });
});
