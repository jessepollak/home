import "server-only";

import { decodeAbiParameters, decodeFunctionData, keccak256 } from "viem";
import { entryPoint06Abi, entryPoint07Abi, entryPoint08Abi } from "viem/account-abstraction";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { createBaseRpcClient, parseRpcQuantity } from "@/server/chain/rpc";
import { USER_OPERATION_ENTRY_POINTS, USER_OPERATION_EVENT_TOPIC } from "./receipt";
import type { ActionRow } from "./store";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const topicPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const FUTURE_SKEW_MS = 30_000;
const BLOCK_MS = 2_000;
const WINDOW_BLOCKS = BigInt(1_800);
const MARGIN_BLOCKS = BigInt(30);
const CHUNK_BLOCKS = BigInt(1_000);
const MAX_CHUNKS = 3;
const MAX_CALL_DATA_CANDIDATES = 8;
const hexDataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const EXECUTE_SELECTOR = "0xb61d27f6";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type UserOperationLogResolution =
  | { status: "complete"; transactionHash: `0x${string}`; code: "USEROP_LOG_V06" | "USEROP_LOG_V07" | "USEROP_LOG_V08" }
  | { status: "pending" }
  | { status: "unavailable" };

export type UserOperationCallDataMatch = { userOperationHash: `0x${string}`; transactionHash: `0x${string}` };
export type UserOperationCallDataResolution =
  | { status: "complete"; matches: UserOperationCallDataMatch[] }
  | { status: "pending" }
  | { status: "unavailable" };

