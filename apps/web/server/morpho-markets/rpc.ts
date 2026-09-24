import "server-only";

import type { MoneyActionCall } from "@/shared/money-actions/types";
import {
  decodeAddressWord, decodeWords, encodeAllowance, encodeBalanceOf,
  encodeBorrowRateView, encodeMarket, encodeMarketParams, encodePosition, encodePrice,
} from "./abi";
import {
  BASE_CHAIN_ID, type MorphoAddress, type MorphoAssetRef,
  type MorphoMarketCapability, type MorphoMarketId, type VerifiedMorphoMarketRef,
} from "@/shared/morpho-markets/config";
import { computeMorphoMarketId } from "@/shared/morpho-markets/market-id";
import {
  SECONDS_PER_YEAR, accrueBorrowAssets, availableBorrowAssets, borrowCapacityAssets,
  healthFactorWad, liquidationPriceRaw, minimumCollateralForDebt, toAssetsUp,
} from "@/shared/morpho-markets/math";
import {
  CoinbaseSmartAccountBatchSimulationError, createCoinbaseSmartAccountBatchSimulator,
} from "@/server/chain/coinbase-smart-account";
import { createBaseRpcClient, parseRpcQuantity, resolveBaseRpcUrl } from "@/server/chain/rpc";

const RPC_TIMEOUT_MS = 8_000;
const READ_BATCH_SIZE = 40;
const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;

type FetchLike = typeof fetch;
type RpcRequest = { id: number; method: string; params: unknown[] };
type SourceBlock = { numberHex: string; number: bigint; hash: `0x${string}`; timestamp: bigint };
export type MorphoMarketReadResult =
  | { market: VerifiedMorphoMarketRef; snapshot: MorphoMarketSnapshot; error?: never }
  | { market: VerifiedMorphoMarketRef; error: MorphoMarketRpcError; snapshot?: never };

export type MorphoMarketSnapshot = {
  chainId: typeof BASE_CHAIN_ID;
  walletAddress: MorphoAddress;
  market: {
    id: MorphoMarketId; morpho: MorphoAddress; loanToken: MorphoAssetRef;
    collateralToken: MorphoAssetRef; oracle: MorphoAddress; irm: MorphoAddress;
    lltvWad: string; rank: number;
  };
  capabilities: { borrow?: MorphoMarketCapability };
  source: {
    provider: "Base JSON-RPC"; blockNumber: string; blockHash: `0x${string}`;
    blockTimestamp: string; fetchedAt: string;
  };
  state: {
    oraclePriceRaw: string; borrowRatePerSecondWad: string; borrowAprWad: string;
    totalSupplyAssetsRaw: string; totalBorrowAssetsRaw: string; totalBorrowSharesRaw: string;
    liquidityAssetsRaw: string; lastUpdateTimestamp: string;
  };
  wallet: {
    collateralBalanceRaw: string; loanBalanceRaw: string;
    collateralAllowanceRaw: string; loanAllowanceRaw: string;
  };
  position: {
    collateralRaw: string; borrowSharesRaw: string; debtAssetsRaw: string;
    availableBorrowAssetsRaw: string; withdrawableCollateralRaw: string;
    healthFactorWad: string | null; liquidationPriceRaw: string | null;
  };
};

export class MorphoMarketRpcError extends Error {
  readonly code: "rpc" | "account-capability";
  constructor(message: string, codeOrOptions: "rpc" | "account-capability" | ErrorOptions = "rpc", options?: ErrorOptions) {
    super(message, typeof codeOrOptions === "string" ? options : codeOrOptions);
    this.name = "MorphoMarketRpcError";
    this.code = typeof codeOrOptions === "string" ? codeOrOptions : "rpc";
  }
}

