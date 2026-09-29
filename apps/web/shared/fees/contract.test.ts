import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { operatorFeeAmount, parseOperatorFeeRecord, parseOperatorFeeSettings, parseRevenueDestination, OPERATOR_FEE_TOKEN } from "./contract";

const recipient = "0x1234567890123456789012345678901234567890" as const;

describe("operator fee settings", () => {
  test("accepts zero fee and a valid receive-only Base address without an operator payout allowlist", () => {
    expect(parseOperatorFeeSettings({ trade: { bps: 0, recipient: null } })).toEqual({ trade: { bps: 0, recipient: null } });
    expect(parseOperatorFeeSettings({ trade: { bps: 300, recipient } })).toEqual({ trade: { bps: 300, recipient } });
    expect(parseRevenueDestination(recipient)).toBe(recipient);
  });
  test.each([-1, 301, 0.1, NaN])("rejects invalid basis points %s", (bps) => {
    expect(parseOperatorFeeSettings({ trade: { bps, recipient } })).toBeNull();
  });
  test("requires a recipient for nonzero rates and rejects invalid, mixed-case bad checksum, and zero addresses", () => {
    expect(parseOperatorFeeSettings({ trade: { bps: 1, recipient: null } })).toBeNull();
    expect(parseRevenueDestination("not-an-address")).toBeNull();
    expect(parseRevenueDestination("0x0000000000000000000000000000000000000000")).toBeNull();
    const checksummed = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    const badChecksum = checksummed.replace(/[a-fA-F]/, (letter) => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase());
    expect(parseRevenueDestination(badChecksum)).toBeNull();
    expect(parseRevenueDestination(checksummed)).toBe(checksummed.toLowerCase() as `0x${string}`);
  });
});

describe("operator fee records", () => {
  test("floors the fee in customer favour and validates a normalized USDC record", () => {
    expect(operatorFeeAmount(BigInt(999), 30)).toBe(BigInt(2));
    expect(operatorFeeAmount(BigInt(33), 300)).toBe(BigInt(0));
    expect(operatorFeeAmount(BigInt(34), 300)).toBe(BigInt(1));
    const record = { amountBaseUnits: "1", token: OPERATOR_FEE_TOKEN, bps: 300, recipient, collectedBy: "in-batch-transfer" as const };
    expect(parseOperatorFeeRecord(record)).toEqual(record);
    expect(parseOperatorFeeRecord({ ...record, amountBaseUnits: "0" })).toBeNull();
    expect(parseOperatorFeeRecord({ ...record, bps: 301 })).toBeNull();
  });
});