export function createUserOperationLogLookup(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  now?: () => number;
} = {}) {
  const rpc = createBaseRpcClient({ fetchImpl: options.fetchImpl, rpcUrl: options.rpcUrl, timeoutMs: 2_500 });
  const now = options.now ?? Date.now;
  return async (row: ActionRow, signal?: AbortSignal): Promise<UserOperationLogResolution> => {
    const handle = row.provider_handle;
    const account = row.account_address;
    const confirmed = toMillis(row.confirmed_at);
    const recorded = toMillis(row.handle_recorded_at);
    const current = now();
    if (!handle || !hashPattern.test(handle) || !account || !addressPattern.test(account) ||
      confirmed === null || confirmed > current + FUTURE_SKEW_MS || signal?.aborted) return { status: "unavailable" };
    try {
      await rpc.assertBaseChain(signal);
      const latest = parseRpcQuantity(await rpc.request("eth_blockNumber", [], signal), "latest block");
      const earlier = windowFor(confirmed, current, latest);
      const later = recorded !== null && recorded > confirmed ? windowFor(recorded, current, latest) : null;
      const windowEnd = (later ?? earlier).end;
      const chunks = planScan(later ? [earlier.range, later.range] : [earlier.range], latest);
      const senderTopic = `0x${"0".repeat(24)}${account.slice(2).toLowerCase()}`;
      const matches: Array<{ transactionHash: `0x${string}`; code: "USEROP_LOG_V06" | "USEROP_LOG_V07" | "USEROP_LOG_V08" }> = [];
      const observed = new Set<string>();
      for (const chunk of chunks) {
        const logs = await rpc.request("eth_getLogs", [{
          fromBlock: `0x${chunk.first.toString(16)}`, toBlock: `0x${chunk.last.toString(16)}`,
          address: Object.values(USER_OPERATION_ENTRY_POINTS),
          topics: [USER_OPERATION_EVENT_TOPIC, handle.toLowerCase(), senderTopic],
        }], signal);
        if (!Array.isArray(logs)) return { status: "unavailable" };
        for (const log of logs) {
          if (!log || typeof log !== "object" || Array.isArray(log)) return { status: "unavailable" };
          const entry = log as Record<string, unknown>;
          if (typeof entry.address !== "string") return { status: "unavailable" };
          const address = entry.address.toLowerCase();
          if (!Object.values(USER_OPERATION_ENTRY_POINTS).some((entryPoint) => entryPoint === address)) continue;
          if (!Array.isArray(entry.topics)) return { status: "unavailable" };
          const topics: unknown[] = entry.topics;
          const eventTopic = lowerCaseTopic(topics[0]);
          const handleTopic = lowerCaseTopic(topics[1]);
          const logSenderTopic = lowerCaseTopic(topics[2]);
          if (eventTopic === undefined || handleTopic === undefined || logSenderTopic === undefined) return { status: "unavailable" };
          if (!topicPattern.test(eventTopic) || !topicPattern.test(handleTopic) || !topicPattern.test(logSenderTopic)) return { status: "unavailable" };
          if (eventTopic !== USER_OPERATION_EVENT_TOPIC || handleTopic !== handle.toLowerCase() || logSenderTopic !== senderTopic) continue;
          const hashValue = entry.transactionHash;
          if (typeof hashValue !== "string" || !hashPattern.test(hashValue)) return { status: "unavailable" };
          const transactionHash = hashValue.toLowerCase();
          const version = Object.entries(USER_OPERATION_ENTRY_POINTS).find(([, entryPoint]) => entryPoint === address)?.[0];
          if (version !== "V06" && version !== "V07" && version !== "V08") return { status: "unavailable" };
          const logKey = [address, transactionHash,
            typeof entry.logIndex === "string" ? entry.logIndex.toLowerCase() : "",
            topics.map((topic) => String(topic).toLowerCase()).join(",")].join("|");
          if (observed.has(logKey)) continue;
          observed.add(logKey);
          matches.push({ transactionHash: transactionHash as `0x${string}`, code: `USEROP_LOG_${version}` });
        }
        if (matches.length > 1) return { status: "unavailable" };
      }
      return matches.length === 1 ? { status: "complete", ...matches[0]! }
        : windowEnd > latest ? { status: "pending" } : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  };
}

export function createUserOperationCallDataLookup(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  now?: () => number;
} = {}) {
  const rpc = createBaseRpcClient({ fetchImpl: options.fetchImpl, rpcUrl: options.rpcUrl, timeoutMs: 2_500 });
  const now = options.now ?? Date.now;
  return async (row: ActionRow, signal?: AbortSignal): Promise<UserOperationCallDataResolution> => {
    const callDataHash = row.confirmed_call_data_hash?.toLowerCase();
    const account = row.account_address?.toLowerCase();
    const confirmed = toMillis(row.confirmed_at);
    const current = now();
    if (!callDataHash || !hashPattern.test(callDataHash) || !account || !addressPattern.test(account) ||
      confirmed === null || confirmed > current + FUTURE_SKEW_MS || signal?.aborted) return { status: "unavailable" };
    try {
      await rpc.assertBaseChain(signal);
      const latest = parseRpcQuantity(await rpc.request("eth_blockNumber", [], signal), "latest block");
      const window = windowFor(confirmed, current, latest);
      const senderTopic = `0x${"0".repeat(24)}${account.slice(2)}`;
      const candidates = new Map<string, CallDataCandidate>();
      for (const chunk of planScan([window.range], latest)) {
        const logs: unknown = await rpc.request("eth_getLogs", [{
          fromBlock: `0x${chunk.first.toString(16)}`, toBlock: `0x${chunk.last.toString(16)}`,
          address: Object.values(USER_OPERATION_ENTRY_POINTS),
          topics: [USER_OPERATION_EVENT_TOPIC, null, senderTopic],
        }], signal);
        if (!Array.isArray(logs)) return { status: "unavailable" };
        for (const log of logs) {
          const candidate = callDataCandidate(log, senderTopic);
          if (candidate === "invalid") return { status: "unavailable" };
          if (candidate) candidates.set(candidate.userOperationHash, candidate);
        }
      }
      if (candidates.size > MAX_CALL_DATA_CANDIDATES) return { status: "unavailable" };
      const noMatch: UserOperationCallDataResolution = window.end > latest ? { status: "pending" } : { status: "unavailable" };
      if (!candidates.size) return noMatch;
      const transactionHashes = [...new Set([...candidates.values()].map((candidate) => candidate.transactionHash))];
      const transactions = await rpc.batch(transactionHashes.map((hash) => ({ method: "eth_getTransactionByHash", params: [hash] })), signal);
      const inputs = new Map<string, { to: string; input: string }>();
      transactionHashes.forEach((hash, index) => {
        const transaction = transactions[index];
        if (!isRecord(transaction) || typeof transaction.to !== "string" || typeof transaction.input !== "string" ||
          !hexDataPattern.test(transaction.input) || typeof transaction.hash !== "string" || transaction.hash.toLowerCase() !== hash) return;
        inputs.set(hash, { to: transaction.to.toLowerCase(), input: transaction.input });
      });
      const matches = [...candidates.values()].filter((candidate) => {
        const transaction = inputs.get(candidate.transactionHash);
        if (!transaction || transaction.to !== USER_OPERATION_ENTRY_POINTS[candidate.version] || !isHex(transaction.input)) return false;
        const [operation, ...others] = handleOpsOperations(transaction.input, candidate.version)
          .filter((op) => op.sender === account && op.nonce === candidate.nonce);
        return operation !== undefined && others.length === 0 && committedCallDataHash(operation.callData) === callDataHash;
      }).sort((left, right) => left.block === right.block
        ? Number(left.logIndex - right.logIndex) : left.block < right.block ? -1 : 1);
      if (!matches.length) return noMatch;
      return { status: "complete", matches: matches.map(({ userOperationHash, transactionHash }) => ({ userOperationHash, transactionHash })) };
    } catch {
      return { status: "unavailable" };
    }
  };
}

type EntryPointVersion = keyof typeof USER_OPERATION_ENTRY_POINTS;
type CallDataCandidate = UserOperationCallDataMatch & { version: EntryPointVersion; nonce: bigint; block: bigint; logIndex: bigint };
const ENTRY_POINT_VERSIONS: readonly EntryPointVersion[] = ["V06", "V07", "V08"];

