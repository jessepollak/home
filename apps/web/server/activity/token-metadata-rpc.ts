import "server-only";

import {
  decodeFunctionResult,
  encodeFunctionData,
  hexToBytes,
  type Hex,
} from "viem";
import { createBaseRpcClient } from "@/server/chain/rpc";
import {
  decodeAggregate3,
  encodeAggregate3,
  MULTICALL3_ADDRESS,
} from "@/server/balances/abi";

export const ACTIVITY_TOKEN_RPC_BATCH_MAX = 25;
export const ACTIVITY_TOKEN_RPC_CACHE_MAX = 512;
export const ACTIVITY_TOKEN_RPC_CACHE_TTL_MS = 5 * 60 * 1000;
export const ACTIVITY_TOKEN_RPC_TIMEOUT_MS = 3_000;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const decimalsAbi = [{
  type: "function",
  name: "decimals",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }],
}] as const;
const symbolStringAbi = [{
  type: "function",
  name: "symbol",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "string" }],
}] as const;
const symbolBytes32Abi = [{
  type: "function",
  name: "symbol",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "bytes32" }],
}] as const;

export type ActivityOnchainTokenResult =
  | { kind: "metadata"; symbol: string; decimals: number }
  | { kind: "nft-like" }
  | { kind: "unknown" };

type Rpc = {
  request(
    method: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown>;
  assertBaseChain(signal?: AbortSignal): Promise<void>;
};

type CacheEntry = {
  storedAt: number;
  value: ActivityOnchainTokenResult;
};

export function createActivityTokenRpcResolver(options: {
  rpc?: Rpc;
  now?: () => Date;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  timeoutMs?: number;
} = {}) {
  const rpc = options.rpc ?? createBaseRpcClient({
    timeoutMs: ACTIVITY_TOKEN_RPC_TIMEOUT_MS,
  });
  const now = options.now ?? (() => new Date());
  const cacheTtlMs = options.cacheTtlMs ?? ACTIVITY_TOKEN_RPC_CACHE_TTL_MS;
  const cacheMaxEntries = options.cacheMaxEntries ?? ACTIVITY_TOKEN_RPC_CACHE_MAX;
  const timeoutMs = options.timeoutMs ?? ACTIVITY_TOKEN_RPC_TIMEOUT_MS;
  const cache = new Map<string, CacheEntry>();
  let chainAssertion: Promise<void> | null = null;

  return async function resolveActivityTokenRpcMetadata(
    addresses: readonly `0x${string}`[],
    signal?: AbortSignal,
  ): Promise<Map<string, ActivityOnchainTokenResult>> {
    const unique = [...new Set(addresses.flatMap((address) => {
      const normalized = address.toLowerCase();
      return addressPattern.test(normalized) ? [normalized as `0x${string}`] : [];
    }))].slice(0, ACTIVITY_TOKEN_RPC_BATCH_MAX);
    const currentTime = now().getTime();
    const result = new Map<string, ActivityOnchainTokenResult>();
    const missing: `0x${string}`[] = [];

    for (const address of unique) {
      const cached = cache.get(address);
      if (
        cached &&
        Number.isFinite(currentTime) &&
        currentTime - cached.storedAt <= cacheTtlMs
      ) {
        cache.delete(address);
        cache.set(address, cached);
        result.set(address, cached.value);
      } else {
        if (cached) cache.delete(address);
        missing.push(address);
      }
    }

    if (missing.length > 0) {
      const resolved = await withRpcDeadline(signal, timeoutMs, async (rpcSignal) => {
        if (!chainAssertion) {
          chainAssertion = rpc.assertBaseChain(rpcSignal).catch((error) => {
            chainAssertion = null;
            throw error;
          });
        }
        await chainAssertion;
        const callData = encodeActivityTokenMetadataMulticall(missing);
        const response = await rpc.request(
          "eth_call",
          [{ to: MULTICALL3_ADDRESS, data: callData }, "latest"],
          rpcSignal,
        );
        return decodeActivityTokenMetadataMulticall(response, missing);
      });
      const storedAt = now().getTime();
      for (const address of missing) {
        const value = resolved.get(address) ?? { kind: "unknown" as const };
        result.set(address, value);
        setCacheEntry(cache, address, { storedAt, value }, cacheMaxEntries);
      }
    }

    return result;
  };
}

export function encodeActivityTokenMetadataMulticall(
  addresses: readonly `0x${string}`[],
): Hex {
  if (addresses.length > ACTIVITY_TOKEN_RPC_BATCH_MAX) {
    throw new Error("Activity token metadata RPC batch is too large.");
  }
  return encodeAggregate3(addresses.flatMap((target) => [
    {
      target,
      callData: encodeFunctionData({ abi: decimalsAbi, functionName: "decimals" }),
    },
    {
      target,
      callData: encodeFunctionData({ abi: symbolStringAbi, functionName: "symbol" }),
    },
  ]));
}

export function decodeActivityTokenMetadataMulticall(
  value: unknown,
  addresses: readonly `0x${string}`[],
): Map<string, ActivityOnchainTokenResult> {
  const results = decodeAggregate3(value);
  if (results.length !== addresses.length * 2) {
    throw new Error("Activity token metadata multicall returned the wrong result count.");
  }
  const metadata = new Map<string, ActivityOnchainTokenResult>();
  addresses.forEach((address, index) => {
    const decimalsResult = results[index * 2]!;
    const symbolResult = results[index * 2 + 1]!;
    if (!decimalsResult.success) {
      metadata.set(address.toLowerCase(), { kind: "nft-like" });
      return;
    }
    const decimals = decodeDecimals(decimalsResult.returnData);
    const symbol = symbolResult.success
      ? decodeSymbol(symbolResult.returnData)
      : null;
    metadata.set(
      address.toLowerCase(),
      decimals !== null && symbol !== null
        ? { kind: "metadata", decimals, symbol }
        : { kind: "unknown" },
    );
  });
  return metadata;
}

function decodeDecimals(data: Hex): number | null {
  try {
    const value = decodeFunctionResult({
      abi: decimalsAbi,
      functionName: "decimals",
      data,
    });
    return value <= BigInt(255) ? Number(value) : null;
  } catch {
    return null;
  }
}

function decodeSymbol(data: Hex): string | null {
  try {
    return decodeFunctionResult({
      abi: symbolStringAbi,
      functionName: "symbol",
      data,
    });
  } catch {
    try {
      const value = decodeFunctionResult({
        abi: symbolBytes32Abi,
        functionName: "symbol",
        data,
      });
      const bytes = hexToBytes(value);
      const end = bytes.indexOf(0);
      return new TextDecoder("utf-8", { fatal: true }).decode(
        end === -1 ? bytes : bytes.slice(0, end),
      );
    } catch {
      return null;
    }
  }
}

async function withRpcDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new Error("Activity token metadata RPC timeout is invalid.");
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function setCacheEntry(
  cache: Map<string, CacheEntry>,
  key: string,
  entry: CacheEntry,
  maximum: number,
): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > maximum) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}
