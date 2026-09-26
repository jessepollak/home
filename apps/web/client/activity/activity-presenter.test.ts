import { describe, expect, test } from "bun:test";
import { presentActivityTransferRow } from "./activity-presenter";
import type { ActivityTransfer } from "./types";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

function transfer(direction: ActivityTransfer["direction"]): ActivityTransfer {
  return {
    id: `transfer-${direction}`, logId: direction, chainId: 8453, assetId: "usdc",
    tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null, walletAddress: WALLET,
    fromAddress: direction === "incoming" ? OTHER : WALLET,
    toAddress: direction === "outgoing" ? OTHER : WALLET, direction,
    amountBaseUnits: "1000001", blockNumber: "20", blockHash: `0x${"b".repeat(64)}`,
    transactionHash: `0x${"a".repeat(64)}`, logIndex: "1", blockTimestamp: "2026-09-07T11:05:00.000Z",
    valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
  };
}

describe("presentActivityTransferRow", () => {
  test("formats all transfer directions without inferring fiat", () => {
    expect(presentActivityTransferRow(transfer("incoming"), { timeZone: "UTC" })).toMatchObject({
      directionLabel: "Received", sign: "+", value: "+1.00 USDC", valueContext: null,
    });
    expect(presentActivityTransferRow(transfer("outgoing"), { timeZone: "UTC" })).toMatchObject({
      directionLabel: "Sent", sign: "−", value: "−1.00 USDC",
    });
    expect(presentActivityTransferRow(transfer("self"), { timeZone: "UTC" })).toMatchObject({
      directionLabel: "Self transfer", sign: "", value: "1.00 USDC",
    });
  });
});
