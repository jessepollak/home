import { createHash } from "node:crypto";
import { decodeFunctionData, type Hex } from "viem";
import {
  entryPoint06Abi,
  entryPoint06Address,
  entryPoint07Abi,
  entryPoint07Address,
  entryPoint08Abi,
  entryPoint08Address,
} from "viem/account-abstraction";
import type { AccountProvider } from "@/features/account/session-types";
import type { MoneyActionCall } from "@/features/money-actions/types";
import { resolveBaseRpcUrl } from "@/server/portfolio/rpc";

export const TRANSFER_RECEIPT_TIMEOUT_MS = 6_000;

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const wordPattern = /^0x[0-9a-fA-F]{64}$/;
const USER_OPERATION_EVENT_TOPIC =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";
const ENTRY_POINT_ABIS = new Map<string, readonly unknown[]>([
  [entryPoint06Address.toLowerCase(), entryPoint06Abi],
  [entryPoint07Address.toLowerCase(), entryPoint07Abi],
  [entryPoint08Address.toLowerCase(), entryPoint08Abi],
]);
const COINBASE_ACCOUNT_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeBatch",
    stateMutability: "payable",
    inputs: [{
      name: "calls",
      type: "tuple[]",
      components: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    }],
    outputs: [],
  },
] as const;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type UserOperationProof = {
  userOperationHash: `0x${string}`;
  sender: `0x${string}`;
};

export type MoneyActionExecutionProof = {
  accountProvider: AccountProvider;
  sender: `0x${string}`;
  expectedCalls: MoneyActionCall[];
  notBefore: string;
  userOperationHash?: `0x${string}`;
};

export type VerifiedExecutionIdentity = {
  chainId: 8453;
  kind: "user-operation" | "transaction";
  hash: `0x${string}`;
};

