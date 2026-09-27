import { describe, expect, test } from "bun:test";
import { assertTransferRequest } from "./transfer-request";
import { getTransferAsset } from "./transfer-helpers";
import { TransferExecutionError, type TransferRequest } from "./types";

const request: TransferRequest = {
  assetId: "usdc",
  recipient: "0x2222222222222222222222222222222222222222",
  amountBaseUnits: "1000000",
};

describe("assertTransferRequest", () => {
  test("accepts a transfer with a normalized or mixed-case ENS recipient name", () => {
    expect(() => assertTransferRequest(request)).not.toThrow();
    expect(() => assertTransferRequest({ ...request, recipientName: "EXAMPLE.BASE.ETH" })).not.toThrow();
  });

  test("rejects invalid names, addresses, assets, and amounts", () => {
    const token = getTransferAsset("usdc")?.contractAddress;
    expect(token).not.toBeNull();
    for (const invalid of [
      { ...request, recipientName: "example" },
      { ...request, recipient: "0x0000000000000000000000000000000000000000" },
      { ...request, recipient: token! },
      { ...request, assetId: "unknown" },
      { ...request, amountBaseUnits: "0" },
    ]) {
      expect(() => assertTransferRequest(invalid as TransferRequest)).toThrow(TransferExecutionError);
    }
  });
});
