import "server-only";

import { encodeFunctionData } from "viem";
import {
  BaseRpcError,
  createBaseRpcClient,
  parseRpcDataWord,
  parseRpcQuantity,
  resolveBaseRpcUrl,
  type BaseRpcCall,
} from "@/server/chain/rpc";
import {
  decodeAggregate3,
  decodeBalance,
  encodeAggregate3,
  erc20Abi,
  MULTICALL3_ADDRESS,
  vaultAbi,
  type ContractCall,
  type ContractResult,
} from "@/server/balances/abi";
import {
  decodeWords,
  encodeBorrowRateView,
  encodeMarket,
  encodeMarketParams,
  encodePosition,
} from "@/server/morpho-markets/abi";
import { MORPHO_BLUE_ADDRESS, VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { accrueBorrowAssets, mulDivDown, VIRTUAL_ASSETS, VIRTUAL_SHARES } from "@/shared/morpho-markets/math";
import type {
  BlockRef,
  ChainBucket,
  HexHash,
  HistoryAsset,
  HistoryAssetKey,
  HistoryChainReader,
  MorphoIndexRead,
  QuantityRead,
  VaultRateRead,
} from "./types";

const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;
const SCALE = BigInt(10) ** BigInt(36);
const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const MULTICALL_SIZE = 100;

function parseBlock(value: unknown): BlockRef {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !("hash" in value) || typeof value.hash !== "string" || !BLOCK_HASH.test(value.hash)) {
    throw new BaseRpcError("Base RPC returned invalid block metadata.");
  }
  const number = parseRpcQuantity("number" in value ? value.number : null, "block number");
  const seconds = parseRpcQuantity("timestamp" in value ? value.timestamp : null, "block timestamp", BigInt(Number.MAX_SAFE_INTEGER));
  return { number, hash: value.hash.toLowerCase() as HexHash, timestamp: Number(seconds) };
}

function readHeader(value: unknown, expected: bigint): BlockRef | null {
  try {
    const parsed = parseBlock(value);
    return parsed.number === expected ? parsed : null;
  } catch {
    return null;
  }
}

function readWords(row: ContractResult | undefined, count: number, label: string): bigint[] | null {
  if (!row?.success) return null;
  try {
    const words = decodeWords(row.returnData, count, label);
    return words.every((word) => word <= UINT128_MAX) ? words : null;
  } catch {
    return null;
  }
}

function readWord(row: ContractResult | undefined): bigint | null {
  if (!row?.success) return null;
  try {
    return parseRpcDataWord(row.returnData, "multicall result");
  } catch {
    return null;
  }
}