export type TransferReceiptStatus =
  | { status: "pending"; transactionHash: `0x${string}` }
  | {
      status: "unresolved";
      transactionHash: `0x${string}`;
      reason: "operation-proof-missing" | "operation-mismatch" | "operation-too-old";
    }
  | {
      status: "confirmed";
      transactionHash: `0x${string}`;
      blockNumber: string;
      success: boolean;
      verifiedExecution?: VerifiedExecutionIdentity;
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

export function normalizeAddress(value: string): `0x${string}` {
  if (!addressPattern.test(value)) {
    throw new TransferReceiptRpcError("The sender address is invalid.");
  }
  return value.toLowerCase() as `0x${string}`;
}

export function createTransferReceiptReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? TRANSFER_RECEIPT_TIMEOUT_MS;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new TransferReceiptRpcError("The receipt timeout must be 1-30000ms.");
  }

  return async function readTransferReceipt(
    transactionHash: `0x${string}`,
    proof?: UserOperationProof | MoneyActionExecutionProof,
    externalSignal?: AbortSignal,
  ): Promise<TransferReceiptStatus> {
    const normalizedHash = normalizeTransactionHash(transactionHash);
    const normalizedProof = normalizeProof(proof);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

    try {
      const requests = [
        rpc(fetchImpl, rpcUrl, 1, "eth_chainId", [], controller.signal),
        rpc(fetchImpl, rpcUrl, 2, "eth_getTransactionReceipt", [normalizedHash], controller.signal),
        ...(isMoneyActionProof(normalizedProof)
          ? [rpc(fetchImpl, rpcUrl, 3, "eth_getTransactionByHash", [normalizedHash], controller.signal)]
          : []),
      ];
      const [chainResponse, receiptResponse, transactionResponse] = await Promise.all(requests);
      if (readQuantity(chainResponse, "chain id") !== BigInt(8453)) {
        throw new TransferReceiptRpcError("The configured RPC is not Base mainnet.");
      }
      if (receiptResponse === null) {
        return { status: "pending", transactionHash: normalizedHash };
      }
      if (!isRecord(receiptResponse)) {
        throw new TransferReceiptRpcError("Base RPC returned an invalid receipt.");
      }
      const receiptHash = normalizeTransactionHash(readString(receiptResponse.transactionHash));
      if (receiptHash !== normalizedHash) {
        throw new TransferReceiptRpcError("Base RPC returned a mismatched receipt.");
      }
      const blockNumber = readQuantity(receiptResponse.blockNumber, "block number");
      const receiptStatus = readQuantity(receiptResponse.status, "receipt status");
      if (receiptStatus !== BigInt(0) && receiptStatus !== BigInt(1)) {
        throw new TransferReceiptRpcError("Base RPC returned an invalid receipt status.");
      }

      if (isMoneyActionProof(normalizedProof)) {
        if (!isRecord(transactionResponse)) {
          return unresolved(normalizedHash, "operation-proof-missing");
        }
        const transactionReceiptHash = normalizeTransactionHash(readString(transactionResponse.hash));
        if (transactionReceiptHash !== normalizedHash) {
          throw new TransferReceiptRpcError("Base RPC returned a mismatched transaction.");
        }
        const block = await rpc(
          fetchImpl,
          rpcUrl,
          4,
          "eth_getBlockByNumber",
          [`0x${blockNumber.toString(16)}`, false],
          controller.signal,
        );
        if (!isRecord(block)) return unresolved(normalizedHash, "operation-proof-missing");
        const blockTimestamp = readQuantity(block.timestamp, "block timestamp");
        if (blockTimestamp * BigInt(1000) + BigInt(999) < BigInt(Date.parse(normalizedProof.notBefore))) {
          return unresolved(normalizedHash, "operation-too-old");
        }
        const execution = verifyMoneyActionExecution(
          normalizedHash,
          transactionResponse,
          receiptResponse.logs,
          normalizedProof,
          receiptStatus === BigInt(1),
        );
        if (execution === null) return unresolved(normalizedHash, "operation-proof-missing");
        if (execution === "mismatch") return unresolved(normalizedHash, "operation-mismatch");
        return {
          status: "confirmed",
          transactionHash: normalizedHash,
          blockNumber: blockNumber.toString(10),
          success: execution.success,
          verifiedExecution: execution.verifiedExecution,
        };
      }

      if (receiptStatus === BigInt(0)) {
        return {
          status: "confirmed",
          transactionHash: normalizedHash,
          blockNumber: blockNumber.toString(10),
          success: false,
        };
      }
      if (normalizedProof) {
        const operationSuccess = readUserOperationSuccess(receiptResponse.logs, normalizedProof);
        if (operationSuccess === null) return unresolved(normalizedHash, "operation-proof-missing");
        return {
          status: "confirmed",
          transactionHash: normalizedHash,
          blockNumber: blockNumber.toString(10),
          success: operationSuccess,
        };
      }
      return {
        status: "confirmed",
        transactionHash: normalizedHash,
        blockNumber: blockNumber.toString(10),
        success: true,
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

function normalizeProof(
  proof?: UserOperationProof | MoneyActionExecutionProof,
): UserOperationProof | MoneyActionExecutionProof | undefined {
  if (!proof) return undefined;
  if (isMoneyActionProof(proof)) {
    const notBefore = Date.parse(proof.notBefore);
    if (!Number.isFinite(notBefore) || proof.expectedCalls.length < 1 || proof.expectedCalls.length > 8) {
      throw new TransferReceiptRpcError("The expected operation proof is invalid.");
    }
    return {
      accountProvider: proof.accountProvider,
      sender: normalizeAddress(proof.sender),
      expectedCalls: proof.expectedCalls.map((call) => ({
        ...call,
        to: normalizeAddress(call.to),
        data: normalizeHex(call.data),
        value: BigInt(call.value).toString(10),
      })),
      notBefore: new Date(notBefore).toISOString(),
      ...(proof.userOperationHash
        ? { userOperationHash: normalizeTransactionHash(proof.userOperationHash) }
        : {}),
    };
  }
  return {
    userOperationHash: normalizeTransactionHash(proof.userOperationHash),
    sender: normalizeAddress(proof.sender),
  };
}

function isMoneyActionProof(
  proof: UserOperationProof | MoneyActionExecutionProof | undefined,
): proof is MoneyActionExecutionProof {
  return Boolean(proof && "expectedCalls" in proof);
}

function verifyMoneyActionExecution(
  transactionHash: `0x${string}`,
  transaction: Record<string, unknown>,
  logs: unknown,
  proof: MoneyActionExecutionProof,
  outerSuccess: boolean,
): { success: boolean; verifiedExecution: VerifiedExecutionIdentity } | "mismatch" | null {
  const input = typeof transaction.input === "string" ? normalizeHex(transaction.input) : null;
  const to = typeof transaction.to === "string" ? normalizeAddress(transaction.to) : null;
  const from = typeof transaction.from === "string" ? normalizeAddress(transaction.from) : null;
  const value = readQuantity(transaction.value, "transaction value");
  if (!input || !to || !from) return null;

  if (
    proof.accountProvider === "base-account" &&
    !proof.userOperationHash &&
    from === proof.sender &&
    proof.expectedCalls.length === 1
  ) {
    const actual = [{ to, data: input, value: value.toString(10) }];
    return sameCalls(actual, proof.expectedCalls)
      ? {
          success: outerSuccess,
          verifiedExecution: { chainId: 8453, kind: "transaction", hash: transactionHash },
        }
      : "mismatch";
  }

  const entryPointAbi = ENTRY_POINT_ABIS.get(to);
  if (!entryPointAbi) return null;
  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({ abi: entryPointAbi, data: input });
  } catch {
    return null;
  }
  if (decoded.functionName !== "handleOps" || !Array.isArray(decoded.args) || !Array.isArray(decoded.args[0])) {
    return null;
  }
  const operations = decoded.args[0].filter((operation): operation is Record<string, unknown> =>
    isRecord(operation) && typeof operation.sender === "string" &&
    normalizeAddress(operation.sender) === proof.sender
  );
  const matchingIndexes: number[] = [];
  operations.forEach((operation, index) => {
    if (typeof operation.callData !== "string") return;
    const calls = decodeCoinbaseAccountCalls(normalizeHex(operation.callData));
    if (calls && sameCalls(calls, proof.expectedCalls)) matchingIndexes.push(index);
  });
  if (matchingIndexes.length === 0) return operations.length > 0 ? "mismatch" : null;
  if (!outerSuccess) return null;

  const events = readUserOperationEvents(logs, proof.sender);
  if (events.length !== operations.length) return null;
  let event: (typeof events)[number] | undefined;
  if (proof.accountProvider === "cdp-embedded") {
    if (!proof.userOperationHash) return "mismatch";
    const hashEvents = events.filter(
      (candidate) => candidate.userOperationHash === proof.userOperationHash,
    );
    if (hashEvents.length !== 1) return hashEvents.length === 0 ? "mismatch" : null;
    event = hashEvents[0];
    const matchingCandidates = matchingIndexes.filter(
      (index) => operationNonce(operations[index]) === event?.nonce,
    );
    if (matchingCandidates.length !== 1) {
      return matchingCandidates.length === 0 ? "mismatch" : null;
    }
  } else {
    if (proof.userOperationHash) return "mismatch";
    if (matchingIndexes.length !== 1) return null;
    const nonce = operationNonce(operations[matchingIndexes[0]]);
    if (nonce === null) return null;
    const nonceEvents = events.filter((candidate) => candidate.nonce === nonce);
    if (nonceEvents.length !== 1) return null;
    event = nonceEvents[0];
  }
  if (!event) return null;
  return {
    success: event.success,
    verifiedExecution: {
      chainId: 8453,
      kind: "user-operation",
      hash: event.userOperationHash,
    },
  };
}

function decodeCoinbaseAccountCalls(data: Hex): MoneyActionCall[] | null {
  try {
    const decoded = decodeFunctionData({ abi: COINBASE_ACCOUNT_ABI, data });
    if (decoded.functionName === "execute") {
      const [to, value, callData] = decoded.args;
      return [{
        to: normalizeAddress(to),
        value: value.toString(10),
        data: normalizeHex(callData),
      }];
    }
    if (decoded.functionName === "executeBatch") {
      return decoded.args[0].map((call) => ({
        to: normalizeAddress(call.target),
        value: call.value.toString(10),
        data: normalizeHex(call.data),
      }));
    }
  } catch {
    return null;
  }
  return null;
}

function sameCalls(actual: MoneyActionCall[], expected: MoneyActionCall[]): boolean {
  return actual.length === expected.length && actual.every((call, index) => {
    const wanted = expected[index];
    const dataMatches = wanted.dataHash
      ? createHash("sha256").update(call.data).digest("hex") === wanted.dataHash
      : call.data === wanted.data;
    return call.to === wanted.to && dataMatches && call.value === wanted.value;
  });
}

function operationNonce(operation: Record<string, unknown> | undefined): bigint | null {
  return operation && typeof operation.nonce === "bigint" ? operation.nonce : null;
}

function readUserOperationEvents(
  logsValue: unknown,
  sender: `0x${string}`,
): Array<{ userOperationHash: `0x${string}`; nonce: bigint; success: boolean }> {
  if (!Array.isArray(logsValue)) return [];
  const senderTopic = `0x${"0".repeat(24)}${sender.slice(2)}`;
  const events: Array<{ userOperationHash: `0x${string}`; nonce: bigint; success: boolean }> = [];
  for (const value of logsValue) {
    if (!isRecord(value) || typeof value.address !== "string") continue;
    if (!ENTRY_POINT_ABIS.has(value.address.toLowerCase())) continue;
    if (!Array.isArray(value.topics) || value.topics.length < 4) continue;
    const topics = value.topics;
    if (
      typeof topics[0] !== "string" ||
      typeof topics[1] !== "string" ||
      typeof topics[2] !== "string" ||
      typeof topics[3] !== "string" ||
      topics[0].toLowerCase() !== USER_OPERATION_EVENT_TOPIC ||
      topics[2].toLowerCase() !== senderTopic ||
      !transactionHashPattern.test(topics[1]) ||
      !wordPattern.test(topics[3]) ||
      typeof value.data !== "string" ||
      !/^0x[0-9a-fA-F]{256}$/.test(value.data)
    ) continue;
    const nonceWord = `0x${value.data.slice(2, 66)}`;
    const successWord = `0x${value.data.slice(66, 130)}`;
    if (!wordPattern.test(nonceWord) || !wordPattern.test(successWord)) continue;
    const success = BigInt(successWord);
    if (success !== BigInt(0) && success !== BigInt(1)) continue;
    events.push({
      userOperationHash: topics[1].toLowerCase() as `0x${string}`,
      nonce: BigInt(nonceWord),
      success: success === BigInt(1),
    });
  }
  return events;
}

function readUserOperationSuccess(
  logsValue: unknown,
  proof: UserOperationProof,
): boolean | null {
  const events = readUserOperationEvents(logsValue, proof.sender)
    .filter((event) => event.userOperationHash === proof.userOperationHash);
  return events.length === 1 ? events[0].success : null;
}

function unresolved(
  transactionHash: `0x${string}`,
  reason: Extract<TransferReceiptStatus, { status: "unresolved" }>["reason"],
): TransferReceiptStatus {
  return { status: "unresolved", transactionHash, reason };
}

function normalizeHex(value: string): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TransferReceiptRpcError("Base RPC returned invalid calldata.");
  }
  return value.toLowerCase() as Hex;
}

export const getTransferReceipt = createTransferReceiptReader();

async function rpc(
  fetchImpl: FetchLike,
  rpcUrl: string,
  id: number,
  method: string,
  params: unknown[],
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new TransferReceiptRpcError("Base RPC transport failed.", { cause: error });
  }
  if (!response.ok) {
    throw new TransferReceiptRpcError(`Base RPC returned HTTP ${response.status}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new TransferReceiptRpcError("Base RPC returned malformed JSON.", { cause: error });
  }
  if (
    !isRecord(value) ||
    value.jsonrpc !== "2.0" ||
    value.id !== id ||
    !("result" in value) ||
    "error" in value
  ) {
    throw new TransferReceiptRpcError("Base RPC returned an invalid response.");
  }
  return value.result;
}

function readQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw new TransferReceiptRpcError(`Base RPC returned an invalid ${label}.`);
  }
  return BigInt(value);
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TransferReceiptRpcError("Base RPC returned an invalid receipt hash.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
