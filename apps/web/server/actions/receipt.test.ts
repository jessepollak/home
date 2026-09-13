import { describe, expect, test } from "bun:test";
import {
  createTransferReceiptReader,
  normalizeTransactionHash,
} from "./receipt";

const HASH = `0x${"ab".repeat(32)}` as const;

describe("action receipt reader", () => {
  test("returns pending then confirmed Base receipts", async () => {
    let receipt: unknown = null;
    const readReceipt = createTransferReceiptReader({
      rpcUrl: "https://base.example",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: body.method === "eth_chainId" ? "0x2105" : receipt,
        });
      },
    });

    await expect(readReceipt(HASH)).resolves.toEqual({
      status: "pending",
      transactionHash: HASH,
    });

    receipt = { transactionHash: HASH, blockNumber: "0x10", status: "0x1" };
    await expect(readReceipt(HASH)).resolves.toEqual({
      status: "confirmed",
      transactionHash: HASH,
      blockNumber: "16",
      success: true,
    });
  });

  test("rejects malformed hashes and mismatched receipts", async () => {
    expect(() => normalizeTransactionHash("0x1234")).toThrow();
    const readReceipt = createTransferReceiptReader({
      rpcUrl: "https://base.example",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result:
            body.id === 1
              ? "0x2105"
              : {
                  transactionHash: `0x${"cd".repeat(32)}`,
                  blockNumber: "0x10",
                  status: "0x1",
                },
        });
      },
    });
    await expect(readReceipt(HASH)).rejects.toThrow("mismatched receipt");
  });
});