export type MorphoPinnedBlock = { number: string; hash: `0x${string}` };
export type MorphoMarketRpcReader = {
  readSnapshots(account: MorphoAddress, markets: readonly VerifiedMorphoMarketRef[], signal?: AbortSignal, at?: MorphoPinnedBlock): Promise<MorphoMarketReadResult[]>;
  readSnapshot(account: MorphoAddress, marketRef: VerifiedMorphoMarketRef, signal?: AbortSignal, at?: MorphoPinnedBlock): Promise<MorphoMarketSnapshot>;
  simulateBatch(calls: readonly MoneyActionCall[], account: MorphoAddress, blockNumber: string, expectedBlockHash: `0x${string}`, signal?: AbortSignal): Promise<void>;
};

export function createMorphoMarketRpcReader(options: {
  fetchImpl?: FetchLike; rpcUrl?: string; timeoutMs?: number; now?: () => Date;
} = {}): MorphoMarketRpcReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new MorphoMarketRpcError("The Base RPC timeout must be 1-30000ms.");
  }
  let chainVerified = false;
  const batchSimulator = createCoinbaseSmartAccountBatchSimulator({ fetchImpl, rpcUrl, timeoutMs });

  async function withTimeout<T>(externalSignal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      return await work(controller.signal);
    } catch (error) {
      if (error instanceof MorphoMarketRpcError) throw error;
      throw new MorphoMarketRpcError(
        controller.signal.aborted ? "The Base Morpho market RPC request timed out or was aborted." : "The Base Morpho market RPC request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  async function readSnapshots(account: MorphoAddress, markets: readonly VerifiedMorphoMarketRef[], externalSignal?: AbortSignal, at?: MorphoPinnedBlock): Promise<MorphoMarketReadResult[]> {
    assertAddress(account, "account");
    const idErrors = markets.map((market) => {
      try {
        if (computeMorphoMarketId({
          loanToken: market.loanToken.address, collateralToken: market.collateralToken.address,
          oracle: market.oracle, irm: market.irm, lltv: market.lltvWad,
        }).toLowerCase() !== market.marketId.toLowerCase()) {
          throw new MorphoMarketRpcError("The configured Morpho market id does not match its parameters.");
        }
        return null;
      } catch (error) {
        return asMarketError(error);
      }
    });
    if (markets.length === 0 || idErrors.every(Boolean)) {
      return markets.map((market, index) => ({ market, error: idErrors[index]! }));
    }
    return withTimeout(externalSignal, async (signal) => {
      if (!chainVerified) {
        const chain = await rpc(fetchImpl, rpcUrl, request(1, "eth_chainId", []), signal);
        if (readQuantity(chain, "chain id", UINT256_MAX) !== BigInt(BASE_CHAIN_ID)) {
          throw new MorphoMarketRpcError("The configured RPC is not Base mainnet.");
        }
        chainVerified = true;
      }
      const block = readBlock(await rpc(fetchImpl, rpcUrl, request(2, "eth_getBlockByNumber", [at ? `0x${BigInt(at.number).toString(16)}` : "latest", false]), signal));
      if (at && (block.number !== BigInt(at.number) || block.hash.toLowerCase() !== at.hash.toLowerCase())) {
        throw new MorphoMarketRpcError("The pinned Base block is not canonical.");
      }
      const results: MorphoMarketReadResult[] = markets.map((market, index) => ({ market, error: idErrors[index] ?? new MorphoMarketRpcError("A required market read is unavailable.") }));
      const valid = markets.map((market, index) => ({ market, index })).filter(({ index }) => !idErrors[index]);
      const reads = valid.flatMap(({ market, index }) => {
        const id = 3 + index * 12;
        return [
          callRequest(id, market.morpho, encodeMarketParams(market.marketId), block.numberHex),
          callRequest(id + 1, market.morpho, encodeMarket(market.marketId), block.numberHex),
          callRequest(id + 2, market.morpho, encodePosition(market.marketId, account), block.numberHex),
          callRequest(id + 3, market.oracle, encodePrice(), block.numberHex),
          callRequest(id + 4, market.collateralToken.address, encodeBalanceOf(account), block.numberHex),
          callRequest(id + 5, market.loanToken.address, encodeBalanceOf(account), block.numberHex),
          callRequest(id + 6, market.collateralToken.address, encodeAllowance(account, market.morpho), block.numberHex),
          callRequest(id + 7, market.loanToken.address, encodeAllowance(account, market.morpho), block.numberHex),
          callRequest(id + 8, market.loanToken.address, "0x313ce567", block.numberHex),
          callRequest(id + 9, market.collateralToken.address, "0x313ce567", block.numberHex),
        ];
      });
      const responses = new Map<number, unknown>();
      for (let offset = 0; offset < reads.length; offset += READ_BATCH_SIZE) {
        const chunk = reads.slice(offset, offset + READ_BATCH_SIZE);
        const values = await rpcBatch(fetchImpl, rpcUrl, chunk, signal);
        chunk.forEach(({ id }, index) => responses.set(id, values[index]));
      }
      const ready: Array<{ market: VerifiedMorphoMarketRef; index: number; state: bigint[]; position: bigint[]; oracle: bigint }> = [];
      for (const { market, index } of valid) {
        let marketError: MorphoMarketRpcError | null = null;
        try {
          const id = 3 + index * 12;
          verifyMarketParams(decodeWords(responses.get(id), 5, "market params"), market);
          const state = decodeWords(responses.get(id + 1), 6, "market");
          state.forEach((word) => assertMaximum(word, UINT128_MAX, "market word"));
          const position = decodeWords(responses.get(id + 2), 3, "position");
          position.forEach((word) => assertMaximum(word, UINT128_MAX, "position word"));
          const oracle = oneWord(responses.get(id + 3), "oracle price");
          if (oracle === BigInt(0)) throw new MorphoMarketRpcError("The market oracle returned no usable price.");
          for (const [offset, expected] of [[8, market.loanToken.decimals], [9, market.collateralToken.decimals]]) {
            if (oneWord(responses.get(id + offset), "token decimals") !== BigInt(expected)) {
              throw new MorphoMarketRpcError("Onchain token decimals do not match the configured market.");
            }
          }
          ready.push({ market, index, state, position, oracle });
        } catch (error) {
          marketError = asMarketError(error);
        }
        if (marketError) results[index] = { market, error: marketError };
      }
      const rateCalls = ready.map(({ market, index, state }) => callRequest(3 + index * 12 + 10, market.irm, encodeBorrowRateView(market, state), block.numberHex));
      for (let offset = 0; offset < rateCalls.length; offset += READ_BATCH_SIZE) {
        const chunk = rateCalls.slice(offset, offset + READ_BATCH_SIZE);
        const values = await rpcBatch(fetchImpl, rpcUrl, chunk, signal);
        chunk.forEach(({ id }, index) => responses.set(id, values[index]));
      }
      const confirmed = readBlock(await rpc(fetchImpl, rpcUrl, request(12, "eth_getBlockByNumber", [block.numberHex, false]), signal));
      if (confirmed.number !== block.number || confirmed.hash.toLowerCase() !== block.hash.toLowerCase()) {
        throw new MorphoMarketRpcError("The Base source block changed while the market was read.");
      }
      const fetchedAt = now();
      if (Number.isNaN(fetchedAt.getTime())) throw new MorphoMarketRpcError("The Morpho market fetch time is invalid.");
      for (const { market, index, state, position, oracle } of ready) {
        let marketError: MorphoMarketRpcError | null = null;
        try {
          const id = 3 + index * 12;
          const borrowRate = oneWord(responses.get(id + 10), "borrow rate");
          const [totalSupplyAssets, , storedBorrowAssets, totalBorrowShares, lastUpdate] = state;
          if (lastUpdate === BigInt(0)) throw new MorphoMarketRpcError("The configured Morpho market is not created.");
          if (lastUpdate > block.timestamp) throw new MorphoMarketRpcError("Morpho market time is ahead of the source block.");
          const currentBorrowAssets = accrueBorrowAssets(storedBorrowAssets, borrowRate, block.timestamp - lastUpdate);
          const interest = currentBorrowAssets - storedBorrowAssets;
          const currentSupplyAssets = totalSupplyAssets + interest;
          assertMaximum(currentBorrowAssets, UINT128_MAX, "accrued borrow assets");
          assertMaximum(currentSupplyAssets, UINT128_MAX, "accrued supply assets");
          const liquidity = currentSupplyAssets >= currentBorrowAssets ? currentSupplyAssets - currentBorrowAssets : BigInt(0);
          const [, borrowShares, collateral] = position;
          const debt = toAssetsUp(borrowShares, currentBorrowAssets, totalBorrowShares);
          const rawMaxDebt = borrowCapacityAssets(collateral, oracle, market.lltvWad);
          const rawAvailableBorrow = availableBorrowAssets({
            positionBorrowShares: borrowShares, totalBorrowAssets: currentBorrowAssets,
            totalBorrowShares, maxDebtAssets: rawMaxDebt, liquidityAssets: liquidity,
          });
          const requiredCollateral = minimumCollateralForDebt(debt, oracle, market.lltvWad);
          const withdrawable = collateral > requiredCollateral ? collateral - requiredCollateral : BigInt(0);
          results[index] = { market, snapshot: {
            chainId: BASE_CHAIN_ID,
            walletAddress: account.toLowerCase() as MorphoAddress,
            market: {
              id: market.marketId, morpho: market.morpho, loanToken: market.loanToken,
              collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm,
              lltvWad: market.lltvWad.toString(10), rank: market.rank,
            },
            capabilities: market.capabilities,
            source: {
              provider: "Base JSON-RPC", blockNumber: block.number.toString(10),
              blockHash: block.hash.toLowerCase() as `0x${string}`,
              blockTimestamp: block.timestamp.toString(10), fetchedAt: fetchedAt.toISOString(),
            },
            state: {
              oraclePriceRaw: oracle.toString(10), borrowRatePerSecondWad: borrowRate.toString(10),
              borrowAprWad: (borrowRate * SECONDS_PER_YEAR).toString(10),
              totalSupplyAssetsRaw: currentSupplyAssets.toString(10),
              totalBorrowAssetsRaw: currentBorrowAssets.toString(10),
              totalBorrowSharesRaw: totalBorrowShares.toString(10), liquidityAssetsRaw: liquidity.toString(10),
              lastUpdateTimestamp: lastUpdate.toString(10),
            },
            wallet: {
              collateralBalanceRaw: oneWord(responses.get(id + 4), "collateral balance").toString(10),
              loanBalanceRaw: oneWord(responses.get(id + 5), "loan balance").toString(10),
              collateralAllowanceRaw: oneWord(responses.get(id + 6), "collateral allowance").toString(10),
              loanAllowanceRaw: oneWord(responses.get(id + 7), "loan allowance").toString(10),
            },
            position: {
              collateralRaw: collateral.toString(10), borrowSharesRaw: borrowShares.toString(10),
              debtAssetsRaw: debt.toString(10), availableBorrowAssetsRaw: rawAvailableBorrow.toString(10),
              withdrawableCollateralRaw: withdrawable.toString(10),
              healthFactorWad: healthFactorWad(rawMaxDebt, debt)?.toString(10) ?? null,
              liquidationPriceRaw: liquidationPriceRaw(debt, collateral, market.lltvWad)?.toString(10) ?? null,
            },
          } };
        } catch (error) {
          marketError = asMarketError(error);
        }
        if (marketError) results[index] = { market, error: marketError };
      }
      return results;
    });
  }

  return {
    readSnapshots,
    async readSnapshot(account, marketRef, signal, at) {
      const [result] = await readSnapshots(account, [marketRef], signal, at);
      if (result.error) throw result.error;
      return result.snapshot!;
    },
    async simulateBatch(calls, account, blockNumber, expectedBlockHash, externalSignal) {
      try {
        await batchSimulator.simulateBatch(calls, account, { blockNumber, blockHash: expectedBlockHash }, externalSignal);
      } catch (error) {
        if (error instanceof CoinbaseSmartAccountBatchSimulationError) {
          throw new MorphoMarketRpcError(morphoSimulationMessage(error), error.code, { cause: error });
        }
        throw new MorphoMarketRpcError("The Base Morpho market batch simulation failed.", { cause: error });
      }
    },
  };
}

