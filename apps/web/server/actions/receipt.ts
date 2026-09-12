import {
  BaseRpcError,
  createBaseRpcClient,
  parseRpcQuantity,
} from "@/server/chain/rpc";

export const TRANSFER_RECEIPT_TIMEOUT_MS = 6_000;

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
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
      success: boolean;
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
      const [chainResponse, receiptResponse] = await Promise.all([
        rpc.request("eth_chainId", [], controller.signal, 1),
        rpc.request("eth_getTransactionReceipt", [normalizedHash], controller.signal, 2),
      ]);
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
      const receiptStatus = readQuantity(
        receiptResponse.status,
        "receipt status",
      );
      if (receiptStatus !== BigInt(0) && receiptStatus !== BigInt(1)) {
        throw new TransferReceiptRpcError(
          "Base RPC returned an invalid receipt status.",
        );
      }
      return {
        status: "confirmed",
        transactionHash: normalizedHash,
        blockNumber: blockNumber.toString(10),
        success: receiptStatus === BigInt(1),
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