export function createHistoryChainReader(options: {
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): HistoryChainReader {
  const rpc = createBaseRpcClient({ ...options, rpcUrl: resolveBaseRpcUrl(options.rpcUrl) });
  let chainAssertion: Promise<void> | undefined;
  async function ensureChain(signal?: AbortSignal): Promise<void> {
    chainAssertion ??= rpc.assertBaseChain(signal).catch((error: unknown) => {
      chainAssertion = undefined;
      throw error;
    });
    await chainAssertion;
  }

  async function headers(numbers: readonly bigint[], signal?: AbortSignal): Promise<Map<bigint, BlockRef | null>> {
    const unique = [...new Set(numbers.filter((number) => number >= BigInt(0)))];
    const found = new Map<bigint, BlockRef | null>();
    for (let offset = 0; offset < unique.length; offset += 50) {
      const chunk = unique.slice(offset, offset + 50);
      const calls: BaseRpcCall[] = chunk.map((number) => ({
        method: "eth_getBlockByNumber", params: [`0x${number.toString(16)}`, false],
      }));
      const values = await rpc.batch(calls, signal);
      values.forEach((value, index) => found.set(chunk[index], readHeader(value, chunk[index])));
    }
    return found;
  }

  async function multicall(calls: readonly ContractCall[], block: bigint, signal?: AbortSignal): Promise<(ContractResult | null)[]> {
    const result: (ContractResult | null)[] = [];
    for (let offset = 0; offset < calls.length; offset += MULTICALL_SIZE) {
      const chunk = calls.slice(offset, offset + MULTICALL_SIZE);
      const response = await rpc.request("eth_call", [{
        to: MULTICALL3_ADDRESS, data: encodeAggregate3(chunk),
      }, `0x${block.toString(16)}`], signal);
      const decoded = decodeAggregate3(response);
      if (decoded.length !== chunk.length) throw new BaseRpcError("Multicall returned the wrong row count.");
      result.push(...decoded);
    }
    return result;
  }

  return {
    async finalizedHead(signal) {
      await ensureChain(signal);
      return parseBlock(await rpc.request("eth_getBlockByNumber", ["finalized", false], signal));
    },
    async resolveBuckets(bucketTimes, finalized, signal) {
      await ensureChain(signal);
      const eligible = bucketTimes.flatMap((bucketAt) => {
        const timestamp = bucketAt.getTime() / 1000;
        if (!Number.isSafeInteger(timestamp) || timestamp % 3600 !== 0 || timestamp > finalized.timestamp) return [];
        const delta = BigInt(finalized.timestamp - timestamp);
        const estimate = finalized.number - (delta + BigInt(1)) / BigInt(2);
        return estimate < BigInt(0) ? [] : [{ bucketAt, timestamp, estimate }];
      });
      const first = await headers(eligible.flatMap(({ estimate }) => [estimate, estimate + BigInt(1)]), signal);
      const corrected = new Map<number, bigint>();
      for (const [index, { timestamp, estimate }] of eligible.entries()) {
        const current = first.get(estimate);
        const next = first.get(estimate + BigInt(1));
        if (!current || !next || (current.timestamp <= timestamp && timestamp < next.timestamp)) continue;
        const shifted = estimate + BigInt(Math.floor((timestamp - current.timestamp) / 2));
        const candidate = current.timestamp > timestamp
          ? (shifted < estimate ? shifted : estimate - BigInt(1))
          : (shifted > estimate ? shifted : estimate + BigInt(1));
        if (candidate >= BigInt(0) && candidate <= finalized.number) corrected.set(index, candidate);
      }
      const second = await headers([...corrected.values()].flatMap((number) => [number, number + BigInt(1)]), signal);
      return eligible.flatMap(({ bucketAt, timestamp, estimate }, index): ChainBucket[] => {
        const number = corrected.get(index) ?? estimate;
        const source = corrected.has(index) ? second : first;
        const current = source.get(number);
        const next = source.get(number + BigInt(1));
        if (!current || !next || current.timestamp > timestamp || next.timestamp <= timestamp || current.timestamp > finalized.timestamp) return [];
        return [{ bucketAt, blockNumber: number, blockHash: current.hash, blockTime: new Date(current.timestamp * 1000) }];
      });
    },
    async readQuantities({ address, assets, block, signal }) {
      await ensureChain(signal);
      const calls: ContractCall[] = [];
      const indexes = new Map<HistoryAssetKey, { index: number; kind: HistoryAsset["kind"] }>();
      const positions = new Map<HexHash, number>();
      for (const asset of assets) {
        if (asset.marketId !== null) {
          let index = positions.get(asset.marketId);
          if (index === undefined) {
            index = calls.length;
            positions.set(asset.marketId, index);
            calls.push({ target: MORPHO_BLUE_ADDRESS, callData: encodePosition(asset.marketId, address) });
          }
          indexes.set(asset.key, { index, kind: asset.kind });
        } else {
          const index = calls.length;
          calls.push(asset.kind === "native"
            ? { target: MULTICALL3_ADDRESS, callData: encodeFunctionData({ abi: [{ type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const, functionName: "getEthBalance", args: [address] }) }
            : { target: asset.contractAddress, callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [address] }) });
          indexes.set(asset.key, { index, kind: asset.kind });
        }
      }
      const rows = await multicall(calls, block, signal);
      const targets = new Map<string, HistoryAssetKey[]>();
      for (const asset of assets) {
        const index = indexes.get(asset.key)!.index;
        const row = rows[index];
        if (row?.success && row.returnData !== "0x") continue;
        const target = asset.marketId !== null ? MORPHO_BLUE_ADDRESS : asset.contractAddress;
        if (target !== null) targets.set(target, [...targets.get(target) ?? [], asset.key]);
      }
      const absent = new Set<HistoryAssetKey>();
      const contracts = [...targets.keys()];
      for (let offset = 0; offset < contracts.length; offset += 50) {
        const chunk = contracts.slice(offset, offset + 50);
        const codes = await rpc.batch(chunk.map((target) => ({
          method: "eth_getCode", params: [target, `0x${block.toString(16)}`],
        })), signal, true).catch(() => []);
        codes.forEach((code, index) => {
          if (code === "0x") for (const key of targets.get(chunk[index]) ?? []) absent.add(key);
        });
      }
      const result = new Map<HistoryAssetKey, QuantityRead>();
      for (const [key, { index, kind }] of indexes) {
        const row = rows[index];
        const position = kind === "morpho-collateral" || kind === "morpho-borrow-shares" ? readWords(row ?? undefined, 3, "position") : null;
        const amount = position ? position[kind === "morpho-collateral" ? 2 : 1] :
          kind === "erc20" || kind === "vault-share" ? (row?.success ? decodeBalance(row.returnData) : null) :
            kind === "native" ? readWord(row ?? undefined) : null;
        result.set(key, amount === null || amount === undefined
          ? absent.has(key) ? { status: "ready", baseUnits: BigInt(0) } : { status: "unavailable" }
          : { status: "ready", baseUnits: amount });
      }
      return result;
    },
    async readVaultRates({ vaults, block, signal }): Promise<VaultRateRead[]> {
      await ensureChain(signal);
      const rows = await multicall(vaults.map((vault) => ({ target: vault, callData: encodeFunctionData({
        abi: vaultAbi, functionName: "convertToAssets", args: [SCALE],
      }) })), block, signal);
      return vaults.map((vault, index) => {
        const atoms = readWord(rows[index] ?? undefined);
        return { vault, value: atoms === null ? null : { atoms, scale: 36 } };
      });
    },
    async readMorphoBorrowIndexes({ marketIds, block, blockTimestamp, signal }): Promise<MorphoIndexRead[]> {
      await ensureChain(signal);
      const calls = marketIds.flatMap((marketId): ContractCall[] => [
        { target: MORPHO_BLUE_ADDRESS, callData: encodeMarket(marketId) },
        { target: MORPHO_BLUE_ADDRESS, callData: encodeMarketParams(marketId) },
      ]);
      const first = await multicall(calls, block, signal);
      const ready: Array<{ index: number; state: bigint[]; ref: (typeof VERIFIED_MORPHO_MARKETS)[number] }> = [];
      marketIds.forEach((marketId, index) => {
        const state = readWords(first[index * 2] ?? undefined, 6, "market");
        let params: bigint[] | null = null;
        const paramsRow = first[index * 2 + 1];
        if (paramsRow?.success) {
          try { params = decodeWords(paramsRow.returnData, 5, "market params"); } catch { params = null; }
        }
        const ref = VERIFIED_MORPHO_MARKETS.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase());
        if (!state || !params || !ref || state[4] === BigInt(0) || state[4] > BigInt(blockTimestamp)) return;
        if (params[0] !== BigInt(ref.loanToken.address) ||
          params[1] !== BigInt(ref.collateralToken.address) ||
          params[2] !== BigInt(ref.oracle) ||
          params[3] !== BigInt(ref.irm) || params[4] !== ref.lltvWad) return;
        ready.push({ index, state, ref });
      });
      const second = await multicall(ready.map(({ state, ref }) => ({ target: ref.irm, callData: encodeBorrowRateView(ref, state) })), block, signal);
      const values: (MorphoIndexRead["value"])[] = marketIds.map(() => null);
      ready.forEach(({ index, state }, offset) => {
        const rate = readWord(second[offset] ?? undefined);
        if (rate === null) return;
        const accrued = accrueBorrowAssets(state[2], rate, BigInt(blockTimestamp) - state[4]);
        if (accrued > UINT128_MAX) return;
        values[index] = { atoms: mulDivDown(accrued + VIRTUAL_ASSETS, SCALE, state[3] + VIRTUAL_SHARES), scale: 36 };
      });
      return marketIds.map((marketId, index) => ({ marketId, value: values[index] }));
    },
  };
}
