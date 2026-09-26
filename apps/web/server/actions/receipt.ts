import "server-only";

import {
  BaseRpcError,
  createBaseRpcClient,
  parseRpcQuantity,
} from "@/server/chain/rpc";

export const TRANSFER_RECEIPT_TIMEOUT_MS = 6_000;

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const wordPattern = /^0x[0-9a-fA-F]{64}$/;
const eventTopic = "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";
const entryPoints = new Set([
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789",
  "0x0000000071727de22e5e9d8baf0edac6f37da032",
  "0x4337084d9e255ff0702461cf8895ce9e3b5ff108",
]);
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type TransferReceiptStatus =
  | { status: "pending"; transactionHash: `0x${string}` }
  | {
      status: "confirmed";
      transactionHash: `0x${string}`;
      blockNumber: string;
      blockTimestamp: string;
      finalized: boolean;
      userOperations: Array<{ userOpHash: string; sender: string; success: boolean }>;
    };

export class TransferReceiptRpcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransferReceiptRpcError";
  }
}

export function normalizeTransactionHash(value: string): `0x${string}` {
  if (!transactionHashPattern.test(value)) {
    throw new TransferReceiptRpcError("The transaction hash is invalid.");
  }
  return value.toLowerCase() as `0x${string}`;
}

export function createTransferReceiptReader(
  options: {
    fetchImpl?: FetchLike;
    rpcUrl?: string;
    timeoutMs?: number;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? TRANSFER_RECEIPT_TIMEOUT_MS;
  const rpc = createBaseRpcClient({
    fetchImpl: options.fetchImpl ?? fetch,
    rpcUrl: options.rpcUrl,
    timeoutMs,
  });

  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 30_000
  ) {
    throw new TransferReceiptRpcError("The receipt timeout must be 1-30000ms.");
  }

  return async function readTransferReceipt(
    transactionHash: `0x${string}`,
    externalSignal?: AbortSignal,
  ): Promise<TransferReceiptStatus> {
    const normalizedHash = normalizeTransactionHash(transactionHash);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternal, {
      once: true,
    });

    try {
      const [chainResponse, receiptResponse, finalizedBlock] = await Promise.all([
        rpc.request("eth_chainId", [], controller.signal, 1),
        rpc.request("eth_getTransactionReceipt", [normalizedHash], controller.signal, 2),
        rpc.request("eth_getBlockByNumber", ["finalized", false], controller.signal, 3),
      ]);
      const finalizedNumber = isRecord(finalizedBlock)
        ? readQuantity(finalizedBlock.number, "finalized block number")
        : readQuantity(null, "finalized block number");
      if (readQuantity(chainResponse, "chain id") !== BigInt(8453)) {
        throw new TransferReceiptRpcError("The configured RPC is not Base mainnet.");
      }
      if (receiptResponse === null) {
        return { status: "pending", transactionHash: normalizedHash };
      }
      if (!isRecord(receiptResponse)) {
        throw new TransferReceiptRpcError(
          "Base RPC returned an invalid receipt.",
        );
      }
      const receiptHash = normalizeTransactionHash(
        readString(receiptResponse.transactionHash),
      );
      if (receiptHash !== normalizedHash) {
        throw new TransferReceiptRpcError(
          "Base RPC returned a mismatched receipt.",
        );
      }
      const blockNumber = readQuantity(
        receiptResponse.blockNumber,
        "block number",
      );
      const receiptBlockHash = receiptResponse.blockHash;
      if (typeof receiptBlockHash !== "string" || !wordPattern.test(receiptBlockHash)) {
        throw new TransferReceiptRpcError("Base RPC returned an invalid receipt.");
      }
      const normalizedReceiptBlockHash = receiptBlockHash.toLowerCase();
      const receiptStatus = readQuantity(receiptResponse.status, "receipt status");
      if (receiptStatus !== BigInt(0) && receiptStatus !== BigInt(1)) {
        throw new TransferReceiptRpcError("Base RPC returned an invalid receipt status.");
      }
      const block = await rpc.request("eth_getBlockByNumber", [receiptResponse.blockNumber, false], controller.signal, 4);
      if (!isRecord(block) || readQuantity(block.number, "block number") !== blockNumber ||
        typeof block.hash !== "string" || !wordPattern.test(block.hash) ||
        block.hash.toLowerCase() !== normalizedReceiptBlockHash) {
        throw new TransferReceiptRpcError("Base RPC returned a mismatched block.");
      }
      const timestamp = readQuantity(block.timestamp, "block timestamp");
      const timestampMs = Number(timestamp) * 1_000;
      if (!Number.isFinite(timestampMs) || Number.isNaN(new Date(timestampMs).getTime())) {
        throw new TransferReceiptRpcError("Base RPC returned an invalid block timestamp.");
      }
      return {
        status: "confirmed",
        transactionHash: normalizedHash,
        blockNumber: blockNumber.toString(10),
        blockTimestamp: new Date(timestampMs).toISOString(),
        finalized: blockNumber <= finalizedNumber,
        userOperations: readUserOperations(receiptResponse.logs),
      };
    } catch (error) {
      if (error instanceof TransferReceiptRpcError) throw error;
      throw new TransferReceiptRpcError(
        controller.signal.aborted
          ? "The Base receipt request timed out or was aborted."
          : "The Base receipt request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

function readUserOperations(value: unknown): Array<{ userOpHash: string; sender: string; success: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((log) => {
    if (!isRecord(log) || typeof log.address !== "string" || !entryPoints.has(log.address.toLowerCase()) ||
      !Array.isArray(log.topics) ||
      typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== eventTopic ||
      typeof log.topics[1] !== "string" || !wordPattern.test(log.topics[1]) ||
      typeof log.topics[2] !== "string" || !wordPattern.test(log.topics[2]) ||
      typeof log.data !== "string" || !/^0x(?:[0-9a-fA-F]{64}){4}$/.test(log.data)) return [];
    const success = log.data.slice(66, 130);
    if (success !== "0".repeat(64) && success !== `${"0".repeat(63)}1`) return [];
    return [{
      userOpHash: log.topics[1].toLowerCase(),
      sender: `0x${log.topics[2].slice(-40).toLowerCase()}`,
      success: success.endsWith("1"),
    }];
  });
}

function readQuantity(value: unknown, label: string): bigint {
  try {
    return parseRpcQuantity(value, label);
  } catch (error) {
    throw new TransferReceiptRpcError(`Base RPC returned an invalid ${label}.`, {
      cause: error instanceof BaseRpcError ? error : undefined,
    });
  }
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TransferReceiptRpcError(
      "Base RPC returned an invalid receipt hash.",
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