function asMarketError(error: unknown): MorphoMarketRpcError {
  return error instanceof MorphoMarketRpcError ? error : new MorphoMarketRpcError("The configured market returned invalid state.", { cause: error });
}

function morphoSimulationMessage(error: CoinbaseSmartAccountBatchSimulationError): string {
  if (error.message === "Base RPC rejected a smart-account batch simulation call.") {
    return "Base RPC rejected a Morpho market call or simulation.";
  }
  if (error.message === "The Base smart-account batch simulation timed out or was aborted.") {
    return "The Base Morpho market RPC request timed out or was aborted.";
  }
  return error.message;
}

function verifyMarketParams(words: bigint[], marketRef: VerifiedMorphoMarketRef) {
  const [loan, collateral, oracle, irm, lltv] = words;
  const actual = [decodeAddressWord(loan), decodeAddressWord(collateral), decodeAddressWord(oracle), decodeAddressWord(irm)];
  const expected = [marketRef.loanToken.address, marketRef.collateralToken.address, marketRef.oracle, marketRef.irm];
  if (actual.some((address, index) => address.toLowerCase() !== expected[index].toLowerCase()) || lltv !== marketRef.lltvWad) {
    throw new MorphoMarketRpcError("The configured Morpho market parameters do not match Base state.");
  }
}
function request(id: number, method: string, params: unknown[]): RpcRequest { return { id, method, params }; }
function callRequest(id: number, to: MorphoAddress, data: `0x${string}`, block: string): RpcRequest {
  return request(id, "eth_call", [{ to, data }, block]);
}
async function rpc(fetchImpl: FetchLike, rpcUrl: string, body: RpcRequest, signal: AbortSignal): Promise<unknown> {
  try {
    return await createBaseRpcClient({ fetchImpl, rpcUrl }).request(body.method, body.params, signal, body.id);
  } catch (error) {
    throw new MorphoMarketRpcError("Base RPC rejected a Morpho market call or simulation.", { cause: error });
  }
}
async function rpcBatch(fetchImpl: FetchLike, rpcUrl: string, body: RpcRequest[], signal: AbortSignal): Promise<Array<unknown | null>> {
  try {
    return await createBaseRpcClient({ fetchImpl, rpcUrl }).batch(body, signal, true);
  } catch (error) {
    throw new MorphoMarketRpcError("Base RPC returned an invalid batch response.", { cause: error });
  }
}
function oneWord(value: unknown, label: string) { return decodeWords(value, 1, label)[0]; }
function readBlock(value: unknown): SourceBlock {
  if (!isRecord(value)) throw new MorphoMarketRpcError("Base RPC returned invalid block metadata.");
  if (typeof value.hash !== "string" || !hashPattern.test(value.hash)) throw new MorphoMarketRpcError("Base RPC returned an invalid block hash.");
  return {
    numberHex: String(value.number), number: readQuantity(value.number, "block number", UINT256_MAX),
    hash: value.hash as `0x${string}`, timestamp: readQuantity(value.timestamp, "block timestamp", UINT256_MAX),
  };
}
function readQuantity(value: unknown, label: string, maximum: bigint) {
  try { return parseRpcQuantity(value, label, maximum); }
  catch (error) { throw new MorphoMarketRpcError(`Base RPC returned malformed ${label}.`, { cause: error }); }
}
function assertMaximum(value: bigint, maximum: bigint, label: string) {
  if (value < BigInt(0) || value > maximum) throw new MorphoMarketRpcError(`Base RPC returned out-of-range ${label}.`);
}
function assertAddress(value: string, label: string): asserts value is MorphoAddress {
  if (!addressPattern.test(value)) throw new MorphoMarketRpcError(`${label} must be an EVM address.`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
