import { describe, expect, test } from "bun:test";
import { createTransferReceiptReader, normalizeTransactionHash, TransferReceiptRpcError } from "./receipt";

const HASH = `0x${"ab".repeat(32)}` as const;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const event = "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const log = (success: string, address: string = ENTRY_POINT) => ({
  address,
  topics: [event, HASH, `0x${"0".repeat(24)}${ACCOUNT.slice(2)}`],
  data: `0x${"0".repeat(64)}${success}${"0".repeat(128)}`,
});

function reader(receipt: unknown, block: unknown = { number: "0x10", hash: `0x${BLOCK_HASH.slice(2).toUpperCase()}`, timestamp: "0x6a" }, finalized: unknown = { number: "0x10" }) {
  return createTransferReceiptReader({
    rpcUrl: "https://base.example",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
      return Response.json({ jsonrpc: "2.0", id: body.id,
        result: body.method === "eth_chainId" ? "0x2105"
          : body.method === "eth_getTransactionReceipt" ? receipt
            : body.params[0] === "finalized" ? finalized : block });
    },
  });
}

describe("action receipt reader", () => {
  test("reads only EntryPoint-emitted operation results with block time, not bundle status", async () => {
    await expect(reader(null)(HASH)).resolves.toEqual({ status: "pending", transactionHash: HASH });
    const receipt = { transactionHash: HASH, blockNumber: "0x10", blockHash: BLOCK_HASH, status: "0x1", logs: [
      log(`${"0".repeat(63)}1`), log("0".repeat(64)), log(`${"0".repeat(63)}2`),
      { ...log("0".repeat(64)), topics: [event, "0x1"] },
      log("0".repeat(64), ACCOUNT), { ...log("0".repeat(64)), address: undefined },
    ] };
    await expect(reader(receipt)(HASH)).resolves.toEqual({ status: "confirmed", transactionHash: HASH,
      blockNumber: "16", blockTimestamp: "1970-01-01T00:01:46.000Z", finalized: true,
      userOperations: [{ userOpHash: HASH, sender: ACCOUNT, success: true },
        { userOpHash: HASH, sender: ACCOUNT, success: false }] });
  });

  test("reads finalized head before the canonical receipt block and defers non-finalized results", async () => {
    const requests: string[] = [];
    const receipt = { transactionHash: HASH, blockNumber: "0x10", blockHash: BLOCK_HASH, status: "0x1", logs: [] };
    const read = createTransferReceiptReader({ rpcUrl: "https://base.example", fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: string[] };
      requests.push(`${body.method}:${body.params[0] ?? ""}`);
      return Response.json({ jsonrpc: "2.0", id: body.id, result: body.method === "eth_chainId" ? "0x2105"
        : body.method === "eth_getTransactionReceipt" ? receipt
          : body.params[0] === "finalized" ? { number: "0xf" }
            : { number: "0x10", hash: BLOCK_HASH, timestamp: "0x6a" } });
    } });
    expect((await read(HASH)).status).toBe("confirmed");
    expect(await read(HASH)).toMatchObject({ finalized: false });
    expect(requests.indexOf("eth_getBlockByNumber:finalized")).toBeLessThan(requests.indexOf("eth_getBlockByNumber:0x10"));
    await expect(reader(receipt, undefined, { number: "invalid" })(HASH)).rejects.toBeInstanceOf(TransferReceiptRpcError);
    await expect(reader(receipt, undefined, null)(HASH)).rejects.toBeInstanceOf(TransferReceiptRpcError);
  });

  test("rejects malformed hashes, mismatched receipts, and unavailable or mismatched blocks", async () => {
    expect(() => normalizeTransactionHash("0x1234")).toThrow();
    await expect(reader({ transactionHash: `0x${"cd".repeat(32)}`, blockNumber: "0x10", blockHash: BLOCK_HASH, status: "0x1" })(HASH)).rejects.toThrow("mismatched receipt");
    for (const block of [null, { number: "0x11", hash: BLOCK_HASH, timestamp: "0x6a" }, { number: "0x10", hash: BLOCK_HASH, timestamp: "invalid" }]) {
      await expect(reader({ transactionHash: HASH, blockNumber: "0x10", blockHash: BLOCK_HASH, status: "0x1" }, block)(HASH)).rejects.toBeInstanceOf(TransferReceiptRpcError);
    }
  });

  test("rejects a same-height block whose hash differs from the receipt", async () => {
    const receipt = { transactionHash: HASH, blockNumber: "0x10", blockHash: BLOCK_HASH, status: "0x1" };
    const block = { number: "0x10", hash: `0x${"ef".repeat(32)}`, timestamp: "0x6a" };
    const result = reader(receipt, block)(HASH);
    await expect(result).rejects.toBeInstanceOf(TransferReceiptRpcError);
    await expect(result).rejects.toThrow("Base RPC returned a mismatched block.");
  });

  test("rejects a receipt with a missing or malformed block hash", async () => {
    for (const receipt of [
      { transactionHash: HASH, blockNumber: "0x10", status: "0x1" },
      { transactionHash: HASH, blockNumber: "0x10", blockHash: "0x1234", status: "0x1" },
    ]) {
      const result = reader(receipt)(HASH);
      await expect(result).rejects.toBeInstanceOf(TransferReceiptRpcError);
      await expect(result).rejects.toThrow("Base RPC returned an invalid receipt.");
    }
  });
});
