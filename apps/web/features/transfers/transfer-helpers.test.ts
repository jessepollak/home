import { describe, expect, test } from "bun:test";
import {
  buildTransferCall,
  encodeUsdcTransfer,
  formatSendConfirmAmount,
  formatTransferAmount,
  normalizeTransferRecipient,
  parseTransferAmount,
} from "./transfer-helpers";
import { TransferExecutionError } from "./types";

const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;

describe("transfer amount and call helpers", () => {
  test("parses human amounts into exact integer base units without floating point", () => {
    expect(parseTransferAmount("1.000001", 6)).toBe("1000001");
    expect(parseTransferAmount("0.000000000000000001", 18)).toBe("1");
    expect(formatTransferAmount("1000001", 6)).toBe("1.000001");
    expect(formatSendConfirmAmount("25000000", "usdc")).toBe("$25.00");
    expect(formatSendConfirmAmount("1000001", "usdc")).toBe("$1.000001");
    expect(formatSendConfirmAmount("1", "eth")).toBe("0.000000000000000001 ETH");
  });

  test("rejects exponent notation, excess precision, zero, and malformed addresses", () => {
    for (const value of ["1e-6", "1.0000001", "0", "-1", ".5", "01"]) {
      expect(() => parseTransferAmount(value, 6)).toThrow(TransferExecutionError);
    }
    expect(() => normalizeTransferRecipient("0x1234")).toThrow(
      TransferExecutionError,
    );
    expect(() =>
      normalizeTransferRecipient("0x0000000000000000000000000000000000000000"),
    ).toThrow(TransferExecutionError);
  });

  test("rejects sending USDC to its own token contract while allowing self transfers", () => {
    expect(() =>
      buildTransferCall({
        assetId: "usdc",
        recipient: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amountBaseUnits: "1",
      }),
    ).toThrow();
    expect(() =>
      buildTransferCall({
        assetId: "usdc",
        recipient: RECIPIENT,
        amountBaseUnits: "1",
      }),
    ).not.toThrow();
  });

  test("encodes the canonical USDC transfer selector and uint256 arguments", () => {
    expect(encodeUsdcTransfer(RECIPIENT, BigInt(1))).toBe(
      `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}`,
    );
    expect(
      buildTransferCall({
        assetId: "usdc",
        recipient: RECIPIENT,
        amountBaseUnits: "2500000",
      }),
    ).toEqual({
      to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      value: BigInt(0),
      data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(2500000)
        .toString(16)
        .padStart(64, "0")}`,
    });
  });

  test("builds native ETH transfer values as exact bigint wei", () => {
    expect(
      buildTransferCall({
        assetId: "eth",
        recipient: RECIPIENT,
        amountBaseUnits: "100000000000000001",
      }),
    ).toEqual({
      to: RECIPIENT,
      value: BigInt("100000000000000001"),
      data: "0x",
    });
  });
});
