import "server-only";

import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { TOKENIZED_EQUITY_ORACLE_REGISTRY, type InvestAsset } from "@/config/invest-assets";
import { createBaseRpcClient, parseRpcQuantity } from "@/server/chain/rpc";
import { classifyTokenizedEquityRound, type EquityBlock, type TokenizedEquityFeed, type TokenizedEquityReference } from "./classify";

export type { TokenizedEquityFeed, TokenizedEquityReference } from "./classify";

export function tokenizedEquityFeeds(assets: readonly InvestAsset[]): TokenizedEquityFeed[] {
  return assets.flatMap((asset) => asset.category === "stock" && asset.valuation ? [{
    assetId: asset.id,
    token: asset.contractAddress,
    feedProxy: asset.valuation.feedProxy,
    feedDecimals: asset.valuation.feedDecimals,
    heartbeatSeconds: asset.valuation.heartbeatSeconds,
  }] : []);
}

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
const registryAbi = parseAbi(["function getOracleParams(address token) view returns (uint256 multiplier, bool paused)"]);

type Rpc = Pick<ReturnType<typeof createBaseRpcClient>, "request" | "batch">;
type ReadOptions = { blockNumber: bigint | string; rpc?: Rpc; signal?: AbortSignal };

function failed(feeds: readonly TokenizedEquityFeed[], block: EquityBlock | null): TokenizedEquityReference[] {
  return feeds.map(({ assetId }) => ({ assetId, status: "unavailable", reason: "read-failed", block }));
}

function blockResult(value: unknown, expected: bigint): { number: bigint; timestamp: bigint; reference: EquityBlock } {
  if (typeof value !== "object" || value === null || !("number" in value) || !("timestamp" in value)) throw new Error("Invalid block response.");
  const number = parseRpcQuantity(value.number, "block number");
  const timestamp = parseRpcQuantity(value.timestamp, "block timestamp");
  if (number !== expected || timestamp > BigInt(Math.floor(8_640_000_000_000_000 / 1000))) throw new Error("Invalid block response.");
  return { number, timestamp, reference: { number: number.toString(), timestamp: new Date(Number(timestamp) * 1000).toISOString() } };
}

function wordData(value: unknown, words: number): `0x${string}` {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${words * 64}}$`).test(value)) throw new Error("Invalid oracle response.");
  return value as `0x${string}`;
}

export async function readTokenizedEquityReferences(
  feeds: readonly TokenizedEquityFeed[],
  { blockNumber, rpc = createBaseRpcClient({ timeoutMs: 2_500 }), signal }: ReadOptions,
): Promise<TokenizedEquityReference[]> {
  const requested = BigInt(blockNumber);
  if (requested < BigInt(0)) throw new RangeError("Block number must be nonnegative.");
  if (feeds.length === 0) return [];
  let block: ReturnType<typeof blockResult>;
  try {
    block = blockResult(await rpc.request("eth_getBlockByNumber", [`0x${requested.toString(16)}`, false], signal), requested);
  } catch {
    return failed(feeds, null);
  }
  const tag = `0x${block.number.toString(16)}`;
  const calls = feeds.flatMap(({ token, feedProxy }) => [
    { method: "eth_call", params: [{ to: feedProxy, data: encodeFunctionData({ abi: feedAbi, functionName: "decimals" }) }, tag] },
    { method: "eth_call", params: [{ to: feedProxy, data: encodeFunctionData({ abi: feedAbi, functionName: "latestRoundData" }) }, tag] },
    { method: "eth_call", params: [{ to: TOKENIZED_EQUITY_ORACLE_REGISTRY, data: encodeFunctionData({ abi: registryAbi, functionName: "getOracleParams", args: [token] }) }, tag] },
  ]);
  let results: Array<unknown | null>;
  try {
    results = await rpc.batch(calls, signal, true);
    if (results.length !== calls.length) return failed(feeds, block.reference);
  } catch {
    return failed(feeds, block.reference);
  }
  return feeds.map((feed, index) => {
    try {
      const decimals = decodeFunctionResult({ abi: feedAbi, functionName: "decimals", data: wordData(results[index * 3], 1) });
      const [roundId, answer, , updatedAt] = decodeFunctionResult({ abi: feedAbi, functionName: "latestRoundData", data: wordData(results[index * 3 + 1], 5) });
      const [multiplier, paused] = decodeFunctionResult({ abi: registryAbi, functionName: "getOracleParams", data: wordData(results[index * 3 + 2], 2) });
      return classifyTokenizedEquityRound({ feed, round: { decimals, roundId, answer, updatedAt }, registry: { multiplier, paused }, block });
    } catch {
      return { assetId: feed.assetId, status: "unavailable", reason: "read-failed", block: block.reference };
    }
  });
}

export function createTokenizedEquityReader({
  read = readTokenizedEquityReferences,
  ttlMs = 30_000,
  timeoutMs = 2_500,
  now = Date.now,
  rpc = createBaseRpcClient({ timeoutMs }),
}: {
  read?: typeof readTokenizedEquityReferences;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  rpc?: Rpc;
} = {}): (feeds: readonly TokenizedEquityFeed[]) => Promise<TokenizedEquityReference[]> {
  let cached: { key: string; at: number; references: TokenizedEquityReference[] } | null = null;
  const inFlight = new Map<string, Promise<TokenizedEquityReference[]>>();
  return (feeds) => {
    if (feeds.length === 0) return Promise.resolve([]);
    const key = JSON.stringify(feeds);
    if (cached?.key === key && now() - cached.at < ttlMs) return Promise.resolve(cached.references);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = (async () => {
      let references: TokenizedEquityReference[];
      try {
        const signal = AbortSignal.timeout(timeoutMs);
        const latest = parseRpcQuantity(await rpc.request("eth_blockNumber", [], signal), "block number");
        references = await read(feeds, { blockNumber: latest, rpc, signal });
      } catch {
        references = failed(feeds, null);
      }
      if (references.some((reference) => reference.status !== "unavailable")) cached = { key, at: now(), references };
      return references;
    })().finally(() => { inFlight.delete(key); });
    inFlight.set(key, pending);
    return pending;
  };
}

export const readCurrentTokenizedEquityReferences = createTokenizedEquityReader();