function callDataCandidate(log: unknown, senderTopic: string): CallDataCandidate | "invalid" | null {
  if (!isRecord(log) || typeof log.address !== "string" || !Array.isArray(log.topics) || typeof log.data !== "string" ||
    typeof log.transactionHash !== "string" || typeof log.blockNumber !== "string" || typeof log.logIndex !== "string") return "invalid";
  const address = log.address.toLowerCase();
  const version = ENTRY_POINT_VERSIONS.find((key) => USER_OPERATION_ENTRY_POINTS[key] === address);
  if (!version) return null;
  const topics: unknown[] = log.topics;
  if (lowerCaseTopic(topics[0]) !== USER_OPERATION_EVENT_TOPIC || lowerCaseTopic(topics[2]) !== senderTopic) return null;
  const userOperationHash = lowerCaseTopic(topics[1]);
  const transactionHash = log.transactionHash.toLowerCase();
  if (!isHex(userOperationHash) || !topicPattern.test(userOperationHash) || !isHex(transactionHash) || !hashPattern.test(transactionHash) ||
    !/^0x(?:[0-9a-fA-F]{64}){4}$/.test(log.data)) return "invalid";
  if (log.removed === true) return null;
  return { userOperationHash, transactionHash, version, nonce: BigInt(log.data.slice(0, 66)),
    block: parseRpcQuantity(log.blockNumber, "log block"), logIndex: parseRpcQuantity(log.logIndex, "log index") };
}

function handleOpsOperations(input: `0x${string}`, version: EntryPointVersion): Array<{ sender: string; nonce: bigint; callData: string }> {
  try {
    const decoded = version === "V06" ? decodeFunctionData({ abi: entryPoint06Abi, data: input })
      : version === "V07" ? decodeFunctionData({ abi: entryPoint07Abi, data: input }) : decodeFunctionData({ abi: entryPoint08Abi, data: input });
    if (decoded.functionName !== "handleOps") return [];
    const operations: unknown = decoded.args[0];
    if (!Array.isArray(operations)) return [];
    return operations.flatMap((operation: unknown) => isRecord(operation) && typeof operation.sender === "string" &&
      typeof operation.nonce === "bigint" && typeof operation.callData === "string"
      ? [{ sender: operation.sender.toLowerCase(), nonce: operation.nonce, callData: operation.callData.toLowerCase() }] : []);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && hexDataPattern.test(value);
}

function lowerCaseTopic(topic: unknown): string | undefined {
  return typeof topic === "string" ? topic.toLowerCase() : undefined;
}

function windowFor(anchorMs: number, nowMs: number, latest: bigint): { range: { first: bigint; last: bigint }; end: bigint } {
  const distance = BigInt(Math.ceil(Math.max(0, nowMs - anchorMs) / BLOCK_MS));
  const block = latest > distance ? latest - distance : BigInt(0);
  const end = block + WINDOW_BLOCKS + MARGIN_BLOCKS;
  return { range: { first: block > MARGIN_BLOCKS ? block - MARGIN_BLOCKS : BigInt(0), last: end }, end };
}

function planScan(ranges: Array<{ first: bigint; last: bigint }>, latest: bigint): Array<{ first: bigint; last: bigint }> {
  const groups = ranges.map((range) => chunksFor(range, latest)).filter((chunks) => chunks.length > 0);
  let total = groups.reduce((count, chunks) => count + chunks.length, 0);
  for (let index = 0; total > MAX_CHUNKS && index < groups.length; index += 1) {
    const chunks = groups[index]!;
    while (total > MAX_CHUNKS && chunks.length > 1) {
      chunks.splice(0, 2, { first: chunks[0]!.first, last: chunks[1]!.last });
      total -= 1;
    }
  }
  return groups.reverse().flat();
}

function chunksFor(range: { first: bigint; last: bigint }, latest: bigint): Array<{ first: bigint; last: bigint }> {
  const last = range.last < latest ? range.last : latest;
  const chunks: Array<{ first: bigint; last: bigint }> = [];
  for (let first = range.first; first <= last; first += CHUNK_BLOCKS) {
    chunks.push({ first, last: first + CHUNK_BLOCKS - BigInt(1) < last ? first + CHUNK_BLOCKS - BigInt(1) : last });
  }
  return chunks;
}

function toMillis(value: string | Date | null): number | null {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function committedCallDataHash(callData: string): string | null {
  if (!isHex(callData)) return null;
  if (!callData.startsWith(EXECUTE_SELECTOR)) return keccak256(callData).toLowerCase();
  try {
    const [to, value, data] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes" }], `0x${callData.slice(10)}`);
    return keccak256(encodeCoinbaseExecuteBatch([{ to, value: value.toString(), data }])).toLowerCase();
  } catch {
    return null;
  }
}
